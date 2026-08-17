import { createAdminClient } from '@/lib/supabase/admin'
import { dataIsoLocal, instanteLocal, partesLocais } from '@/lib/agenda/fuso'

/* Leituras da tela de Pagamentos (PRD 14 e 17.1).
 *
 * O dashboard já mostra o KPI de inadimplência; esta tela é a visão de
 * trabalho: qual parcela de qual contrato, o link do boleto, e o que o Asaas
 * mandou e não encontrou correspondência aqui.
 *
 * Nenhuma consulta seleciona cpf_hash ou cpf_encrypted — só cpf_last4.
 */

export type StatusParcela = 'pendente' | 'pago' | 'atrasado' | 'cancelado'

export interface ParcelaLinha {
  id: string
  deal_id: string
  competencia: string
  amount_cents: number
  status: StatusParcela
  due_date: string
  paid_at: string | null
  boleto_url: string | null
  asaas_payment_id: string | null
  /** Vencida e não paga — calculado aqui, não confiando só na coluna. */
  vencida: boolean
  cliente: string | null
  cliente_cpf_last4: string | null
  imovel: string | null
  corretor: string | null
  tem_assinatura: boolean
}

export interface EventoOrfao {
  id: string
  event: string
  asaas_payment_id: string | null
  observacao: string | null
  recebido_em: string
}

export interface ResumoPagamentos {
  aReceberCents: number
  atrasadoCents: number
  recebidoMesCents: number
  parcelasAtrasadas: number
  contratosAtivos: number
  contratosSemCobranca: number
}

export interface PainelPagamentos {
  resumo: ResumoPagamentos
  parcelas: ParcelaLinha[]
  orfaos: EventoOrfao[]
  /** Contratos ativos de locação que nunca geraram assinatura no Asaas. */
  semCobranca: { deal_id: string; cliente: string | null; imovel: string | null }[]
}

export async function montarPainelPagamentos(brokerId?: string | null): Promise<PainelPagamentos> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('lease_payments')
    .select(
      `id, deal_id, reference_month, amount_cents, status, due_date, paid_at, boleto_url,
       asaas_payment_id,
       deals ( broker_id, asaas_subscription_id,
               registrations!deals_client_registration_id_fkey ( full_name, cpf_last4 ),
               properties ( reference_code, title ),
               brokers ( name ) )`
    )
    .order('due_date', { ascending: false })
    .limit(500)

  if (error) throw new Error(`Falha ao listar pagamentos: ${error.message}`)

  /* "Hoje" no calendário de São Paulo. `due_date` é DATE (sem hora): vencida
     é due_date < hoje, comparado como data — sem passar por relógio de
     servidor, que em UTC virava o dia às 21h. */
  const agora = new Date()
  const hojeIso = dataIsoLocal(agora)

  let parcelas: (ParcelaLinha & { _broker: string | null })[] = (data ?? []).map((p) => {
    const negocio = p.deals as unknown as {
      broker_id: string | null
      asaas_subscription_id: string | null
      registrations: { full_name: string; cpf_last4: string } | null
      properties: { reference_code: string; title: string } | null
      brokers: { name: string } | null
    } | null

    /* `vencida` é calculado, não lido da coluna: o status só vira 'atrasado'
       quando o Asaas manda PAYMENT_OVERDUE, e enquanto o webhook não chega (ou
       antes do deploy) a parcela venceria em silêncio na tela. */
    const vencida =
      p.status !== 'pago' &&
      p.status !== 'cancelado' &&
      String(p.due_date).slice(0, 10) < hojeIso

    return {
      id: p.id,
      deal_id: p.deal_id,
      competencia: String(p.reference_month).slice(0, 7),
      amount_cents: p.amount_cents,
      status: p.status as StatusParcela,
      due_date: p.due_date,
      paid_at: p.paid_at,
      boleto_url: p.boleto_url,
      asaas_payment_id: p.asaas_payment_id,
      vencida,
      cliente: negocio?.registrations?.full_name ?? null,
      cliente_cpf_last4: negocio?.registrations?.cpf_last4 ?? null,
      imovel: negocio?.properties
        ? `${negocio.properties.reference_code} — ${negocio.properties.title}`
        : null,
      corretor: negocio?.brokers?.name ?? null,
      tem_assinatura: Boolean(negocio?.asaas_subscription_id),
      _broker: negocio?.broker_id ?? null,
    }
  })

  /* Recorte por carteira em memória: `broker_id` está no `deals` relacionado, e
     o PostgREST não filtra por coluna de tabela aninhada num select como este. */
  if (brokerId) parcelas = parcelas.filter((p) => p._broker === brokerId)

  const partesHoje = partesLocais(agora)
  const inicioDoMes = instanteLocal(partesHoje.ano, partesHoje.mes, 1)

  const resumo: ResumoPagamentos = {
    aReceberCents: parcelas
      .filter((p) => p.status === 'pendente' && !p.vencida)
      .reduce((s, p) => s + p.amount_cents, 0),
    atrasadoCents: parcelas
      .filter((p) => p.vencida)
      .reduce((s, p) => s + p.amount_cents, 0),
    recebidoMesCents: parcelas
      .filter((p) => p.status === 'pago' && p.paid_at && new Date(p.paid_at) >= inicioDoMes)
      .reduce((s, p) => s + p.amount_cents, 0),
    parcelasAtrasadas: parcelas.filter((p) => p.vencida).length,
    contratosAtivos: 0,
    contratosSemCobranca: 0,
  }

  // ---- Contratos ativos sem assinatura no Asaas ----
  let consultaAtivos = supabase
    .from('deals')
    .select(
      `id, broker_id, asaas_subscription_id,
       registrations!deals_client_registration_id_fkey ( full_name ),
       properties ( reference_code, title )`
    )
    .eq('deal_type', 'locacao')
    .eq('status', 'ativo')

  if (brokerId) consultaAtivos = consultaAtivos.eq('broker_id', brokerId)

  const { data: ativos } = await consultaAtivos
  resumo.contratosAtivos = (ativos ?? []).length

  /* Contrato ativo sem assinatura é dinheiro que não vai ser cobrado. Acontece
     quando a criação falha depois da ativação — que é deliberado (ativar não
     desfaz por causa de uma API fora do ar), e por isso precisa aparecer. */
  const semCobranca = (ativos ?? [])
    .filter((d) => !d.asaas_subscription_id)
    .map((d) => {
      const cliente = d.registrations as unknown as { full_name: string } | null
      const imovel = d.properties as unknown as { reference_code: string; title: string } | null
      return {
        deal_id: d.id,
        cliente: cliente?.full_name ?? null,
        imovel: imovel ? `${imovel.reference_code} — ${imovel.title}` : null,
      }
    })
  resumo.contratosSemCobranca = semCobranca.length

  /* ---- Eventos do Asaas sem correspondência ----
     Conciliação é visão da operação inteira: o corretor não tem o que fazer com
     um evento solto do Asaas, e mostrar para ele só geraria dúvida. */
  const orfaos = brokerId
    ? []
    : ((
        await supabase
          .from('asaas_events')
          .select('id, event, asaas_payment_id, observacao, recebido_em')
          .eq('aplicado', false)
          .not('asaas_payment_id', 'is', null)
          .order('recebido_em', { ascending: false })
          .limit(50)
      ).data ?? [])

  return {
    resumo,
    parcelas: parcelas.map(({ _broker, ...resto }) => {
      void _broker
      return resto
    }),
    orfaos: orfaos as EventoOrfao[],
    semCobranca,
  }
}

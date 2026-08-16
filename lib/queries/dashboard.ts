import { createAdminClient } from '@/lib/supabase/admin'
import type { FunnelStage, Intent } from '@/lib/types/domain'

/* Metricas do dashboard (PRD 17.1).

   As distribuicoes sao agregadas em JS a partir de uma coluna so, e nao por
   GROUP BY: o supabase-js nao expoe agregacao e, no volume desta fase (centenas
   de contatos), a diferenca e irrelevante. Quando passar de alguns milhares,
   trocar por uma view ou RPC — nao por paginacao manual aqui. */

const ROTULO_FUNIL: Record<FunnelStage, string> = {
  novo: 'Novo',
  qualificando: 'Qualificando',
  qualificado: 'Qualificado',
  visita_agendada: 'Visita agendada',
  em_negociacao: 'Em negociação',
  convertido: 'Convertido',
  perdido: 'Perdido',
}

const ROTULO_INTENCAO: Record<Intent, string> = {
  compra: 'Compra',
  aluguel: 'Aluguel',
  investimento: 'Investimento',
  disponibilizar_imovel: 'Disponibilizar imóvel',
}

const ORDEM_FUNIL = Object.keys(ROTULO_FUNIL) as FunnelStage[]

export interface DashboardMetrics {
  funil: { stage: FunnelStage; label: string; total: number }[]
  porIntencao: { intent: Intent; label: string; total: number }[]
  leadsAtivos: number
  visitasSemana: {
    id: string
    quando: string
    status: string
    lead: string
    imovel: string
    corretor: string
  }[]
  filaAprovacao: { id: string; tipo: string; label: string; descricao: string; desde: string }[]
  documentosPendentes: number
  cobrancas: { atrasadas: number; valorAtrasadoCents: number; recebidoMesCents: number }
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const supabase = createAdminClient()
  const agora = new Date()
  const daquiSeteDias = new Date(agora.getTime() + 7 * 24 * 60 * 60 * 1000)
  const inicioDoMes = new Date(agora.getFullYear(), agora.getMonth(), 1)

  const [contatos, visitas, aprovacoes, documentos, pagamentos] = await Promise.all([
    supabase.from('contacts').select('funnel_stage, intent'),

    supabase
      .from('property_visits')
      .select(
        `id, scheduled_at, status,
         contacts ( name ),
         properties ( reference_code, region ),
         brokers ( name )`
      )
      .gte('scheduled_at', agora.toISOString())
      .lte('scheduled_at', daquiSeteDias.toISOString())
      .in('status', ['agendada', 'confirmada'])
      .order('scheduled_at', { ascending: true }),

    supabase
      .from('approval_requests')
      .select(`id, type, notes, created_at, properties ( reference_code, region, title )`)
      .eq('status', 'pendente')
      .order('created_at', { ascending: true }),

    supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pendente_revisao'),

    supabase.from('lease_payments').select('status, amount_cents, paid_at'),
  ])

  const erro =
    contatos.error || visitas.error || aprovacoes.error || documentos.error || pagamentos.error
  if (erro) throw new Error(`Falha ao carregar métricas: ${erro.message}`)

  const linhas = contatos.data ?? []

  const funil = ORDEM_FUNIL.map((stage) => ({
    stage,
    label: ROTULO_FUNIL[stage],
    total: linhas.filter((c) => c.funnel_stage === stage).length,
  }))

  const porIntencao = (Object.keys(ROTULO_INTENCAO) as Intent[]).map((intent) => ({
    intent,
    label: ROTULO_INTENCAO[intent],
    total: linhas.filter((c) => c.intent === intent).length,
  }))

  const pagos = pagamentos.data ?? []

  return {
    funil,
    porIntencao,
    leadsAtivos: linhas.filter(
      (c) => c.funnel_stage !== 'convertido' && c.funnel_stage !== 'perdido'
    ).length,

    visitasSemana: (visitas.data ?? []).map((v) => {
      /* O join do PostgREST devolve objeto para relacao muitos-para-um, mas os
         tipos gerados nao sabem disso — dai o unknown no meio. */
      const contato = v.contacts as unknown as { name: string | null } | null
      const imovel = v.properties as unknown as {
        reference_code: string | null
        region: string | null
      } | null
      const corretor = v.brokers as unknown as { name: string | null } | null

      return {
        id: v.id,
        quando: v.scheduled_at,
        status: v.status,
        lead: contato?.name ?? 'Contato sem nome',
        imovel: [imovel?.reference_code, imovel?.region].filter(Boolean).join(' · ') || '—',
        corretor: corretor?.name ?? 'Sem corretor',
      }
    }),

    filaAprovacao: (aprovacoes.data ?? []).map((a) => {
      const imovel = a.properties as unknown as {
        reference_code: string | null
        region: string | null
        title: string | null
      } | null

      return {
        id: a.id,
        tipo: a.type,
        label:
          a.type === 'aprovacao_listagem_imovel'
            ? 'Listagem de imóvel'
            : a.type === 'aprovacao_locacao'
              ? 'Locação'
              : 'Venda',
        descricao:
          a.notes ??
          [imovel?.reference_code, imovel?.region, imovel?.title].filter(Boolean).join(' · ') ??
          '—',
        desde: a.created_at,
      }
    }),

    documentosPendentes: documentos.count ?? 0,

    cobrancas: {
      atrasadas: pagos.filter((p) => p.status === 'atrasado').length,
      valorAtrasadoCents: pagos
        .filter((p) => p.status === 'atrasado')
        .reduce((acc, p) => acc + (p.amount_cents ?? 0), 0),
      recebidoMesCents: pagos
        .filter((p) => p.status === 'pago' && p.paid_at && new Date(p.paid_at) >= inicioDoMes)
        .reduce((acc, p) => acc + (p.amount_cents ?? 0), 0),
    },
  }
}

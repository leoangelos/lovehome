import { createAdminClient } from '@/lib/supabase/admin'
import { ordenarPropostas } from '@/lib/negocios/propostas'
import type { DealStatus, DealType, DocumentStatus } from '@/lib/types/domain'

/* Leituras das telas de contratos e documentos.
   Nenhuma seleciona cpf_hash ou cpf_encrypted — só cpf_last4, para mascarar. */

export interface DocumentoLinha {
  id: string
  type: string
  status: DocumentStatus
  storage_path: string
  rejection_reason: string | null
  created_at: string
  reviewed_at: string | null
  cliente: string | null
  cliente_cpf_last4: string | null
  deal_id: string | null
  imovel: string | null
}

export { ROTULO_DOCUMENTO } from '@/lib/ui/rotulos'

export async function listarDocumentos(brokerId?: string | null): Promise<DocumentoLinha[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('documents')
    .select(
      `id, type, status, storage_path, rejection_reason, created_at, reviewed_at, deal_id,
       registrations ( full_name, cpf_last4 ),
       deals ( broker_id, properties ( reference_code, region ) )`
    )
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(`Falha ao listar documentos: ${error.message}`)

  const linhas = (data ?? []).map((d) => {
    const cadastro = d.registrations as unknown as {
      full_name: string
      cpf_last4: string
    } | null
    const negocio = d.deals as unknown as {
      broker_id: string | null
      properties: { reference_code: string; region: string } | null
    } | null

    return {
      id: d.id,
      type: d.type,
      status: d.status as DocumentStatus,
      storage_path: d.storage_path,
      rejection_reason: d.rejection_reason,
      created_at: d.created_at,
      reviewed_at: d.reviewed_at,
      cliente: cadastro?.full_name ?? null,
      cliente_cpf_last4: cadastro?.cpf_last4 ?? null,
      deal_id: d.deal_id,
      imovel: negocio?.properties
        ? `${negocio.properties.reference_code} · ${negocio.properties.region}`
        : null,
      _broker: negocio?.broker_id ?? null,
    }
  })

  /* Escopo por corretor filtrado aqui, não no SQL: o vínculo passa pelo deal, e
     o PostgREST não filtra por coluna de tabela aninhada num select simples. */
  return (brokerId ? linhas.filter((l) => l._broker === brokerId) : linhas).map(
    ({ _broker, ...resto }) => {
      void _broker
      return resto
    }
  )
}

export interface NegocioLinha {
  id: string
  deal_type: DealType
  status: DealStatus
  created_at: string
  valor_cents: number | null
  imovel: string | null
  imovel_titulo: string | null
  cliente: string | null
  cliente_cpf_last4: string | null
  corretor: string | null
  financing_type: string | null
  documentos_solicitados: string[]
  documentos_recebidos: { type: string; status: DocumentStatus }[]
  aprovacao_pendente: boolean
  contract_signed_at: string | null
  tem_contrato: boolean
  tem_assinado: boolean
  signature_method: string | null
  signed_returned_via: string | null
  /** Motivo de recusa/desfazimento — aparece no cartão de negócio cancelado. */
  recusa_motivo: string | null
  /** Condições que o contrato lê — editáveis no cartão até a assinatura. */
  down_payment_cents: number | null
  itbi_status: string | null
  start_date: string | null
  end_date: string | null
  notice_period_days: number | null
  /** Posição desta proposta na fila do imóvel (1 = avaliar primeiro). Null fora de 'proposta'. */
  fila_posicao: number | null
  fila_tamanho: number | null
}

export async function listarNegocios(brokerId?: string | null): Promise<NegocioLinha[]> {
  const supabase = createAdminClient()

  let consulta = supabase
    .from('deals')
    .select(
      `id, deal_type, status, created_at, rent_price_cents, sale_price_cents, financing_type,
       documentos_solicitados, contract_signed_at, broker_id, property_id,
       proposta_avaliada_em, recusa_motivo,
       down_payment_cents, itbi_status, start_date, end_date, notice_period_days,
       contract_document_url, signed_document_url, signature_method, signed_returned_via,
       properties ( reference_code, region, title ),
       registrations!deals_client_registration_id_fkey ( full_name, cpf_last4 ),
       brokers ( name )`
    )
    .order('created_at', { ascending: false })
    .limit(200)

  if (brokerId) consulta = consulta.eq('broker_id', brokerId)

  const { data, error } = await consulta
  if (error) throw new Error(`Falha ao listar negócios: ${error.message}`)

  const ids = (data ?? []).map((d) => d.id)

  const [{ data: documentos }, { data: aprovacoes }] = await Promise.all([
    ids.length
      ? supabase.from('documents').select('deal_id, type, status').in('deal_id', ids)
      : Promise.resolve({ data: [] }),
    ids.length
      ? supabase
          .from('approval_requests')
          .select('deal_id, status')
          .in('deal_id', ids)
          .eq('status', 'pendente')
      : Promise.resolve({ data: [] }),
  ])

  /* Fila por imóvel: enquanto nenhuma proposta do imóvel foi avaliada, a de
     maior valor vem primeiro; depois da primeira avaliação, ordem de chegada.
     Calculado aqui para a tela mostrar "1ª na fila" sem refazer a regra. */
  const posicaoPorDeal = new Map<string, { posicao: number; total: number }>()
  const porImovel = new Map<string, typeof data>()
  for (const d of data ?? []) {
    if (!d.property_id) continue
    if (!porImovel.has(d.property_id)) porImovel.set(d.property_id, [])
    porImovel.get(d.property_id)!.push(d)
  }
  for (const linhas of porImovel.values()) {
    const pendentes = (linhas ?? [])
      .filter((d) => d.status === 'proposta')
      .map((d) => ({
        id: d.id,
        valorCents: d.deal_type === 'locacao' ? d.rent_price_cents : d.sale_price_cents,
        createdAt: d.created_at,
      }))
    if (pendentes.length === 0) continue
    const jaAvaliou = (linhas ?? []).some((d) => d.proposta_avaliada_em)
    ordenarPropostas(pendentes, jaAvaliou).forEach((p, i) =>
      posicaoPorDeal.set(p.id, { posicao: i + 1, total: pendentes.length })
    )
  }

  return (data ?? []).map((d) => {
    const imovel = d.properties as unknown as {
      reference_code: string
      region: string
      title: string
    } | null
    const cliente = d.registrations as unknown as {
      full_name: string
      cpf_last4: string
    } | null
    const corretor = d.brokers as unknown as { name: string } | null

    return {
      id: d.id,
      deal_type: d.deal_type as DealType,
      status: d.status as DealStatus,
      created_at: d.created_at,
      valor_cents: d.deal_type === 'locacao' ? d.rent_price_cents : d.sale_price_cents,
      imovel: imovel ? `${imovel.reference_code} · ${imovel.region}` : null,
      imovel_titulo: imovel?.title ?? null,
      cliente: cliente?.full_name ?? null,
      cliente_cpf_last4: cliente?.cpf_last4 ?? null,
      corretor: corretor?.name ?? null,
      financing_type: d.financing_type,
      documentos_solicitados: (d.documentos_solicitados ?? []) as string[],
      documentos_recebidos: (documentos ?? [])
        .filter((doc) => doc.deal_id === d.id)
        .map((doc) => ({ type: doc.type, status: doc.status as DocumentStatus })),
      aprovacao_pendente: (aprovacoes ?? []).some((a) => a.deal_id === d.id),
      contract_signed_at: d.contract_signed_at,
      /* Booleano em vez do caminho: o caminho do storage não serve para nada no
         cliente (bucket privado) e só ampliaria a superfície exposta. O download
         sai por URL assinada, pedida sob demanda. */
      tem_contrato: Boolean(d.contract_document_url),
      tem_assinado: Boolean(d.signed_document_url),
      signature_method: d.signature_method,
      signed_returned_via: d.signed_returned_via,
      recusa_motivo: d.recusa_motivo ?? null,
      down_payment_cents: d.down_payment_cents ?? null,
      itbi_status: d.itbi_status ?? null,
      start_date: d.start_date ?? null,
      end_date: d.end_date ?? null,
      notice_period_days: d.notice_period_days ?? null,
      fila_posicao: posicaoPorDeal.get(d.id)?.posicao ?? null,
      fila_tamanho: posicaoPorDeal.get(d.id)?.total ?? null,
    }
  })
}

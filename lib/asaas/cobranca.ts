// ==========================================
// Assinatura recorrente de aluguel e sincronização das parcelas (PRD 14.3).
//
// O ciclo: ativar um contrato de LOCAÇÃO cria uma assinatura mensal no Asaas;
// as parcelas que o Asaas gera viram linhas em `lease_payments`, e o webhook
// mantém o status delas em dia.
//
// Venda NÃO gera assinatura — não há mensalidade a acompanhar. É por isso que
// `criarAssinaturaDoNegocio` recusa `deal_type = 'venda'` em vez de silenciar:
// silenciar deixaria alguém esperando uma cobrança que nunca viria.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { chamarAsaas } from './client'
import { garantirClienteAsaas } from './customers'

export type ResultadoAssinatura =
  | { ok: true; subscriptionId: string; parcelas: number; jaExistia: boolean }
  | { ok: false; erro: string }

interface AssinaturaAsaas {
  id: string
}

interface CobrancaAsaas {
  id: string
  value: number
  dueDate: string
  status: string
  bankSlipUrl?: string | null
  invoiceUrl?: string | null
  paymentDate?: string | null
}

/** `status` do Asaas → `lease_payments.status`. */
export function traduzirStatus(asaas: string): 'pendente' | 'pago' | 'atrasado' | 'cancelado' {
  switch (asaas) {
    case 'RECEIVED':
    case 'CONFIRMED':
    case 'RECEIVED_IN_CASH':
      return 'pago'
    case 'OVERDUE':
      return 'atrasado'
    case 'REFUNDED':
    case 'DELETED':
    case 'CHARGEBACK_REQUESTED':
    case 'REFUND_REQUESTED':
      return 'cancelado'
    default:
      /* PENDING, AWAITING_RISK_ANALYSIS e qualquer status novo que o Asaas
         invente caem em 'pendente'. Adivinhar 'pago' por engano seria pior:
         cobrança some da inadimplência sem ter sido recebida. */
      return 'pendente'
  }
}

export async function criarAssinaturaDoNegocio(dealId: string): Promise<ResultadoAssinatura> {
  const supabase = createAdminClient()

  const { data: negocio } = await supabase
    .from('deals')
    .select('id, deal_type, status, rent_price_cents, start_date, client_registration_id, asaas_subscription_id')
    .eq('id', dealId)
    .maybeSingle()

  if (!negocio) return { ok: false, erro: 'Negócio não encontrado.' }

  if (negocio.deal_type !== 'locacao') {
    return { ok: false, erro: 'Só contrato de locação gera cobrança recorrente.' }
  }

  if (negocio.status !== 'ativo') {
    /* A assinatura nasce da ativação, que é o passo que tira o imóvel do
       mercado. Criar antes cobraria alguém por um contrato ainda não assinado. */
    return { ok: false, erro: 'O contrato precisa estar ativo para gerar a cobrança.' }
  }

  if (!negocio.rent_price_cents) return { ok: false, erro: 'O negócio não tem valor de aluguel.' }
  if (!negocio.client_registration_id) return { ok: false, erro: 'O negócio não tem cliente.' }

  // Idempotente: reativar ou reprocessar não cria uma segunda assinatura.
  if (negocio.asaas_subscription_id) {
    const parcelas = await sincronizarParcelas(negocio.id, negocio.asaas_subscription_id)
    return {
      ok: true,
      subscriptionId: negocio.asaas_subscription_id,
      parcelas,
      jaExistia: true,
    }
  }

  const cliente = await garantirClienteAsaas(negocio.client_registration_id)
  if (!cliente.ok) return { ok: false, erro: cliente.erro }

  /* Primeiro vencimento: o dia do início do contrato, no mês seguinte se a data
     já passou. Cobrar com vencimento retroativo nasce atrasado no mesmo dia. */
  const inicio = negocio.start_date ? new Date(`${negocio.start_date}T12:00:00`) : new Date()
  const primeiro = new Date(inicio)
  if (primeiro.getTime() < Date.now()) {
    primeiro.setMonth(primeiro.getMonth() + 1)
  }

  const r = await chamarAsaas<AssinaturaAsaas>('/subscriptions', {
    method: 'POST',
    body: {
      customer: cliente.customerId,
      billingType: 'BOLETO',
      value: negocio.rent_price_cents / 100,
      nextDueDate: primeiro.toISOString().slice(0, 10),
      cycle: 'MONTHLY',
      description: `Aluguel — contrato ${negocio.id.slice(0, 8)}`,
      externalReference: negocio.id,
    },
  })

  if (!r.ok || !r.dados?.id) return { ok: false, erro: r.erro ?? 'O Asaas não devolveu a assinatura.' }

  const { error } = await supabase
    .from('deals')
    .update({ asaas_subscription_id: r.dados.id, updated_at: new Date().toISOString() })
    .eq('id', negocio.id)

  if (error) {
    console.error('[asaas] assinatura criada mas não gravada:', r.dados.id, error.message)
    return { ok: false, erro: 'Assinatura criada no Asaas, mas não foi possível vinculá-la.' }
  }

  const parcelas = await sincronizarParcelas(negocio.id, r.dados.id)
  console.log(`[asaas] assinatura ${r.dados.id} criada para o negócio ${negocio.id} (${parcelas} parcela(s))`)

  return { ok: true, subscriptionId: r.dados.id, parcelas, jaExistia: false }
}

/**
 * Traz as parcelas da assinatura e reflete em `lease_payments`.
 *
 * O Asaas é a fonte de verdade do valor e do vencimento; o banco daqui é a
 * cópia que o painel lê. Por isso é upsert por `(deal_id, reference_month)` —
 * a UNIQUE que já existia no schema — e não insert.
 */
export async function sincronizarParcelas(dealId: string, subscriptionId: string): Promise<number> {
  const supabase = createAdminClient()

  const r = await chamarAsaas<{ data: CobrancaAsaas[] }>(
    `/subscriptions/${subscriptionId}/payments`,
    { query: { limit: 50 } }
  )

  if (!r.ok || !r.dados?.data?.length) return 0

  const linhas = r.dados.data.map((c) => ({
    deal_id: dealId,
    /* O mês de referência é o do VENCIMENTO. Usar o mês da geração faria a
       parcela de janeiro vencida em fevereiro aparecer duas vezes na mesma
       competência quando o ciclo virasse. */
    reference_month: `${c.dueDate.slice(0, 7)}-01`,
    amount_cents: Math.round(c.value * 100),
    status: traduzirStatus(c.status),
    due_date: c.dueDate,
    paid_at: c.paymentDate ? new Date(`${c.paymentDate}T12:00:00`).toISOString() : null,
    asaas_payment_id: c.id,
    boleto_url: c.bankSlipUrl ?? c.invoiceUrl ?? null,
  }))

  const { error } = await supabase
    .from('lease_payments')
    .upsert(linhas, { onConflict: 'deal_id,reference_month' })

  if (error) {
    console.error('[asaas] sincronização de parcelas falhou:', error.message)
    return 0
  }

  return linhas.length
}

/** Cancela a assinatura — usado ao encerrar o contrato e pela limpeza do teste. */
export async function cancelarAssinatura(subscriptionId: string): Promise<boolean> {
  const r = await chamarAsaas(`/subscriptions/${subscriptionId}`, { method: 'DELETE' })
  return r.ok
}

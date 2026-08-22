// ==========================================
// Condições do negócio — o que o contrato lê de `deals` e ninguém preenchia.
//
// O gerador de contrato avisava "campos faltando: valor do sinal, forma de
// pagamento" e não existia tela para preencher: o financing_type só entrava
// se o agente tivesse capturado na conversa, e o sinal nunca era gravado por
// ninguém. Aqui fica a validação (pura, testável) e a gravação.
//
// O que pode ser editado depende do tipo: venda tem preço, sinal, forma de
// pagamento e ITBI; locação tem aluguel, início, término e aviso prévio. As
// colunas do outro tipo são NULL por CHECK do banco — por isso o validador é
// por tipo e nunca grava coluna cruzada.
//
// Até quando: enquanto o contrato não foi ASSINADO. Mudar preço ou data depois
// da assinatura é outro documento, não uma edição.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { MAX_CENTAVOS } from '@/lib/utils/dinheiro'

export type Resultado = { ok: true } | { ok: false; erro: string; status: number }

export const FORMAS_PAGAMENTO = ['a_vista', 'financiado', 'consorcio'] as const
export type FormaPagamento = (typeof FORMAS_PAGAMENTO)[number]

export interface EntradaCondicoes {
  // venda
  sale_price_cents?: number | null
  down_payment_cents?: number | null
  financing_type?: FormaPagamento | null
  itbi_status?: 'pendente' | 'pago' | null
  // locação
  rent_price_cents?: number | null
  start_date?: string | null
  end_date?: string | null
  notice_period_days?: number | null
}

const DATA = /^\d{4}-\d{2}-\d{2}$/

/* As colunas *_cents são INTEGER: acima de R$ 21.474.836,47 o banco recusa com
   "out of range" — melhor dizer isso aqui do que devolver erro genérico. */
const TETO = 'Valor acima do limite do sistema (R$ 21.474.836,47). Confira se digitou centavos a mais.'

function inteiro(v: unknown): number | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : NaN
}

/**
 * Regra pura: devolve só as colunas válidas para o tipo, normalizadas — ou o
 * erro. Campo ausente na entrada não é tocado; null limpa.
 */
export function validarCondicoes(
  dealType: 'locacao' | 'venda',
  entrada: EntradaCondicoes,
  atual: { sale_price_cents?: number | null; rent_price_cents?: number | null; start_date?: string | null }
): { ok: true; campos: Record<string, unknown> } | { ok: false; erro: string } {
  const campos: Record<string, unknown> = {}

  if (dealType === 'venda') {
    const preco = inteiro(entrada.sale_price_cents)
    if (preco !== undefined) {
      if (preco === null || Number.isNaN(preco) || preco <= 0) return { ok: false, erro: 'Valor de venda precisa ser maior que zero.' }
      if (preco > MAX_CENTAVOS) return { ok: false, erro: TETO }
      campos.sale_price_cents = preco
    }
    const sinal = inteiro(entrada.down_payment_cents)
    if (sinal !== undefined) {
      if (Number.isNaN(sinal) || (sinal !== null && sinal < 0)) return { ok: false, erro: 'Sinal inválido.' }
      if (sinal !== null && sinal > MAX_CENTAVOS) return { ok: false, erro: TETO }
      const base = (campos.sale_price_cents as number | undefined) ?? atual.sale_price_cents ?? null
      if (sinal !== null && base !== null && sinal > base) return { ok: false, erro: 'O sinal não pode ser maior que o valor de venda.' }
      campos.down_payment_cents = sinal
    }
    if (entrada.financing_type !== undefined) {
      if (entrada.financing_type !== null && !FORMAS_PAGAMENTO.includes(entrada.financing_type)) {
        return { ok: false, erro: 'Forma de pagamento inválida.' }
      }
      campos.financing_type = entrada.financing_type
    }
    if (entrada.itbi_status !== undefined) {
      if (entrada.itbi_status !== null && entrada.itbi_status !== 'pendente' && entrada.itbi_status !== 'pago') {
        return { ok: false, erro: 'Situação do ITBI inválida.' }
      }
      campos.itbi_status = entrada.itbi_status
    }
    return { ok: true, campos }
  }

  const aluguel = inteiro(entrada.rent_price_cents)
  if (aluguel !== undefined) {
    if (aluguel === null || Number.isNaN(aluguel) || aluguel <= 0) return { ok: false, erro: 'Aluguel precisa ser maior que zero.' }
    if (aluguel > MAX_CENTAVOS) return { ok: false, erro: TETO }
    campos.rent_price_cents = aluguel
  }
  if (entrada.start_date !== undefined) {
    if (entrada.start_date !== null && entrada.start_date !== '' && !DATA.test(entrada.start_date)) return { ok: false, erro: 'Data de início inválida.' }
    campos.start_date = entrada.start_date || null
  }
  if (entrada.end_date !== undefined) {
    if (entrada.end_date !== null && entrada.end_date !== '' && !DATA.test(entrada.end_date)) return { ok: false, erro: 'Data de término inválida.' }
    campos.end_date = entrada.end_date || null
  }
  const inicio = (campos.start_date as string | null | undefined) ?? atual.start_date ?? null
  const fim = campos.end_date as string | null | undefined
  if (fim && inicio && fim <= inicio) return { ok: false, erro: 'O término precisa ser depois do início.' }

  const aviso = inteiro(entrada.notice_period_days)
  if (aviso !== undefined) {
    if (aviso === null || Number.isNaN(aviso) || aviso < 0 || aviso > 365) return { ok: false, erro: 'Aviso prévio: informe de 0 a 365 dias.' }
    campos.notice_period_days = aviso
  }
  return { ok: true, campos }
}

export async function salvarCondicoes(dealId: string, entrada: EntradaCondicoes): Promise<Resultado> {
  const supabase = createAdminClient()

  const { data: n } = await supabase
    .from('deals')
    .select('id, deal_type, status, contract_signed_at, sale_price_cents, rent_price_cents, start_date')
    .eq('id', dealId)
    .maybeSingle()
  if (!n) return { ok: false, erro: 'Negócio não encontrado.', status: 404 }

  if (n.contract_signed_at) {
    return { ok: false, erro: 'Contrato já assinado — as condições não mudam mais por aqui.', status: 409 }
  }
  if (!['proposta', 'em_aprovacao', 'aprovado'].includes(n.status)) {
    return { ok: false, erro: `Negócio "${n.status}" não aceita edição de condições.`, status: 409 }
  }

  const v = validarCondicoes(n.deal_type as 'locacao' | 'venda', entrada, n)
  if (!v.ok) return { ok: false, erro: v.erro, status: 400 }
  if (Object.keys(v.campos).length === 0) return { ok: true }

  const { error } = await supabase
    .from('deals')
    .update({ ...v.campos, updated_at: new Date().toISOString() })
    .eq('id', dealId)
  if (error) {
    /* O motivo do Postgres fica no log, não na tela (pode carregar nome de
       coluna e valor). Sem isto, "não foi possível salvar" era um beco. */
    console.error('[condicoes] falha ao gravar:', error.code, error.message)
    return { ok: false, erro: 'Não foi possível salvar as condições.', status: 500 }
  }

  return { ok: true }
}

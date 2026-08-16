import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { escopoProprio } from '@/lib/auth/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { criarAssinaturaDoNegocio, sincronizarParcelas } from '@/lib/asaas/cobranca'

/* Sincroniza as parcelas de um contrato com o Asaas, ou cria a assinatura que
 * faltou.
 *
 * Existe porque o webhook não é a única fonte: enquanto a URL pública não está
 * no ar (antes do deploy) nenhum evento chega, e mesmo depois um evento pode se
 * perder. Puxar sob demanda é o que permite reconciliar sem esperar. */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request, { params }: { params: Promise<{ dealId: string }> }) {
  const auth = await autorizarApi('pagamentos', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { dealId } = await params
  const supabase = createAdminClient()

  const { data: negocio } = await supabase
    .from('deals')
    .select('id, deal_type, status, broker_id, asaas_subscription_id')
    .eq('id', dealId)
    .maybeSingle()

  if (!negocio) return NextResponse.json({ erro: 'Contrato não encontrado.' }, { status: 404 })

  if (escopoProprio(auth.sessao.role) && negocio.broker_id !== auth.sessao.brokerId) {
    return NextResponse.json({ erro: 'Este contrato não é da sua carteira.' }, { status: 403 })
  }

  /* Sem assinatura, sincronizar não teria o que buscar — o que falta é criar.
     `criarAssinaturaDoNegocio` é idempotente e já sincroniza no fim. */
  if (!negocio.asaas_subscription_id) {
    const r = await criarAssinaturaDoNegocio(dealId)
    if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 422 })

    console.log(`[pagamentos] ${auth.sessao.email} criou a cobrança do contrato ${dealId}`)
    return NextResponse.json({ ok: true, criou: true, parcelas: r.parcelas })
  }

  const parcelas = await sincronizarParcelas(dealId, negocio.asaas_subscription_id)
  console.log(`[pagamentos] ${auth.sessao.email} sincronizou ${dealId}: ${parcelas} parcela(s)`)
  return NextResponse.json({ ok: true, criou: false, parcelas })
}

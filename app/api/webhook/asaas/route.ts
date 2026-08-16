// ==========================================
// Webhook do Asaas (PRD 14.2).
//
// Padrão de webhook de pagamento: token pré-compartilhado no
// header, comparado em tempo constante contra a credencial cifrada, dedup por
// id externo, e o payload cru guardado para conciliação.
//
// Diferença em relação aos webhooks de mensagem: aqui não há agente nem custo
// de LLM — é atualização de estado financeiro. O que importa é não aplicar duas
// vezes e não perder evento.
// ==========================================

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { tokenWebhook } from '@/lib/asaas/client'
import { traduzirStatus } from '@/lib/asaas/cobranca'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/* Eventos que mexem no estado de uma cobrança. Os demais (assinatura criada,
   nota fiscal, transferência) chegam pelo mesmo endpoint e são registrados sem
   ação — guardar tudo é o que permite conciliar depois. */
const EVENTOS_DE_COBRANCA = new Set([
  'PAYMENT_CREATED',
  'PAYMENT_UPDATED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_RECEIVED_IN_CASH',
  'PAYMENT_OVERDUE',
  'PAYMENT_DELETED',
  'PAYMENT_REFUNDED',
  'PAYMENT_RESTORED',
])

function comparaSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}

interface PayloadAsaas {
  id?: string
  event?: string
  payment?: {
    id?: string
    status?: string
    value?: number
    dueDate?: string
    paymentDate?: string | null
    bankSlipUrl?: string | null
    invoiceUrl?: string | null
    subscription?: string | null
    externalReference?: string | null
  }
}

export async function POST(req: Request) {
  const esperado = await tokenWebhook()

  /* Sem token configurado, NÃO passa. A alternativa — aceitar enquanto ninguém
     configurou — deixaria qualquer um marcar aluguel como pago mandando um POST
     para uma URL pública. */
  if (!esperado) {
    console.error('[webhook/asaas] recusado: token do webhook não configurado')
    return NextResponse.json({ error: 'Integração não configurada' }, { status: 403 })
  }

  const recebido = req.headers.get('asaas-access-token')
  if (!recebido || !comparaSeguro(recebido, esperado)) {
    console.error('[webhook/asaas] token inválido')
    return NextResponse.json({ error: 'Token inválido' }, { status: 401 })
  }

  let payload: PayloadAsaas
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const evento = payload.event
  const cobranca = payload.payment

  if (!evento) return NextResponse.json({ status: 'sem_evento' })

  const supabase = createAdminClient()

  /* Dedup ANTES de aplicar. O insert com UNIQUE(event, asaas_payment_id) é a
     trava: se a linha já existe, o Asaas está reentregando e não há o que
     fazer de novo. */
  const { error: erroDedup } = await supabase.from('asaas_events').insert({
    event: evento,
    asaas_payment_id: cobranca?.id ?? null,
    asaas_event_id: payload.id ?? null,
    payload,
  })

  if (erroDedup) {
    if (erroDedup.code === '23505') {
      return NextResponse.json({ status: 'duplicado' })
    }
    console.error('[webhook/asaas] não foi possível registrar o evento:', erroDedup.message)
    /* 200 mesmo assim: o Asaas reentrega em não-2xx e desativa o webhook depois
       de muitas falhas. Perder um evento é melhor do que perder o canal. */
    return NextResponse.json({ status: 'erro_registrado' })
  }

  if (!EVENTOS_DE_COBRANCA.has(evento) || !cobranca?.id) {
    await marcar(evento, cobranca?.id, false, 'evento sem efeito sobre cobrança')
    return NextResponse.json({ status: 'registrado' })
  }

  // ---- Aplica na parcela ----
  const { data: parcela } = await supabase
    .from('lease_payments')
    .select('id, deal_id, status')
    .eq('asaas_payment_id', cobranca.id)
    .maybeSingle()

  if (!parcela) {
    /* Cobrança que o sistema não conhece: criada direto no painel do Asaas, ou
       de uma assinatura que ainda não sincronizou. Fica registrada como não
       aplicada — é o sinal de que há algo a conciliar, não de que o webhook
       falhou. */
    await marcar(evento, cobranca.id, false, 'nenhuma parcela com este asaas_payment_id')
    console.log(`[webhook/asaas] ${evento} sem parcela correspondente: ${cobranca.id}`)
    return NextResponse.json({ status: 'sem_correspondencia' })
  }

  const novoStatus = traduzirStatus(cobranca.status ?? '')

  const { error: erroUpdate } = await supabase
    .from('lease_payments')
    .update({
      status: novoStatus,
      paid_at: cobranca.paymentDate
        ? new Date(`${cobranca.paymentDate}T12:00:00`).toISOString()
        : novoStatus === 'pago'
          ? new Date().toISOString()
          : null,
      boleto_url: cobranca.bankSlipUrl ?? cobranca.invoiceUrl ?? undefined,
    })
    .eq('id', parcela.id)

  if (erroUpdate) {
    await marcar(evento, cobranca.id, false, erroUpdate.message)
    console.error('[webhook/asaas] atualização falhou:', erroUpdate.message)
    return NextResponse.json({ status: 'erro_registrado' })
  }

  await marcar(evento, cobranca.id, true, `${parcela.status} → ${novoStatus}`)
  console.log(`[webhook/asaas] ${evento}: parcela ${parcela.id} ${parcela.status} → ${novoStatus}`)

  return NextResponse.json({ status: 'aplicado', de: parcela.status, para: novoStatus })
}

async function marcar(
  evento: string,
  paymentId: string | null | undefined,
  aplicado: boolean,
  observacao: string
) {
  const supabase = createAdminClient()
  let consulta = supabase.from('asaas_events').update({ aplicado, observacao }).eq('event', evento)

  consulta = paymentId
    ? consulta.eq('asaas_payment_id', paymentId)
    : consulta.is('asaas_payment_id', null)

  await consulta
}

/* O Asaas não faz verificação por GET como a Meta, mas bate no endpoint ao
   cadastrar para conferir que ele existe. Responder 200 evita que o painel
   deles recuse a URL. */
export async function GET() {
  return NextResponse.json({ status: 'ok', servico: 'webhook asaas' })
}

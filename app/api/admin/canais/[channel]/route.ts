import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { salvarConfigCanal } from '@/lib/channels/salvar-config'
import { testarCanal } from '@/lib/channels/testar'
import type { IntegrationChannel } from '@/lib/channels/types'

/* Credenciais de canal (PRD 13 e 17.1).
 *
 * `canais` + `editar` — na §9.2 só o admin, e viewer nem vê a tela: aqui moram
 * os segredos que dão acesso ao WhatsApp da imobiliária.
 *
 * A gravação cifrada é de lib/channels/salvar-config.ts. Esta rota não toca em
 * segredo além de repassá-lo. */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const CANAIS: IntegrationChannel[] = ['zapi', 'meta', 'widget', 'asaas', 'crm']

export async function PATCH(request: Request, { params }: { params: Promise<{ channel: string }> }) {
  const auth = await autorizarApi('canais', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { channel } = await params
  if (!CANAIS.includes(channel as IntegrationChannel)) {
    return NextResponse.json({ erro: 'Canal desconhecido.' }, { status: 404 })
  }

  let corpo: Record<string, unknown>
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  const r = await salvarConfigCanal(
    channel as IntegrationChannel,
    {
      isActive: typeof corpo.isActive === 'boolean' ? corpo.isActive : undefined,
      displayName: corpo.displayName as string | undefined,
      phoneId: corpo.phoneId as string | undefined,
      businessId: corpo.businessId as string | undefined,
      notes: corpo.notes as string | undefined,
      webhookUrl: corpo.webhookUrl as string | undefined,
      accessToken: corpo.accessToken as string | undefined,
      appSecret: corpo.appSecret as string | undefined,
      verifyToken: corpo.verifyToken as string | undefined,
      clientToken: corpo.clientToken as string | undefined,
    },
    auth.sessao.userId
  )

  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 500 })
  return NextResponse.json({ ok: true })
}

/* Teste de conexão. É POST e não GET porque faz chamada externa e não deve
   cair em cache de navegador nem em prefetch. */
export async function POST(_request: Request, { params }: { params: Promise<{ channel: string }> }) {
  const auth = await autorizarApi('canais')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { channel } = await params
  if (!CANAIS.includes(channel as IntegrationChannel)) {
    return NextResponse.json({ erro: 'Canal desconhecido.' }, { status: 404 })
  }

  const r = await testarCanal(channel as IntegrationChannel)
  console.log(`[canais] ${auth.sessao.email} testou ${channel}: ${r.ok ? 'ok' : 'falhou'}`)
  return NextResponse.json(r)
}

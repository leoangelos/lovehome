import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { escopoProprio } from '@/lib/auth/permissions'
import { responderComoHumano } from '@/lib/conversas/takeover'
import { buscarConversa } from '@/lib/queries/conversas'

/* Resposta escrita por uma pessoa, entregue pelo canal da conversa.
 *
 * Só funciona com a conversa assumida — `responderComoHumano` recusa o resto.
 * Ver o cabeçalho de lib/conversas/takeover.ts para o porquê: o agente não
 * enxerga o que o humano escreveu, então bot ativo + humano respondendo é
 * garantia de contradição na frente do cliente. */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('conversas', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params

  let corpo: { texto?: string }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  const conversa = await buscarConversa(id)
  if (!conversa) return NextResponse.json({ erro: 'Conversa não encontrada.' }, { status: 404 })

  if (escopoProprio(auth.sessao.role) && conversa.contato.broker_id !== auth.sessao.brokerId) {
    return NextResponse.json({ erro: 'Esta conversa não é da sua carteira.' }, { status: 403 })
  }

  const r = await responderComoHumano({
    conversationId: id,
    userId: auth.sessao.userId,
    email: auth.sessao.email,
    nome: auth.sessao.nome,
    texto: corpo.texto ?? '',
  })

  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true })
}

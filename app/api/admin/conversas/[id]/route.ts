import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { escopoProprio } from '@/lib/auth/permissions'
import { assumirConversa, devolverAoBot } from '@/lib/conversas/takeover'
import { buscarConversa } from '@/lib/queries/conversas'

/* Assumir a conversa ou devolvê-la ao bot (takeover humano, PRD 12/17).
 *
 * A regra mora em lib/conversas/takeover.ts — aqui só autorização, recorte por
 * carteira e tradução para HTTP. */

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('conversas', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params

  let corpo: { acao?: 'assumir' | 'devolver' }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  if (corpo.acao !== 'assumir' && corpo.acao !== 'devolver') {
    return NextResponse.json({ erro: 'Ação inválida.' }, { status: 400 })
  }

  /* Recorte por carteira: o corretor só mexe nas conversas atribuídas a ele.
     A rota é chamável direto, então esconder o botão não basta (§9.3). */
  const conversa = await buscarConversa(id)
  if (!conversa) return NextResponse.json({ erro: 'Conversa não encontrada.' }, { status: 404 })

  if (escopoProprio(auth.sessao.role) && conversa.contato.broker_id !== auth.sessao.brokerId) {
    return NextResponse.json({ erro: 'Esta conversa não é da sua carteira.' }, { status: 403 })
  }

  const dados = {
    conversationId: id,
    userId: auth.sessao.userId,
    email: auth.sessao.email,
  }

  const r = corpo.acao === 'assumir' ? await assumirConversa(dados) : await devolverAoBot(dados)

  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true })
}

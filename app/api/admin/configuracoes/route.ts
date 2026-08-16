import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { salvarConfiguracoes, type EntradaConfig } from '@/lib/config/app'

/* Configurações da aplicação (PRD 17.1).
 *
 * `configuracoes` + `editar` — na §9.2 isso é só o admin. Os valores daqui
 * mudam o comportamento do atendimento inteiro: janela de agrupamento de
 * mensagens, horário do follow-up, quanto tempo o bot fica calado depois de um
 * takeover. */

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request) {
  const auth = await autorizarApi('configuracoes', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  let corpo: EntradaConfig
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  const r = await salvarConfiguracoes(corpo, {
    userId: auth.sessao.userId,
    email: auth.sessao.email,
  })

  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true })
}

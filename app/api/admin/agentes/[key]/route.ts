import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { salvarAgente, restaurarPadrao } from '@/lib/agents/salvar-config'

/* Edição do prompt e dos parâmetros de um agente (PRD 12).
 *
 * `agentes` + `editar` — na matriz da §9.2 isso é só o admin. Prompt é o que
 * define o que o sistema diz a cliente: mudar aqui muda o atendimento inteiro
 * na próxima conversa. */

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const auth = await autorizarApi('agentes', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { key } = await params

  let corpo: {
    system_prompt?: string
    model?: string
    temperature?: number
    wa_display_name?: string | null
  }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  const r = await salvarAgente(key, corpo, {
    userId: auth.sessao.userId,
    email: auth.sessao.email,
  })

  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const auth = await autorizarApi('agentes', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { key } = await params
  const r = await restaurarPadrao(key, { email: auth.sessao.email })

  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true })
}

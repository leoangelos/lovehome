import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { decidirConferencia } from '@/lib/registrations/conferencia'

/* Decisão humana sobre uma submissão retida por CPF já cadastrado (PRD 6.5).
 * A regra mora em lib/registrations/conferencia.ts — aqui só autorização e
 * tradução para HTTP. */

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('formularios', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params

  let corpo: { acao?: 'vincular' | 'recusar'; motivo?: string }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  if (corpo.acao !== 'vincular' && corpo.acao !== 'recusar') {
    return NextResponse.json({ erro: 'Ação inválida.' }, { status: 400 })
  }

  const r = await decidirConferencia({
    submissaoId: id,
    acao: corpo.acao,
    motivo: corpo.motivo,
    decididoPor: auth.sessao.email,
  })

  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true })
}

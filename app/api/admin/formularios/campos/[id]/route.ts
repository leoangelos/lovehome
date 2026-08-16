import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { removerCampo } from '@/lib/registrations/campos'

/* Remoção de campo configurável (PRD 6.5).
 *
 * A recusa quando já há resposta mora em lib/registrations/campos.ts —
 * apagar a definição não apaga o dado, deixa ele sem rótulo no painel. */

export const dynamic = 'force-dynamic'

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('formularios', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params
  const r = await removerCampo(id, auth.sessao.email)

  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true })
}

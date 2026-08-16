import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { desbloquear } from '@/lib/channels/blocklist'

export const dynamic = 'force-dynamic'

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('configuracoes', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params
  const r = await desbloquear(id, auth.sessao.email)
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true })
}

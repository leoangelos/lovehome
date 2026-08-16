import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { alternarSite, removerSite } from '@/lib/channels/sites'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('canais', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params

  let corpo: { ativo?: boolean }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  if (typeof corpo.ativo !== 'boolean') {
    return NextResponse.json({ erro: 'Informe se o site fica ativo.' }, { status: 400 })
  }

  const r = await alternarSite(id, corpo.ativo, auth.sessao.email)
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('canais', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params
  const r = await removerSite(id, auth.sessao.email)
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true })
}

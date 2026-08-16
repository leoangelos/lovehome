import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { ativarTemplate, removerTemplate } from '@/lib/leasing/templates'

export const dynamic = 'force-dynamic'

export async function PATCH(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('contratos', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params
  const r = await ativarTemplate(id, auth.sessao.email)
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('contratos', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params
  const r = await removerTemplate(id, auth.sessao.email)
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true })
}

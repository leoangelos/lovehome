import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { removerMaterial } from '@/lib/rag/indexar'

/* Remoção de material institucional.
 *
 * Apagar aqui é o jeito de tirar do ar uma política que mudou: o agente para de
 * citá-la na conversa seguinte. Por isso é `editar` (admin e editor na §9.2) e
 * não uma ação de leitura disfarçada. */

export const dynamic = 'force-dynamic'

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('materiais', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params
  const r = await removerMaterial(id)

  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 404 })

  console.log(`[rag] ${auth.sessao.email} removeu o material ${id}`)
  return NextResponse.json({ ok: true })
}

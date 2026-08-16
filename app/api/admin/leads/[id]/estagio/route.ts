import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { escopoProprio } from '@/lib/auth/permissions'
import { moverEstagio } from '@/lib/leads/estagio'

/* Move o lead entre estágios do funil (arraste no Kanban).
 *
 * Exige `painel` + `editar`, que na §9.2 é admin e corretor. Viewer vê o quadro
 * e não move nada. */

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('painel', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params

  let corpo: { estagio?: string }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  const r = await moverEstagio({
    contactId: id,
    estagio: corpo.estagio ?? '',
    email: auth.sessao.email,
    brokerId: escopoProprio(auth.sessao.role) ? auth.sessao.brokerId : null,
  })

  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true, de: r.de, para: r.para })
}

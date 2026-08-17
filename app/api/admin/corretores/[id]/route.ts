import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { pode, escopoProprio } from '@/lib/auth/permissions'
import { salvarCorretor, type EntradaCorretor } from '@/lib/corretores/salvar'

/* Edição de corretor: contato, áreas de atuação e agenda semanal.
 *
 * Quem pode: admin (`corretores` + `editar` na matriz da §9.2) — e o PRÓPRIO
 * corretor, na própria ficha. A agenda é dele; exigir que o admin digite o
 * almoço de cada um é o jeito de a agenda ficar desatualizada. O recorte é o
 * mesmo da carteira: `sessao.brokerId` precisa ser o id da rota. */

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('corretores', 'ver')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params
  const { sessao } = auth

  const editaTodos = pode(sessao.role, 'corretores', 'editar')
  const editaProprio = escopoProprio(sessao.role) && sessao.brokerId === id
  if (!editaTodos && !editaProprio) {
    return NextResponse.json({ erro: 'Sem permissão.' }, { status: 403 })
  }

  let corpo: EntradaCorretor
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  /* Corretor não se desativa nem se reativa: isso é decisão de quem gere o
     time. O resto da ficha (contato, áreas, agenda) é dele. */
  if (!editaTodos) delete corpo.is_active

  const r = await salvarCorretor(id, corpo)
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true })
}

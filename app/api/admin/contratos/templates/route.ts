import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { salvarTemplate, type DealType } from '@/lib/leasing/templates'

/* Modelos de contrato (PRD 15.1).
 *
 * `contratos` + `editar` — na §9.2 isso é admin e corretor. O texto daqui vira
 * o documento que duas pessoas assinam; a validação de placeholder mora em
 * lib/leasing/templates.ts. */

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await autorizarApi('contratos', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  let corpo: { id?: string; deal_type?: string; name?: string; body_template?: string; is_active?: boolean }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  if (corpo.deal_type !== 'locacao' && corpo.deal_type !== 'venda') {
    return NextResponse.json({ erro: 'Tipo de contrato inválido.' }, { status: 400 })
  }

  const r = await salvarTemplate({
    id: corpo.id,
    deal_type: corpo.deal_type as DealType,
    name: corpo.name ?? '',
    body_template: corpo.body_template ?? '',
    is_active: corpo.is_active,
    email: auth.sessao.email,
  })

  if (!r.ok) return NextResponse.json({ erro: r.erro, detalhe: r.detalhe }, { status: r.status })
  return NextResponse.json({ ok: true, id: r.id })
}

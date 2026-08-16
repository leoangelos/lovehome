import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { salvarCampo, reordenarCampos } from '@/lib/registrations/campos'
import type { TipoCampo } from '@/lib/registrations/campos-formato'

/* Campos configuráveis do formulário público (PRD 6.5).
 *
 * `formularios` + `editar` — na §9.2 isso é só admin, e é o nível certo:
 * decidir que dado pessoal a empresa passa a coletar de todo cliente é decisão
 * de quem responde pela base, não de quem atende. */

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await autorizarApi('formularios', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  let corpo: {
    id?: string
    chave?: string
    rotulo?: string
    ajuda?: string
    tipo?: string
    opcoes?: string[]
    obrigatorio?: boolean
    papeis?: string[]
    is_active?: boolean
  }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  const TIPOS_ACEITOS = ['texto', 'texto_longo', 'numero', 'escolha', 'multipla', 'sim_nao', 'data']
  if (!corpo.tipo || !TIPOS_ACEITOS.includes(corpo.tipo)) {
    return NextResponse.json({ erro: 'Tipo de campo inválido.' }, { status: 400 })
  }

  const r = await salvarCampo({
    id: corpo.id,
    chave: corpo.chave ?? '',
    rotulo: corpo.rotulo ?? '',
    ajuda: corpo.ajuda,
    tipo: corpo.tipo as TipoCampo,
    opcoes: corpo.opcoes,
    obrigatorio: corpo.obrigatorio,
    papeis: corpo.papeis,
    is_active: corpo.is_active,
    email: auth.sessao.email,
  })

  if (!r.ok) {
    return NextResponse.json({ erro: r.erro, campo: r.campo }, { status: r.status })
  }
  return NextResponse.json({ ok: true, id: r.id })
}

/** Reordena — a tela manda a lista final de ids. */
export async function PATCH(request: Request) {
  const auth = await autorizarApi('formularios', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  let corpo: { ids?: string[] }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  if (!Array.isArray(corpo.ids) || corpo.ids.length === 0) {
    return NextResponse.json({ erro: 'Nada para reordenar.' }, { status: 400 })
  }

  const r = await reordenarCampos(corpo.ids, auth.sessao.email)
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: 500 })
  return NextResponse.json({ ok: true })
}

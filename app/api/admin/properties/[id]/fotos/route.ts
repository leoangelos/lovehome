import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { escopoProprio } from '@/lib/auth/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { adicionarFotos, salvarOrdemFotos } from '@/lib/imoveis/fotos'

/* Fotos do imóvel. A regra mora em lib/imoveis/fotos.ts — aqui só autorização,
 * recorte por carteira e tradução para HTTP.
 *
 * PATCH recebe o array inteiro e resolve ordem, capa e remoção de uma vez. */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Corretor só mexe no que é dele (§9.3). A rota é chamável direto. */
async function autorizar(id: string) {
  const auth = await autorizarApi('imoveis', 'editar')
  if ('erro' in auth) return { erro: auth.erro, status: auth.status } as const

  const { data: imovel } = await createAdminClient()
    .from('properties')
    .select('id, broker_id')
    .eq('id', id)
    .maybeSingle()

  if (!imovel) return { erro: 'Imóvel não encontrado.', status: 404 } as const

  if (escopoProprio(auth.sessao.role) && imovel.broker_id !== auth.sessao.brokerId) {
    return { erro: 'Este imóvel não é da sua carteira.', status: 403 } as const
  }

  return { auth } as const
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const permissao = await autorizar(id)
  if ('erro' in permissao) {
    return NextResponse.json({ erro: permissao.erro }, { status: permissao.status })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  const arquivos = form.getAll('fotos').filter((f): f is File => f instanceof File)
  const r = await adicionarFotos(id, arquivos)

  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })

  console.log(`[fotos] ${permissao.auth.sessao.email} enviou ${arquivos.length} foto(s) em ${id}`)
  return NextResponse.json({ ok: true, fotos: r.fotos })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const permissao = await autorizar(id)
  if ('erro' in permissao) {
    return NextResponse.json({ erro: permissao.erro }, { status: permissao.status })
  }

  let corpo: { fotos?: unknown }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  if (!Array.isArray(corpo.fotos) || corpo.fotos.some((f) => typeof f !== 'string')) {
    return NextResponse.json({ erro: 'Lista de fotos inválida.' }, { status: 400 })
  }

  const r = await salvarOrdemFotos(id, corpo.fotos as string[])
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })

  console.log(
    `[fotos] ${permissao.auth.sessao.email} atualizou ${id}: ${r.fotos.length} foto(s)` +
      (r.removidas ? `, ${r.removidas} removida(s)` : '')
  )
  return NextResponse.json({ ok: true, fotos: r.fotos })
}

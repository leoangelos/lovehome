import { NextResponse } from 'next/server'
import { submeterListagem } from '@/lib/imoveis/listagem'
import type { RascunhoListagem } from '@/lib/imoveis/listagem'

/* Submissão do formulário de listagem de imóvel (PRD 16).
   Recebe multipart porque carrega arquivos — o token vem no corpo, como no
   formulário de cadastro, e é a única credencial. */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  const token = form.get('token')
  const dadosCru = form.get('dados')

  if (typeof token !== 'string' || typeof dadosCru !== 'string') {
    return NextResponse.json({ erro: 'Requisição incompleta.' }, { status: 400 })
  }

  let dados: RascunhoListagem
  try {
    dados = JSON.parse(dadosCru)
  } catch {
    return NextResponse.json({ erro: 'Dados inválidos.' }, { status: 400 })
  }

  const fotos = form.getAll('fotos').filter((f): f is File => f instanceof File && f.size > 0)

  try {
    const resultado = await submeterListagem({ token, dados, fotos })
    if (!resultado.ok) return NextResponse.json({ erro: resultado.erro }, { status: 400 })

    return NextResponse.json({ ok: true, codigo: resultado.codigo, fotos: resultado.fotos })
  } catch (e) {
    console.error('[api/public/property-listing] falha:', (e as Error).message)
    return NextResponse.json({ erro: 'Erro ao enviar o imóvel.' }, { status: 500 })
  }
}

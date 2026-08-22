import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { negocioDaCarteira } from '@/lib/auth/carteira'
import { confirmarViaAssinada, rejeitarViaAssinada, urlViaAssinadaCandidata } from '@/lib/leasing/via-assinada'

/* Via assinada que chegou pelo WhatsApp e espera uma pessoa conferir.
   GET abre o PDF (URL assinada curta); PATCH confirma — vira a via oficial —
   ou rejeita ("não é o contrato": vai para a fila de documentos). */

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('contratos', 'ver')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })
  const { id } = await params
  const recorte = await negocioDaCarteira(id, auth.sessao)
  if (!recorte.ok) return NextResponse.json({ erro: recorte.erro }, { status: recorte.status })

  const r = await urlViaAssinadaCandidata(id)
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
  return NextResponse.json({ url: r.url })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('contratos', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })
  const { id } = await params
  const recorte = await negocioDaCarteira(id, auth.sessao)
  if (!recorte.ok) return NextResponse.json({ erro: recorte.erro }, { status: recorte.status })

  let corpo: { acao?: 'confirmar' | 'rejeitar'; signature_method?: 'manual' | 'govbr' }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  if (corpo.acao === 'confirmar') {
    const metodo = corpo.signature_method
    if (metodo !== 'manual' && metodo !== 'govbr') {
      return NextResponse.json({ erro: 'Informe como o contrato foi assinado.' }, { status: 400 })
    }
    const r = await confirmarViaAssinada({ dealId: id, signatureMethod: metodo })
    if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
    console.log(`[via-assinada] ${auth.sessao.email} confirmou a via assinada do negócio ${id}`)
    return NextResponse.json({ ok: true })
  }

  if (corpo.acao === 'rejeitar') {
    const r = await rejeitarViaAssinada({ dealId: id })
    if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
    console.log(`[via-assinada] ${auth.sessao.email} marcou o arquivo do negócio ${id} como "não é o contrato"`)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ erro: 'Ação desconhecida.' }, { status: 400 })
}

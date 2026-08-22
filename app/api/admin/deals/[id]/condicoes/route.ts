import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { negocioDaCarteira } from '@/lib/auth/carteira'
import { salvarCondicoes, type EntradaCondicoes } from '@/lib/negocios/condicoes'

/* Condições do negócio (preço, sinal, forma de pagamento, datas) — o que o
   contrato lê de `deals`. Mesmo portão da aprovação: `contratos` + `editar`,
   com recorte por carteira. */

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('contratos', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params
  const recorte = await negocioDaCarteira(id, auth.sessao)
  if (!recorte.ok) return NextResponse.json({ erro: recorte.erro }, { status: recorte.status })

  let corpo: EntradaCondicoes
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  const r = await salvarCondicoes(id, corpo)
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true })
}

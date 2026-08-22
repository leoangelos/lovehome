import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { negocioDaCarteira } from '@/lib/auth/carteira'
import { anexarDocumento } from '@/lib/negocios/documentos'

/* Documento anexado pelo painel (cliente mandou por e-mail, entregou em mãos).
   `documentos` + `editar` — é o mesmo portão de quem confere a fila. */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('documentos', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })
  const { id } = await params
  const recorte = await negocioDaCarteira(id, auth.sessao)
  if (!recorte.ok) return NextResponse.json({ erro: recorte.erro }, { status: recorte.status })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ erro: 'Envie o arquivo como formulário.' }, { status: 400 })
  }

  const arquivo = form.get('arquivo')
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return NextResponse.json({ erro: 'Escolha o arquivo.' }, { status: 400 })
  }

  const r = await anexarDocumento({
    dealId: id,
    tipo: form.get('tipo'),
    bytes: await arquivo.arrayBuffer(),
    contentType: arquivo.type,
    conferido: form.get('conferido') === '1',
    userId: auth.sessao.userId,
  })
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })

  console.log(`[deals/documentos] ${auth.sessao.email} anexou ${form.get('tipo')} ao negócio ${id}`)
  return NextResponse.json({ ok: true, id: r.documentId })
}

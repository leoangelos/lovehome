import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { cadastrarSite } from '@/lib/channels/sites'

/* Autoriza um site a embutir o widget. É o que faz o CORS aceitar aquela
   origem — sem isso, o script carrega e nenhuma requisição passa. */

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await autorizarApi('canais', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  let corpo: { origem?: string; nome?: string }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  const r = await cadastrarSite({
    origem: corpo.origem ?? '',
    nome: corpo.nome ?? null,
    email: auth.sessao.email,
  })

  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true, siteId: r.siteId })
}

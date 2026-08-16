import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { bloquearPorTelefone } from '@/lib/channels/blocklist'

/* Bloqueia um contato. Contato bloqueado não custa nada: sem transcrição, sem
   Vision, sem rodada de agente, sem resposta — a mensagem recebida continua
   sendo gravada crua, para o histórico manter registro do que a pessoa mandou. */

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await autorizarApi('configuracoes', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  let corpo: { telefone?: string }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  const r = await bloquearPorTelefone(corpo.telefone ?? '', auth.sessao.email)
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true, nome: r.nome })
}

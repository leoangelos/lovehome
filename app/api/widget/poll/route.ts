import { NextResponse } from 'next/server'
import { drainWidgetReplies, getWidgetSession } from '@/lib/channels/widget'
import { resolverOrigem } from '@/lib/widget/protecao'

/* Busca por mensagens que chegaram FORA de uma requisição do visitante.
 *
 * Duas fontes: o cron de follow-up e o takeover humano — nos dois casos o texto
 * é empurrado para a fila do Redis pelo adapter, sem ninguém esperando por uma
 * resposta HTTP. Sem este endpoint, essas mensagens só apareceriam quando o
 * visitante escrevesse de novo, que é exatamente quando não precisam mais.
 *
 * Só drena o que já existe: não chama agente e não gasta LLM. Por isso não tem
 * limite de uso próprio — o custo de uma chamada é uma leitura no Redis. */

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  const { searchParams } = new URL(request.url)
  const origem = await resolverOrigem(request, searchParams.get('site'))
  if (!origem.permitida) return new NextResponse(null, { status: 403 })
  return new NextResponse(null, { status: 204, headers: origem.headers })
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const siteId = searchParams.get('site')

  const origem = await resolverOrigem(request, siteId)
  if (!origem.permitida) {
    return NextResponse.json({ erro: 'Origem não autorizada.' }, { status: 403 })
  }
  const headers = origem.headers

  const token = searchParams.get('sessao')?.trim()
  if (!token) return NextResponse.json({ erro: 'Sessão ausente.' }, { status: 400, headers })

  /* Confere que a sessão existe antes de drenar. A fila é chaveada pelo token,
     então sem esta checagem um token inventado devolveria lista vazia e 200 —
     um jeito barato de sondar tokens em massa. */
  const sessao = await getWidgetSession(token)
  if (!sessao) {
    return NextResponse.json({ erro: 'Sessão expirada.' }, { status: 404, headers })
  }

  const respostas = await drainWidgetReplies(token)
  return NextResponse.json({ respostas }, { headers })
}

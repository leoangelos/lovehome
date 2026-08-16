import { NextResponse } from 'next/server'
import { createWidgetSession, getWidgetSession } from '@/lib/channels/widget'
import {
  gerarTokenSessao,
  hashIp,
  ipDaRequisicao,
  limitarSessaoNova,
  resolverOrigem,
} from '@/lib/widget/protecao'

/* Abertura de sessão do widget.
 *
 * O token é gerado AQUI. O corpo da requisição pode mandar um token anterior
 * para retomar a conversa depois de um F5, mas ele é apenas CONSULTADO — se não
 * existir, uma sessão nova é criada com token novo. O cliente nunca escolhe o
 * identificador: escolher o próprio token é escolher o de outra pessoa. */

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: Request) {
  const { searchParams } = new URL(request.url)
  const origem = await resolverOrigem(request, searchParams.get('site'))
  if (!origem.permitida) return new NextResponse(null, { status: 403 })
  return new NextResponse(null, { status: 204, headers: origem.headers })
}

export async function POST(request: Request) {
  let corpo: {
    siteId?: string
    sessionToken?: string
    landingUrl?: string
    referrerUrl?: string
  }
  try {
    corpo = await request.json()
  } catch {
    corpo = {}
  }

  const origem = await resolverOrigem(request, corpo.siteId ?? null)
  if (!origem.permitida) {
    /* Sem cabeçalho de CORS de propósito: a página que pediu não vai conseguir
       ler nem esta resposta, que é o comportamento correto para origem não
       registrada. */
    return NextResponse.json({ erro: 'Origem não autorizada.' }, { status: 403 })
  }

  const headers = origem.headers

  // Retomada: token conhecido devolve a mesma sessão, sem criar outra.
  if (corpo.sessionToken) {
    const existente = await getWidgetSession(corpo.sessionToken)
    if (existente) {
      /* `identificado` vem do SERVIDOR, não de um sinalizador no navegador:
         quem voltou depois de o banco ser limpo veria o chat aberto e tomaria
         428 em toda mensagem. Quem manda é a sessão ter contact_id. */
      return NextResponse.json(
        {
          sessionToken: existente.session_token,
          retomada: true,
          identificado: Boolean(existente.contact_id),
          primeiroNome: existente.visitor_name?.split(' ')[0] ?? null,
        },
        { headers }
      )
    }
  }

  const ipHash = hashIp(ipDaRequisicao(request))
  const limite = await limitarSessaoNova(ipHash)
  if (!limite.dentro) {
    return NextResponse.json({ erro: limite.motivo }, { status: 429, headers })
  }

  try {
    const sessao = await createWidgetSession({
      sessionToken: gerarTokenSessao(),
      siteId: corpo.siteId ?? null,
      userAgent: request.headers.get('user-agent'),
      ipHash,
      landingUrl: corpo.landingUrl ?? null,
      referrerUrl: corpo.referrerUrl ?? null,
    })

    return NextResponse.json(
      { sessionToken: sessao.session_token, retomada: false },
      { headers }
    )
  } catch (e) {
    console.error('[widget/session] falhou:', e)
    return NextResponse.json({ erro: 'Não foi possível abrir a conversa.' }, { status: 500, headers })
  }
}

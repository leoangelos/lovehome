import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveConversation } from '@/lib/channels/identity'
import type { Contact } from '@/lib/types/domain'
import {
  drainWidgetReplies,
  getWidgetSession,
  touchWidgetCurrentUrl,
} from '@/lib/channels/widget'
import { processMessage } from '@/lib/pipeline/process-message'
import {
  MAX_CARACTERES_MENSAGEM,
  hashIp,
  ipDaRequisicao,
  limitarMensagem,
  resolverOrigem,
} from '@/lib/widget/protecao'

/* Mensagem do visitante pelo widget.
 *
 * Diferente do WhatsApp, aqui NÃO há janela de debounce: o visitante está
 * olhando a tela esperando a resposta, e agrupar mensagens por 20 segundos
 * transformaria uma conversa em espera constrangedora. A resposta volta na
 * mesma requisição HTTP.
 *
 * O adapter empurra a resposta para uma fila no Redis em vez de devolvê-la
 * direto; drenar no fim é o que faz o follow-up do cron (que roda fora de
 * qualquer requisição) também chegar ao widget. */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function OPTIONS(request: Request) {
  const { searchParams } = new URL(request.url)
  const origem = await resolverOrigem(request, searchParams.get('site'))
  if (!origem.permitida) return new NextResponse(null, { status: 403 })
  return new NextResponse(null, { status: 204, headers: origem.headers })
}

export async function POST(request: Request) {
  let corpo: { siteId?: string; sessionToken?: string; texto?: string; currentUrl?: string }
  try {
    corpo = await request.json()
  } catch {
    corpo = {}
  }

  const origem = await resolverOrigem(request, corpo.siteId ?? null)
  if (!origem.permitida) {
    return NextResponse.json({ erro: 'Origem não autorizada.' }, { status: 403 })
  }
  const headers = origem.headers

  const token = corpo.sessionToken?.trim()
  if (!token) {
    return NextResponse.json({ erro: 'Sessão ausente.' }, { status: 400, headers })
  }

  const texto = corpo.texto?.trim()
  if (!texto) {
    return NextResponse.json({ erro: 'Escreva uma mensagem.' }, { status: 400, headers })
  }
  if (texto.length > MAX_CARACTERES_MENSAGEM) {
    return NextResponse.json(
      { erro: `Mensagem longa demais (máximo ${MAX_CARACTERES_MENSAGEM} caracteres).` },
      { status: 400, headers }
    )
  }

  /* Sessão inexistente é 404, não "cria uma na hora": criar aqui deixaria o
     cliente escolher o próprio token pela porta dos fundos, que é justamente o
     que /api/widget/session existe para impedir. */
  const sessao = await getWidgetSession(token)
  if (!sessao) {
    return NextResponse.json(
      { erro: 'Sessão expirada. Recarregue a página.' },
      { status: 404, headers }
    )
  }

  /* Sem identificação não há conversa. A trava é AQUI, não só no formulário:
     a rota é chamável direto, e sem o telefone o contato nasceria separado do
     WhatsApp da mesma pessoa — que é justamente o que /identify resolve.
     428 dá ao widget um sinal acionável: mostrar o formulário de novo. */
  if (!sessao.contact_id) {
    return NextResponse.json(
      { erro: 'Identifique-se antes de conversar.', precisa_identificar: true },
      { status: 428, headers }
    )
  }

  const ipHash = hashIp(ipDaRequisicao(request))
  const limite = await limitarMensagem(token, ipHash)
  if (!limite.dentro) {
    return NextResponse.json({ erro: limite.motivo }, { status: 429, headers })
  }

  const supabase = createAdminClient()

  try {
    /* O contato vem da sessão, estabelecido em /identify com telefone. Resolver
       de novo aqui seria redundante e, pior, criaria um contato sem telefone se
       a identidade tivesse se perdido. */
    const { data: contatoLinha } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', sessao.contact_id)
      .maybeSingle()

    if (!contatoLinha) {
      return NextResponse.json(
        { erro: 'Identifique-se antes de conversar.', precisa_identificar: true },
        { status: 428, headers }
      )
    }

    const contato = contatoLinha as Contact
    const conversa = await resolveConversation(contato.id, 'widget')

    await touchWidgetCurrentUrl(token, corpo.currentUrl ?? null)

    await supabase.from('messages').insert({
      conversation_id: conversa.id,
      contact_id: contato.id,
      role: 'user',
      content: texto,
      media_type: 'text',
      channel: 'widget',
    })

    await processMessage({
      channel: 'widget',
      replyAddress: token,
      message: texto,
      contact: contato,
      conversationId: conversa.id,
    })

    const respostas = await drainWidgetReplies(token)

    /* Fila vazia depois do pipeline significa que ninguém respondeu — contato
       bloqueado, humano no controle da conversa, ou falha do agente. Silêncio
       na tela pareceria travamento, então o widget diz algo. */
    if (!respostas.length) {
      return NextResponse.json(
        {
          respostas: [
            {
              text: 'Recebi sua mensagem. Um corretor vai te responder por aqui em instantes.',
              displayName: null,
              timestamp: new Date().toISOString(),
            },
          ],
        },
        { headers }
      )
    }

    return NextResponse.json({ respostas }, { headers })
  } catch (e) {
    console.error('[widget/message] falhou:', e)
    return NextResponse.json(
      { erro: 'Não consegui responder agora. Tente de novo em instantes.' },
      { status: 500, headers }
    )
  }
}

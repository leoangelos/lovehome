import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getWidgetSession } from '@/lib/channels/widget'
import { resolveContact } from '@/lib/channels/identity'
import { ensureBrCountryCode, extractPhoneKey, normalizePhone } from '@/lib/utils/phone'
import { hashIp, ipDaRequisicao, limitarMensagem, resolverOrigem } from '@/lib/widget/protecao'

/* Identificação antes do chat — nome e telefone.
 *
 * É o que unifica o widget com o WhatsApp. `resolveContact` casa pessoas pelos
 * últimos 8 dígitos do telefone; sem telefone, o visitante do site nascia como
 * um contato separado do WhatsApp dele, com memória de agente própria.
 *
 * POR QUE ISTO NÃO CONTRARIA A §6.3: aquela regra diz que conversar e buscar
 * imóvel não exigem CADASTRO — CPF, endereço, papéis. Nome e telefone são
 * identidade CONVERSACIONAL, que no WhatsApp o sistema recebe de graça na
 * primeira mensagem. Pedir no widget deixa os dois canais equivalentes; não
 * torna o widget mais exigente.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function OPTIONS(request: Request) {
  const { searchParams } = new URL(request.url)
  const origem = await resolverOrigem(request, searchParams.get('site'))
  if (!origem.permitida) return new NextResponse(null, { status: 403 })
  return new NextResponse(null, { status: 204, headers: origem.headers })
}

export async function POST(request: Request) {
  let corpo: { siteId?: string; sessionToken?: string; nome?: string; telefone?: string }
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
  if (!token) return NextResponse.json({ erro: 'Sessão ausente.' }, { status: 400, headers })

  const nome = (corpo.nome ?? '').trim()
  if (nome.length < 2) {
    return NextResponse.json({ erro: 'Informe seu nome.' }, { status: 400, headers })
  }
  if (nome.length > 80) {
    return NextResponse.json({ erro: 'Nome longo demais.' }, { status: 400, headers })
  }

  const digitado = (corpo.telefone ?? '').trim()
  const cru = normalizePhone(digitado)

  /* 10 dígitos é o mínimo de um fixo com DDD. Menos que isso não dá para
     devolver contato pelo WhatsApp, que é a razão de pedir o número. */
  if (cru.length < 10 || cru.length > 15) {
    return NextResponse.json(
      { erro: 'Telefone inválido — informe DDD e número.' },
      { status: 400, headers }
    )
  }

  /* Quem digitou "+" está dando o país explicitamente (+1, +351): respeitar.
     Sem "+", assume Brasil — é o público, e forçar o DDI na mão só geraria
     número errado. */
  const comDdi = digitado.startsWith('+') ? cru : ensureBrCountryCode(cru)

  const sessao = await getWidgetSession(token)
  if (!sessao) {
    return NextResponse.json({ erro: 'Sessão expirada. Recarregue a página.' }, { status: 404, headers })
  }

  /* Mesmo limite das mensagens: identificar cria contato, e criar contato em
     série é o mesmo abuso por outra porta. */
  const ipHash = hashIp(ipDaRequisicao(request))
  const limite = await limitarMensagem(token, ipHash)
  if (!limite.dentro) {
    return NextResponse.json({ erro: limite.motivo }, { status: 429, headers })
  }

  try {
    /* Passar `phone` e `phoneKey` é o ponto inteiro deste endpoint: é o que faz
       `resolveContact` encontrar o contato do WhatsApp da mesma pessoa em vez
       de criar um novo. */
    const contato = await resolveContact({
      channel: 'widget',
      externalId: token,
      phone: comDdi,
      phoneKey: extractPhoneKey(comDdi),
      name: nome,
    })

    const supabase = createAdminClient()
    await supabase
      .from('widget_sessions')
      .update({ contact_id: contato.id, visitor_name: nome, visitor_phone: comDdi })
      .eq('session_token', token)

    console.log(`[widget/identify] sessão ${token.slice(0, 8)}… vinculada ao contato ${contato.id}`)

    /* Devolve só o primeiro nome, para o widget cumprimentar. Nunca devolve o
       telefone normalizado nem o id do contato: o navegador não precisa deles,
       e o que não sai não vaza. */
    return NextResponse.json(
      { ok: true, primeiroNome: nome.split(' ')[0] },
      { headers }
    )
  } catch (e) {
    console.error('[widget/identify] falhou:', e)
    return NextResponse.json(
      { erro: 'Não foi possível iniciar a conversa. Tente de novo.' },
      { status: 500, headers }
    )
  }
}

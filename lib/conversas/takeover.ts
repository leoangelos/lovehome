// ==========================================
// Takeover humano: assumir a conversa, devolver ao bot e responder pelo canal.
//
// O mecanismo já existia no pipeline (`humanoNoControle`) desde o começo — o
// que faltava era alguém conseguir acioná-lo. Isto é essa ponta.
//
// A REGRA QUE SUSTENTA O RESTO: não se responde sem assumir.
//
// Não é formalidade. O agente carrega o histórico dele de `agent_histories`,
// que é separado de `messages` — uma resposta escrita por humano NÃO entra no
// contexto do modelo. Se o corretor escrevesse com o bot ativo, a próxima
// mensagem do cliente acionaria um agente que não faz ideia do que foi
// combinado, e os dois se contradiriam na frente do cliente. Assumir é o que
// cala o bot.
//
// Vive em lib/ e não na rota HTTP para ser testável sem subir sessão.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { dispatchOutgoing } from '@/lib/channels'
import type { Channel } from '@/lib/channels/types'
import { getConfiguracoes } from '@/lib/config/app'

/** Mesma janela do pipeline, vinda das Configurações (`takeover_horas`). */
async function janelaMs(): Promise<number> {
  return (await getConfiguracoes()).takeover_horas * 60 * 60 * 1000
}

export type Resultado = { ok: true } | { ok: false; erro: string; status: number }

async function carregar(conversationId: string) {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('conversations')
    .select('id, contact_id, channel, human_takeover, taken_by, status')
    .eq('id', conversationId)
    .maybeSingle()
  return data
}

export async function assumirConversa(params: {
  conversationId: string
  userId: string
  email: string
}): Promise<Resultado> {
  const supabase = createAdminClient()
  const conversa = await carregar(params.conversationId)
  if (!conversa) return { ok: false, erro: 'Conversa não encontrada.', status: 404 }

  /* Já assumida por OUTRA pessoa: recusa. Duas pessoas respondendo a mesma
     conversa é pior do que ninguém responder — o cliente recebe duas versões e
     nenhuma das duas sabe da outra. */
  if (conversa.human_takeover && conversa.taken_by && conversa.taken_by !== params.userId) {
    return { ok: false, erro: 'Outra pessoa já assumiu esta conversa.', status: 409 }
  }

  const agora = new Date()
  const { error } = await supabase
    .from('conversations')
    .update({
      human_takeover: true,
      taken_by: params.userId,
      taken_at: agora.toISOString(),
      takeover_expires_at: new Date(agora.getTime() + (await janelaMs())).toISOString(),
      status: 'human',
    })
    .eq('id', params.conversationId)

  if (error) return { ok: false, erro: 'Não foi possível assumir.', status: 500 }

  await supabase.from('human_takeover_logs').insert({
    conversation_id: params.conversationId,
    profile_id: params.userId,
    action: 'claim',
    note: `Assumida por ${params.email}`,
  })

  console.log(`[takeover] ${params.email} assumiu a conversa ${params.conversationId}`)
  return { ok: true }
}

export async function devolverAoBot(params: {
  conversationId: string
  userId: string
  email: string
}): Promise<Resultado> {
  const supabase = createAdminClient()
  const conversa = await carregar(params.conversationId)
  if (!conversa) return { ok: false, erro: 'Conversa não encontrada.', status: 404 }

  const { error } = await supabase
    .from('conversations')
    .update({
      human_takeover: false,
      taken_by: null,
      taken_at: null,
      takeover_expires_at: null,
      status: 'active',
    })
    .eq('id', params.conversationId)

  if (error) return { ok: false, erro: 'Não foi possível devolver.', status: 500 }

  await supabase.from('human_takeover_logs').insert({
    conversation_id: params.conversationId,
    profile_id: params.userId,
    action: 'release',
    note: `Devolvida ao bot por ${params.email}`,
  })

  console.log(`[takeover] ${params.email} devolveu a conversa ${params.conversationId} ao bot`)
  return { ok: true }
}

export async function responderComoHumano(params: {
  conversationId: string
  userId: string
  email: string
  nome: string | null
  texto: string
}): Promise<Resultado> {
  const texto = params.texto.trim()
  if (!texto) return { ok: false, erro: 'Escreva a mensagem.', status: 400 }
  if (texto.length > 4000) return { ok: false, erro: 'Mensagem longa demais.', status: 400 }

  const supabase = createAdminClient()
  const conversa = await carregar(params.conversationId)
  if (!conversa) return { ok: false, erro: 'Conversa não encontrada.', status: 404 }

  /* Sem takeover, não envia. Ver o cabeçalho deste arquivo: o agente não
     enxerga o que o humano escreveu, então bot ativo + humano respondendo é
     garantia de contradição na frente do cliente. */
  if (!conversa.human_takeover) {
    return {
      ok: false,
      erro: 'Assuma a conversa antes de responder — senão o bot continua respondendo junto.',
      status: 409,
    }
  }

  if (conversa.taken_by && conversa.taken_by !== params.userId) {
    return { ok: false, erro: 'Outra pessoa está respondendo esta conversa.', status: 409 }
  }

  /* Endereço de resposta por canal: telefone no WhatsApp, token de sessão no
     widget. É o mesmo `replyAddress` do pipeline. */
  const endereco = await enderecoDeResposta(conversa.contact_id, conversa.channel as Channel)
  if (!endereco) {
    return { ok: false, erro: 'Não há por onde responder a este contato.', status: 422 }
  }

  /* GRAVA ANTES DE ENVIAR. Na ordem inversa, uma falha de envio deixaria o
     histórico sem registro nenhum de que alguém tentou responder — que é
     exatamente quando se precisa saber o que aconteceu. Mesma lição de
     `salvarEEnviar` no pipeline. */
  const { error: erroMensagem } = await supabase.from('messages').insert({
    conversation_id: params.conversationId,
    contact_id: conversa.contact_id,
    role: 'assistant',
    content: texto,
    media_type: 'text',
    channel: conversa.channel,
    // `agent: 'humano'` é o que distingue na tela quem escreveu.
    agent: 'humano',
  })

  if (erroMensagem) {
    console.error('[takeover] falha ao gravar a mensagem:', erroMensagem.message)
    return { ok: false, erro: 'Não foi possível registrar a mensagem.', status: 500 }
  }

  await supabase
    .from('conversations')
    .update({
      last_message_at: new Date().toISOString(),
      // Renova a janela: quem está conversando não pode perder o controle no meio.
      takeover_expires_at: new Date(Date.now() + (await janelaMs())).toISOString(),
    })
    .eq('id', params.conversationId)

  await supabase.from('human_takeover_logs').insert({
    conversation_id: params.conversationId,
    profile_id: params.userId,
    action: 'message_sent',
    note: `Enviada por ${params.email}`,
  })

  try {
    await dispatchOutgoing(conversa.channel as Channel, {
      contactId: conversa.contact_id,
      externalId: endereco,
      text: texto,
      /* O nome de quem escreveu vai junto: o cliente vinha conversando com o
         assistente e precisa saber que agora é uma pessoa. */
      displayName: params.nome ?? undefined,
    })
  } catch (e) {
    console.error('[takeover] envio falhou:', e)
    return {
      ok: false,
      erro: 'A mensagem ficou registrada, mas o envio pelo canal falhou. Tente de novo.',
      status: 502,
    }
  }

  return { ok: true }
}

async function enderecoDeResposta(contactId: string, canal: Channel): Promise<string | null> {
  const supabase = createAdminClient()

  if (canal === 'widget') {
    const { data } = await supabase
      .from('widget_sessions')
      .select('session_token')
      .eq('contact_id', contactId)
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return data?.session_token ?? null
  }

  const { data } = await supabase
    .from('contacts')
    .select('phone')
    .eq('id', contactId)
    .maybeSingle()
  return data?.phone ?? null
}

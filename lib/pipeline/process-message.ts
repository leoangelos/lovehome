// ==========================================
// Pipeline unificado de mensagem — todo canal (Z-API, Meta, Widget) entra aqui.
//
// Duas decisoes estruturais:
//
// 1. O passo resolveRegistration (PRD 6.3) roda ANTES do roteamento e entrega
//    o estado de cadastro pronto para o orquestrador e para o gate de tools.
//
// 2. NAO existe caminho de "membro da equipe" pelo WhatsApp — um telefone
//    cadastrado na equipe roteado para um orquestrador administrativo. Isso e
//    deliberado: a secao 12.8 do PRD rejeita detectar corretor pelo
//    numero no mesmo canal publico, porque spoofing de telefone viraria comando
//    interno. O Copiloto do Corretor vive no painel autenticado.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { orchestrate } from '@/lib/agents/orchestrator'
import { runSdrAgent } from '@/lib/agents/sdr'
import { runSuporteAgent } from '@/lib/agents/suporte'
import { runInvestidorAgent } from '@/lib/agents/investidor'
import { runAgendamentoAgent } from '@/lib/agents/agendamento'
import { runProprietarioAgent } from '@/lib/agents/proprietario'
import { runCloserAgent } from '@/lib/agents/closer'
import { generateLeadSummary } from '@/lib/agents/summary'
import { resolveRegistration } from '@/lib/pipeline/resolve-registration'
import { carregarContextoConversa, resumoParaRoteador } from '@/lib/pipeline/contexto-conversa'
import { dispatchOutgoing } from '@/lib/channels'
import { isContactBlockedById } from '@/lib/channels/blocklist'
import type { EstadoCadastro } from '@/lib/pipeline/resolve-registration'
import type { ContextoConversa } from '@/lib/pipeline/contexto-conversa'
import type { Channel } from '@/lib/channels/types'
import type { AgentResponse, RoutableAgent } from '@/lib/types/agents'
import type { Contact } from '@/lib/types/domain'
import { getConfiguracoes } from '@/lib/config/app'

export interface ProcessMessageInput {
  channel: Channel
  /** Endereco de resposta do canal (telefone para zapi/meta, session_token para widget) */
  replyAddress: string
  /** Conteudo ja normalizado (audio/imagem processados antes) */
  message: string
  contact: Contact
  conversationId: string
}

/** Agentes previstos no PRD que ainda nao foram construidos.
    Vazio: o roster da §12.1 esta completo. Mantido porque o mecanismo de
    "agente roteado mas inexistente" evita que uma chave nova no orquestrador
    derrube uma conversa antes de o agente existir. */
const AGENTES_PENDENTES: Record<string, string> = {}

const DESPEDIDAS = [
  'Tudo bem! Se precisar de algo, é só chamar aqui. Fico por aqui!',
  'Perfeito! Qualquer coisa estou à disposição. Até mais!',
  'Combinado! Qualquer dúvida é só mandar mensagem. Até!',
]

/* A janela sai das Configurações (`takeover_horas`). O padrão continua 48h. */

export async function processMessage(input: ProcessMessageInput): Promise<void> {
  const { channel, replyAddress, message, contact, conversationId } = input
  const supabase = createAdminClient()

  /* Rede de seguranca da blacklist. Os webhooks ja barram antes de qualquer
     chamada paga, mas uma mensagem enfileirada ANTES de o operador bloquear
     ainda cairia aqui — e o widget entra direto no pipeline. Rele do banco para
     um contato velho em memoria nao passar. */
  if (await isContactBlockedById(contact.id)) {
    console.log('[Pipeline] Contato bloqueado — nenhum agente roda:', contact.id)
    return
  }

  if (await humanoNoControle(conversationId)) return

  // ---- Passo determinístico de cadastro (PRD 6.3) ----
  const cadastro = await resolveRegistration(contact)

  // Recarrega o contato: resolveRegistration pode ter corrigido o cache.
  const { data: contatoFresco } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', contact.id)
    .single()
  const atual = (contatoFresco as Contact) ?? contact

  // ---- Roteamento ----

  /* O Orquestrador é consultado em TODA mensagem, inclusive quando já existe
     agente ativo. Não é desperdício — é o único caminho de troca de agente que
     existe.

     Antes daqui havia um atalho: `active_agent` definido ia direto para ele,
     sem passar pelo roteador. O efeito era que a primeira classificação virava
     permanente. Quem falava com o SDR sobre comprar e depois perguntava do
     boleto do aluguel continuava no SDR para sempre — o Suporte era
     inalcançável, e o próprio prompt do Orquestrador tem uma regra ("mantenha
     o mesmo agente enquanto a mensagem não mudar claramente de assunto") que
     nunca chegava a ser avaliada. O único jeito de sair era escalar para
     humano ou se despedir.

     Os agentes NÃO se repassam entre si, e é deliberado: um repasse por tool
     dependeria de o modelo lembrar de chamá-la, e a regra deste projeto é que
     ação com consequência não pode depender disso. Quem troca é o roteador, em
     código, a cada mensagem.

     O custo é uma chamada de modelo pequeno por mensagem, com prompt curto —
     ordem de USD 0,0001. Registrada em `llm_usage` como 'roteamento'. */
  /* O contexto é carregado UMA vez e serve ao roteador e ao agente. O roteador
     recebe a versão compacta: a regra "mantenha o agente enquanto o assunto
     não mudar" exige saber qual era o assunto — sem isso, uma mensagem curta
     ("pode ser sexta?") depois de uma despedida caía no SDR por falta de pista. */
  const contexto = await carregarContextoConversa(atual.id, message, conversationId)
  const routing = await orchestrate({
    message,
    contact: atual,
    conversationId,
    cadastro,
    conversaRecente: resumoParaRoteador(contexto),
  })
  const agenteRoteado: RoutableAgent = routing.agent
  let routingReasoning = routing.reasoning
  const routingModel = 'gpt-4o-mini'

  let agentResponse: AgentResponse
  let agentName: string = agenteRoteado

  if (agenteRoteado === 'despedida') {
    agentResponse = {
      content: DESPEDIDAS[Math.floor(Math.random() * DESPEDIDAS.length)],
      tokensUsed: 0,
      toolsUsed: [],
      waDisplayName: null,
    }
  } else if (AGENTES_PENDENTES[agenteRoteado]) {
    /* Agente previsto mas ainda nao construido. Escalar e mais honesto do que
       cair no SDR: quem perguntou do proprio boleto receberia busca de imovel,
       o que parece o sistema tendo entendido errado. */
    agentResponse = await escalarParaHumano({
      conversationId,
      contactId: atual.id,
      assunto: AGENTES_PENDENTES[agenteRoteado],
    })
    agentName = 'escalonamento'
    routingReasoning += ` | agente '${agenteRoteado}' ainda não implementado (Marco 2/3) — escalado`
  } else {
    /* A conversa inteira, de todos os agentes, vai junto. Cada agente tem
       memoria propria (agent_histories), e a troca de agente e justamente
       quando essa memoria falha: o SDR mostrava o imovel, a pessoa perguntava
       "que dia posso visitar?" e o Agendamento — com historico proprio vazio —
       perguntava "qual imovel?". Carregado aqui, uma vez, e nao no base-agent,
       porque e o pipeline que sabe qual mensagem esta sendo respondida agora
       (as linhas do turno atual ja estao em `messages` e sao descartadas). */
    agentResponse = await rodarAgente(agenteRoteado, atual.id, message, cadastro, contexto)
  }

  // ---- Efeitos das tools ----
  await aplicarEfeitos({
    conversationId,
    contact: atual,
    agentName,
    agentResponse,
  })

  await supabase
    .from('contacts')
    .update({ last_contact: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', atual.id)

  await salvarEEnviar({
    channel,
    replyAddress,
    conversationId,
    contactId: atual.id,
    agentResponse,
    agentName,
    routingReasoning,
    routingModel,
  })
}

// ==========================================
// Internos
// ==========================================

async function rodarAgente(
  agente: RoutableAgent,
  contactId: string,
  message: string,
  cadastro: EstadoCadastro,
  contexto: ContextoConversa
): Promise<AgentResponse> {
  switch (agente) {
    case 'investidor':
      return runInvestidorAgent(contactId, message, cadastro, contexto)
    case 'agendamento':
      return runAgendamentoAgent(contactId, message, cadastro, contexto)
    case 'proprietario':
      return runProprietarioAgent(contactId, message, cadastro, contexto)
    case 'closer':
      return runCloserAgent(contactId, message, cadastro, contexto)
    case 'suporte':
      return runSuporteAgent(contactId, message, cadastro, contexto)
    case 'sdr':
    default:
      return runSdrAgent(contactId, message, cadastro, contexto)
  }
}

/**
 * Bot nao responde quando um humano esta cuidando: status='escalated' (agente
 * sinalizou, ninguem assumiu ainda) ou human_takeover=true (alguem respondendo).
 * Os dois liberam o bot so depois de 48h sem atividade.
 */
async function humanoNoControle(conversationId: string): Promise<boolean> {
  const supabase = createAdminClient()

  const { data: conversa } = await supabase
    .from('conversations')
    .select('status, human_takeover, takeover_expires_at, last_message_at')
    .eq('id', conversationId)
    .single()

  if (!conversa?.human_takeover && conversa?.status !== 'escalated') return false

  const janelaMs = (await getConfiguracoes()).takeover_horas * 60 * 60 * 1000
  const expiraEm = conversa.takeover_expires_at
    ? new Date(conversa.takeover_expires_at)
    : conversa.last_message_at
      ? new Date(new Date(conversa.last_message_at).getTime() + janelaMs)
      : null

  if (!expiraEm || expiraEm > new Date()) {
    console.log('[Pipeline] Humano no controle — bot em silêncio', {
      status: conversa.status,
      humanTakeover: conversa.human_takeover,
    })
    return true
  }

  console.log('[Pipeline] Janela humana expirou — devolvendo ao bot')
  await supabase
    .from('conversations')
    .update({
      human_takeover: false,
      taken_by: null,
      taken_at: null,
      takeover_expires_at: null,
      status: 'active',
    })
    .eq('id', conversationId)

  await supabase.from('human_takeover_logs').insert({
    conversation_id: conversationId,
    action: 'expire',
    note: conversa.human_takeover
      ? 'Takeover expirado após 48h sem atividade'
      : 'Escalação não atendida em 48h — bot reativado',
  })

  return false
}

async function escalarParaHumano(params: {
  conversationId: string
  contactId: string
  assunto: string
}): Promise<AgentResponse> {
  const supabase = createAdminClient()

  await supabase
    .from('conversations')
    .update({ status: 'escalated' })
    .eq('id', params.conversationId)

  await supabase
    .from('contacts')
    .update({ active_agent: null, updated_at: new Date().toISOString() })
    .eq('id', params.contactId)

  return {
    content:
      `Sobre ${params.assunto}, quem resolve isso é um corretor da equipe — ` +
      `já estou passando sua mensagem. Alguém te responde por aqui em breve!`,
    tokensUsed: 0,
    toolsUsed: ['escalate_to_human'],
    waDisplayName: null,
  }
}

/**
 * Reage ao que as tools fizeram: escalacao pedida pelo agente e gatilhos de
 * resumo para o corretor.
 */
async function aplicarEfeitos(params: {
  conversationId: string
  contact: Contact
  agentName: string
  agentResponse: AgentResponse
}) {
  const supabase = createAdminClient()
  const { conversationId, contact, agentName, agentResponse } = params

  if (agentName !== 'escalonamento' && agentResponse.toolsUsed.includes('escalate_to_human')) {
    await supabase.from('conversations').update({ status: 'escalated' }).eq('id', conversationId)
    await supabase
      .from('contacts')
      .update({ active_agent: null, updated_at: new Date().toISOString() })
      .eq('id', contact.id)
  }

  /* Resumo para o corretor. Best-effort de proposito: falha aqui nao pode
     travar a resposta ao cliente, e lead_summaries ja grava no painel mesmo se
     a notificacao por outro canal falhar (risco da secao 22). */
  const visitaCriada = agentResponse.trace?.toolCalls?.some(
    (t) => t.name === 'create_visit' && (t.result as { agendado?: boolean })?.agendado === true
  )

  if (visitaCriada) {
    generateLeadSummary({ contactId: contact.id, trigger: 'visita_agendada' }).catch((e) =>
      console.error('[Pipeline] resumo (visita_agendada) falhou:', e)
    )
    return
  }

  const qualificouCompleto = agentResponse.trace?.toolCalls?.some(
    (t) =>
      t.name === 'save_qualification' &&
      (t.result as { funnel_stage?: string })?.funnel_stage === 'qualificado'
  )

  if (qualificouCompleto) {
    generateLeadSummary({ contactId: contact.id, trigger: 'qualificacao_completa' }).catch((e) =>
      console.error('[Pipeline] resumo (qualificacao_completa) falhou:', e)
    )
  }
}

async function salvarEEnviar(params: {
  channel: Channel
  replyAddress: string
  conversationId: string
  contactId: string
  agentResponse: AgentResponse
  agentName: string
  routingReasoning: string | null
  routingModel: string | null
}) {
  const supabase = createAdminClient()
  const {
    channel,
    replyAddress,
    conversationId,
    contactId,
    agentResponse,
    agentName,
    routingReasoning,
    routingModel,
  } = params

  const { data: salva, error: erroMensagem } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      contact_id: contactId,
      role: 'assistant',
      content: agentResponse.content,
      media_type: 'text',
      channel,
      agent: agentName,
      tokens_used: agentResponse.tokensUsed,
    })
    .select('id')
    .single()

  /* Falha aqui não pode passar em silêncio: a resposta some do histórico e do
     painel, e o corretor vê uma conversa em que o bot nunca respondeu. */
  if (erroMensagem) {
    console.error('[Pipeline] falha ao gravar a resposta do agente:', erroMensagem.message)
  }

  if (salva) {
    const trace = agentResponse.trace
    await supabase.from('message_traces').insert({
      message_id: salva.id,
      conversation_id: conversationId,
      contact_id: contactId,
      routed_to: agentName,
      routing_reasoning: routingReasoning,
      routing_model: routingModel,
      agent: agentName,
      agent_model: trace?.model || null,
      agent_tokens: agentResponse.tokensUsed,
      tool_calls: trace?.toolCalls || [],
      prompt_messages: trace?.promptMessages || null,
      raw_response: trace?.rawResponse?.substring(0, 2000) || null,
      total_duration_ms: trace?.durationMs || null,
    })
  }

  await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString(), agent: agentName })
    .eq('id', conversationId)

  await dispatchOutgoing(channel, {
    contactId,
    externalId: replyAddress,
    text: agentResponse.content,
    displayName: agentResponse.waDisplayName,
  })
}

// ==========================================
// Orquestrador — decide qual agente atende a mensagem (PRD 12.2).
//
// O que ele NAO faz: checar cadastro. Isso e resolvido antes, no pipeline
// (resolveRegistration), e aplicado na execucao da tool. O orquestrador escolhe
// o agente pelo conteudo da conversa; se aquela acao especifica pode prosseguir
// sem cadastro e decisao deterministica, nao dele. Ele recebe
// `registration_status` apenas como sinal de contexto.
// ==========================================

import { openai } from '@/lib/openai/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadAgentConfig } from '@/lib/agents/config-loader'
import type { EstadoCadastro } from '@/lib/pipeline/resolve-registration'
import type { OrchestratorResult, RoutableAgent } from '@/lib/types/agents'
import type { Contact } from '@/lib/types/domain'
import { registrarUso } from '@/lib/observabilidade/uso'
import { montarParametros } from '@/lib/agents/parametros'

export const PROMPT_PADRAO = `Você é o roteador central da LoveHome, uma imobiliária em São Paulo.
Seu único papel é analisar a mensagem e o perfil do contato e devolver qual agente atende.

Perfil do contato:
- registration_status: {registration_status}
- contact_roles: {contact_roles}
- funnel_stage: {funnel_stage}
- intent: {intent}
- active_agent: {active_agent}
- has_prior_bot_reply: {has_prior_bot_reply}  (true se o bot já respondeu nesta conversa)

REGRA CRÍTICA — SAUDAÇÃO NÃO É DESPEDIDA:
Saudação abre conversa; despedida fecha.
- "oi", "olá", "bom dia", "boa tarde", "boa noite", "tudo bem?", "e aí" → nunca despedida.
- Se has_prior_bot_reply=false, a mensagem é a PRIMEIRA da pessoa e JAMAIS pode ser despedida,
  por mais curta que seja.

Regras, em ordem de prioridade:

1. active_agent definido e a mensagem não muda claramente de assunto → mantenha o mesmo agente
   (evita reclassificar a cada turno e perder o fio da conversa).
2. Encerramento explícito ("obrigado", "valeu", "até mais", "tudo certo"), SOMENTE se
   has_prior_bot_reply=true → despedida
3. intent=disponibilizar_imovel, OU contact_roles inclui 'proprietario' em conversa nova,
   OU a pessoa diz que TEM um imóvel para alugar/vender → proprietario
4. intent=investimento, ou fala em renda, rentabilidade, portfólio, "investir" → investidor
5. contact_roles inclui 'inquilino_ativo' E fala de boleto, pagamento, contrato, reajuste,
   manutenção ou rescisão → suporte
6. Menciona reservar, "quero esse imóvel", proposta, enviar documentos → closer
7. Menciona agendar, visitar, marcar horário, conhecer o imóvel → agendamento
8. Sem intent definido, ou procurando imóvel para comprar/alugar → sdr
9. Ambiguidade → sdr

Responda SOMENTE em JSON válido, sem markdown:
{"agent": "sdr|investidor|proprietario|agendamento|closer|suporte|despedida", "reasoning": "..."}`

const AGENTES_VALIDOS: RoutableAgent[] = [
  'sdr',
  'investidor',
  'proprietario',
  'agendamento',
  'closer',
  'suporte',
  'despedida',
]

export async function orchestrate(params: {
  message: string
  contact: Contact
  conversationId: string
  cadastro: EstadoCadastro
}): Promise<OrchestratorResult> {
  const { message, contact, conversationId, cadastro } = params
  const supabase = createAdminClient()

  /* Despedida só é válida como resposta a uma troca anterior. Sem esta
     contagem, um "oi" inicial vira despedida e a conversa morre antes de
     começar. */
  const { count: respostasAnteriores } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('role', 'assistant')
    .neq('agent', 'despedida')

  const jaRespondeu = (respostasAnteriores || 0) > 0

  const config = await loadAgentConfig('orchestrator', PROMPT_PADRAO, 'gpt-4o-mini', 0.1)

  const prompt = config.system_prompt
    .replace('{registration_status}', cadastro.status)
    .replace('{contact_roles}', cadastro.roles.length ? cadastro.roles.join(', ') : 'nenhum')
    .replace('{funnel_stage}', contact.funnel_stage)
    .replace('{intent}', contact.intent || 'não identificado')
    .replace('{active_agent}', contact.active_agent || 'nenhum')
    .replace('{has_prior_bot_reply}', String(jaRespondeu))

  /* Ver lib/agents/parametros.ts: gpt-5 e os modelos de raciocinio recusam
     `temperature` e `max_tokens` com 400. O roteador roda em TODA mensagem —
     se ele cai, o atendimento inteiro cai junto. */
  const optionalParams = montarParametros(config.model, {
    temperature: config.temperature,
    top_p: config.top_p,
    max_tokens: config.max_tokens,
  })

  const response = await openai.chat.completions.create({
    model: config.model,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: message },
    ],
    response_format: { type: 'json_object' },
    ...optionalParams,
  })

  /* O roteador roda em TODA mensagem sem agente ativo — é o gasto mais fácil
     de esquecer justamente porque cada chamada é barata. */
  await registrarUso({
    operacao: 'roteamento',
    modelo: config.model,
    tokensEntrada: response.usage?.prompt_tokens,
    tokensSaida: response.usage?.completion_tokens,
    contactId: contact.id,
    conversationId,
    detalhe: {
      resumo: 'Classificou a mensagem para escolher o agente',
      entradas: [
        { rotulo: 'Mensagem do cliente', valor: `${message.length} caracteres` },
        { rotulo: 'Agente ativo antes', valor: contact.active_agent ?? 'nenhum' },
        { rotulo: 'Cadastro', valor: cadastro.status },
      ],
    },
  })

  const content = response.choices[0].message.content ?? '{}'

  let result: OrchestratorResult
  try {
    result = JSON.parse(content)
  } catch {
    result = { agent: 'sdr', reasoning: 'Fallback: resposta do roteador não era JSON válido' }
  }

  if (!AGENTES_VALIDOS.includes(result.agent)) {
    result.reasoning = `${result.reasoning} (nome de agente inválido, corrigido para sdr)`
    result.agent = 'sdr'
  }

  /* Guarda determinística: despedida só depois que o bot já respondeu nesta
     conversa. Não importa o que o modelo decidiu. */
  if (result.agent === 'despedida' && !jaRespondeu) {
    result.reasoning = `[Guarda] Despedida bloqueada — bot ainda não respondeu nesta conversa. Roteado para sdr. Original: ${result.reasoning}`
    result.agent = 'sdr'
  }

  await supabase.from('routing_logs').insert({
    contact_id: contact.id,
    input_message: message.substring(0, 500),
    routed_to: result.agent,
    reasoning: result.reasoning,
    profile_snapshot: {
      registration_status: cadastro.status,
      contact_roles: cadastro.roles,
      funnel_stage: contact.funnel_stage,
      intent: contact.intent,
      active_agent: contact.active_agent,
    },
  })

  // Despedida limpa o active_agent para a próxima mensagem rotear do zero.
  await supabase
    .from('contacts')
    .update({
      active_agent: result.agent === 'despedida' ? null : result.agent,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contact.id)

  return result
}

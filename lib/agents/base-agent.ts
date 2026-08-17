// ==========================================
// Base Agent — execucao compartilhada dos agentes.
//
// O ponto estrutural esta no laco de tool-calling:
// antes de executar qualquer handler, a chamada passa por autorizarTool(). E
// aqui que o gate de cadastro (PRD 6.3) e efetivamente aplicado — nao no
// prompt. Se o modelo tentar create_visit sem cadastro completo, a tool nao
// roda; ele recebe de volta a instrucao de pedir o formulario primeiro.
//
// Colocar essa checagem so no prompt seria o mesmo que nao ter checagem: o
// modelo esquece, e o custo do esquecimento e uma visita agendada ou um extrato
// de pagamento exposto sem identidade confirmada.
// ==========================================

import { openai } from '@/lib/openai/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadAgentConfig } from '@/lib/agents/config-loader'
import { montarParametros } from '@/lib/agents/parametros'
import { autorizarTool, exigeCadastro } from '@/lib/pipeline/resolve-registration'
import { handleRequestRegistrationForm } from '@/lib/agents/tools/registration'
import type { EstadoCadastro } from '@/lib/pipeline/resolve-registration'
import type { ContextoConversa } from '@/lib/pipeline/contexto-conversa'
import type { AgentResponse, ChatHistoryMessage, ToolCallTrace } from '@/lib/types/agents'
import type { AgentName } from '@/lib/types/domain'
import type OpenAI from 'openai'
import { registrarUso } from '@/lib/observabilidade/uso'

type ChatCompletionMessageParam = OpenAI.ChatCompletionMessageParam
type ChatCompletionTool = OpenAI.ChatCompletionTool

/**
 * Bloco de identidade colado no prompt de todo agente.
 * `wa_display_name` e o que o cliente ve como remetente no WhatsApp
 * (ex: "Alice - LoveHome") — o modelo precisa reconhecer isso como nome
 * proprio, e nao como terceira pessoa citada pelo cliente.
 */
function buildIdentityBlock(displayName: string | null | undefined): string {
  const trimmed = (displayName || '').trim()
  if (!trimmed) return ''
  const primeiroNome = trimmed.split(/[\s\-—]/).filter(Boolean)[0] || trimmed
  return `

IDENTIDADE NO WHATSAPP:
- Seu nome de exibição é "${trimmed}". A pessoa pode te chamar de "${primeiroNome}" ou "${trimmed}".
- Se te cumprimentarem pelo nome (ex: "Oi ${primeiroNome}"), reconheça naturalmente como sendo você. Nunca diga que essa pessoa é alguém que o cliente mencionou.
- Você é parte da equipe da LoveHome Imóveis. Não invente um nome diferente.`
}

// Tool disponivel para todos os agentes
const escalateToHumanTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'escalate_to_human',
    description:
      'Transfere a conversa para atendimento humano. Use quando a pessoa pedir explicitamente para falar com um corretor, ou quando você não conseguir resolver.',
    parameters: {
      type: 'object',
      properties: {
        motivo: {
          type: 'string',
          description: 'Motivo da escalação (ex: "cliente pediu corretor humano", "fora do escopo")',
        },
      },
      required: ['motivo'],
    },
  },
}

interface BaseAgentConfig {
  agentName: AgentName
  systemPrompt: string
  tools?: ChatCompletionTool[]
  toolHandlers?: Record<string, (args: Record<string, unknown>) => Promise<unknown>>
  maxHistoryMessages?: number
  model?: string
  /** Contexto extra colado no fim do prompt (perfil, imóveis já vistos etc.) */
  extraContext?: string
  /**
   * A conversa inteira, de todos os agentes, em ordem cronológica
   * (lib/pipeline/contexto-conversa). O histórico por agente continua sendo o
   * que vai como mensagens de chat; isto entra no prompt como transcrição, e é
   * o que faz o Agendamento saber qual imóvel o SDR acabou de mostrar.
   */
  contextoConversa?: ContextoConversa
}

/** Carrega o historico do agente para este contato. */
export async function loadAgentHistory(
  contactId: string,
  agentName: AgentName,
  maxMessages: number = 20
): Promise<ChatCompletionMessageParam[]> {
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('agent_histories')
    .select('messages')
    .eq('contact_id', contactId)
    .eq('agent', agentName)
    .maybeSingle()

  if (!data?.messages) return []

  const messages = data.messages as ChatHistoryMessage[]
  const recentes = messages.slice(-maxMessages)

  return recentes.map((m) => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
  }))
}

/** Persiste as mensagens novas no historico do agente. */
export async function updateAgentHistory(
  contactId: string,
  agentName: AgentName,
  newMessages: ChatHistoryMessage[],
  tokensUsed: number = 0
): Promise<void> {
  const supabase = createAdminClient()

  const { data: existente } = await supabase
    .from('agent_histories')
    .select('messages, token_total')
    .eq('contact_id', contactId)
    .eq('agent', agentName)
    .maybeSingle()

  if (existente) {
    const todas = [...(existente.messages as ChatHistoryMessage[]), ...newMessages]
    // Corta em 50 para o histórico não crescer sem limite
    const cortadas = todas.slice(-50)

    await supabase
      .from('agent_histories')
      .update({
        messages: cortadas,
        token_total: (existente.token_total || 0) + tokensUsed,
        updated_at: new Date().toISOString(),
      })
      .eq('contact_id', contactId)
      .eq('agent', agentName)
  } else {
    await supabase.from('agent_histories').insert({
      contact_id: contactId,
      agent: agentName,
      messages: newMessages,
      token_total: tokensUsed,
    })
  }
}

/**
 * Bloco de estado de cadastro colado no prompt.
 *
 * Isto NAO delega a decisao ao modelo — o bloqueio continua sendo aplicado em
 * autorizarTool, na execucao da tool. O que este bloco resolve e outra coisa:
 * sem ele, o agente so descobre que falta cadastro quando a tool volta barrada,
 * ou seja, depois de negociar o horario inteiro com a pessoa. O PRD (4.1, passo
 * 5) pede o formulario ANTES de confirmar o horario, e para isso o agente
 * precisa saber do fato desde o primeiro turno.
 *
 * So aparece para agentes que tem alguma tool sob o gate; para o SDR, cuja
 * conversa e livre, injetar isso so induziria a pedir cadastro sem necessidade.
 */
/**
 * Quando o agente opera acoes sob o gate e a pessoa ainda nao tem cadastro,
 * o link e gerado AQUI, deterministicamente, e nao por tool call.
 *
 * Duas falhas observadas em teste levaram a este desenho:
 *   1. O agente dizia "vou te enviar o link" e nao chamava a tool — a pessoa
 *      esperava um link que nunca chegava.
 *   2. Com o link ja no contexto, o modelo ainda escolhia nao mencionar o
 *      cadastro naquele turno, porque "quando trazer o assunto" continuava
 *      sendo julgamento dele.
 *
 * Por isso o link vira dado pronto no prompt E o envio tem rede de seguranca
 * (garantirLinkCadastro). O mesmo principio do gate: o que importa nao depende
 * de o modelo lembrar.
 * handleRequestRegistrationForm reaproveita formulario pendente valido, entao
 * chamar a cada turno nao gera link novo nem polui form_submissions.
 */
async function gerarLinkCadastro(
  estado: EstadoCadastro,
  tools: ChatCompletionTool[],
  contactId: string
): Promise<string | null> {
  const temToolSobGate = tools.some((t) => t.type === 'function' && exigeCadastro(t.function.name))
  if (!temToolSobGate || estado.status === 'completo') return null

  const form = await handleRequestRegistrationForm(contactId, { form_type: 'cadastro' })
  return (form as { link?: string }).link ?? null
}

function buildRegistrationBlock(estado: EstadoCadastro, link: string | null): string {
  if (estado.status === 'completo') {
    return `

CADASTRO: esta pessoa já tem cadastro completo${estado.nomeCompleto ? ` (${estado.nomeCompleto})` : ''}. Pode seguir com as ações que exigem identidade sem pedir nada.`
  }

  if (!link) return ''

  const situacao =
    estado.status === 'pending'
      ? 'iniciou o cadastro mas ainda não concluiu'
      : 'ainda não tem cadastro'

  return `

CADASTRO — LEIA ANTES DE AGIR: esta pessoa ${situacao}.
Confirmar visita, reservar imóvel, publicar imóvel ou consultar contrato e pagamento NÃO vão
funcionar até o cadastro estar completo — a tool será recusada.

Inclua o cadastro NESTA resposta, junto com os horários ou condições que você propuser.
O link já está pronto:
${link}

Escreva o link exatamente assim, sozinho numa linha, com uma frase curta de contexto
("pra confirmar eu vou precisar do seu cadastro, leva dois minutinhos"). Nunca diga que "vai
enviar" o link sem colocá-lo na mensagem. Não transforme isso no assunto da conversa.`
}

/**
 * Rede de seguranca: se o agente nao colocou o link e ele ainda nao foi enviado
 * nesta conversa, o sistema acrescenta. Sem isso, a pessoa negocia o horario
 * inteiro e so descobre a exigencia quando a tool e recusada — o oposto do que
 * a secao 4.1 do PRD descreve.
 *
 * "Nesta conversa" e a conversa inteira, nao so o historico deste agente: o
 * SDR mandava o link, o Agendamento assumia com historico proprio vazio e
 * mandava de novo, como se fosse a primeira vez.
 */
function garantirLinkCadastro(
  conteudo: string,
  link: string | null,
  historico: ChatCompletionMessageParam[],
  jaEnviadoNaConversa: boolean
): string {
  if (!link || conteudo.includes(link)) return conteudo

  const jaEnviado =
    jaEnviadoNaConversa ||
    historico.some(
      (m) =>
        m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('/cadastro/')
    )
  if (jaEnviado) return conteudo

  return `${conteudo}\n\nAh — pra confirmar eu vou precisar do seu cadastro, leva dois minutinhos:\n${link}`
}

/**
 * Rede de seguranca contra LINK INVENTADO.
 *
 * O modelo escreveu `https://www.lovehome.com.br/imovel/LH-1001` para um
 * cliente — dominio e caminho que nunca existiram. Um link errado mandado pelo
 * WhatsApp da imobiliaria e pior do que nenhum: parece phishing, e o cliente
 * nao tem como saber que foi alucinacao.
 *
 * Toda URL legitima que um agente pode enviar nasce em algum lugar que o
 * sistema controla: retorno de tool (link do imovel, boleto do Asaas), o link
 * de cadastro gerado pelo proprio base-agent, ou o prompt. Uma URL na resposta
 * que nao esteja em nenhuma dessas fontes e removida — e logada, para o trace
 * mostrar que houve tentativa. O prompt pede a versao certa (`instrucao_links`
 * na tool); isto e o que garante.
 */
const PADRAO_URL = /https?:\/\/[^\s<>"'`)\]]+/g

export function removerLinksInventados(
  conteudo: string,
  fontesConfiaveis: string[]
): { texto: string; removidos: string[] } {
  const permitidas = new Set<string>()
  for (const fonte of fontesConfiaveis) {
    for (const url of fonte.match(PADRAO_URL) ?? []) permitidas.add(url.replace(/[.,;:!?]+$/, ''))
  }

  const removidos: string[] = []
  const texto = conteudo.replace(PADRAO_URL, (url) => {
    const limpa = url.replace(/[.,;:!?]+$/, '')
    if (permitidas.has(limpa)) return url
    removidos.push(limpa)
    return ''
  })

  // Sem link sobra frase pendurada ("Aqui esta o link:") — limpa o rastro.
  const arrumado = removidos.length
    ? texto.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    : texto

  return { texto: arrumado, removidos }
}

const REGRAS_WHATSAPP = `

REGRAS DE FORMATAÇÃO PARA WHATSAPP (obrigatório):
- Você está conversando pelo WhatsApp. Escreva como uma pessoa real digitando no celular.
- Mensagens CURTAS e naturais (máximo 3-4 linhas). Quebre em parágrafos curtos separados por linha em branco.
- NUNCA use formatação de catálogo: nada de bullet points (- ou •), listas numeradas, seções com título, ou estrutura de e-mail.
- NUNCA simule botões como [Ver imóvel] ou [Agendar visita]. WhatsApp não tem botões. Envie o link direto no texto.
- NUNCA use asteriscos para negrito. Escreva de forma simples.
- Links aparecem sozinhos numa linha, sem colchetes.
- Ao apresentar imóveis, descreva em frases corridas, não em lista. Máximo 2 ou 3 opções por mensagem.
- LINKS: só envie URL que veio de uma ferramenta (campo link, foto_capa, link de cadastro, boleto). NUNCA escreva uma URL de memória nem "complete" um endereço — o sistema remove qualquer link que não tenha vindo de ferramenta.
- FOTOS: se pedirem fotos de um imóvel, mande o link da página dele (abre com a galeria) ou a URL da foto de capa. Não diga que não consegue mostrar fotos.`

/**
 * Executa um agente com laco de tool-calling.
 *
 * `estadoCadastro` vem pronto do pipeline (resolveRegistration) e e o que
 * autoriza ou barra cada tool. Passar undefined trata como sem cadastro — o
 * default seguro: na duvida, bloqueia acao de consequencia.
 */
export async function executeAgent(
  config: BaseAgentConfig,
  contactId: string,
  userMessage: string,
  estadoCadastro?: EstadoCadastro
): Promise<AgentResponse> {
  const {
    agentName,
    systemPrompt,
    tools = [],
    toolHandlers = {},
    maxHistoryMessages = 20,
    model = 'gpt-4o',
    extraContext = '',
    contextoConversa,
  } = config

  const estado: EstadoCadastro = estadoCadastro ?? {
    status: 'none',
    registrationId: null,
    roles: [],
    nomeCompleto: null,
  }

  const dbConfig = await loadAgentConfig(agentName, systemPrompt, model)
  const identityBlock = buildIdentityBlock(dbConfig.wa_display_name)
  const linkCadastro = await gerarLinkCadastro(estado, tools, contactId)
  const registrationBlock = buildRegistrationBlock(estado, linkCadastro)

  /* REGRAS_WHATSAPP vai por ULTIMO, nao no meio do prompt. Os prompts dos
     agentes usam lista numerada para descrever o passo a passo, e o modelo
     espelhava esse formato na resposta ao cliente — saia com bullet point, que
     e justamente o que denuncia robo no WhatsApp. Instrucao de formatacao no
     fim compete melhor com o formato do texto que veio antes. */
  const blocoConversa = contextoConversa?.bloco ?? ''
  const effectivePrompt =
    dbConfig.system_prompt +
    identityBlock +
    registrationBlock +
    blocoConversa +
    extraContext +
    REGRAS_WHATSAPP
  const effectiveModel = dbConfig.model

  /* A temperatura vinha sendo CARREGADA e nunca enviada — so o orquestrador a
     usava. Com a tela de Agentes editando esse campo, quem mexesse nele estaria
     mudando um numero que nao chegava a lugar nenhum: ajuste sem efeito e sem
     aviso, que e a pior forma de configuracao. */
  /* Cada familia de modelo aceita um payload diferente — gpt-5 e o4-mini
     recusam `temperature` e `max_tokens`, e a recusa e 400 na requisicao, nao
     um aviso. `montarParametros` e o ponto unico que sabe disso. */
  const optionalParams = montarParametros(effectiveModel, {
    temperature: dbConfig.temperature,
    top_p: dbConfig.top_p,
    max_tokens: dbConfig.max_tokens,
    frequency_penalty: dbConfig.frequency_penalty,
    presence_penalty: dbConfig.presence_penalty,
  })

  const history = await loadAgentHistory(contactId, agentName, maxHistoryMessages)

  const allTools = [...tools, escalateToHumanTool]
  const allHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    ...toolHandlers,
    escalate_to_human: async (args) => ({
      escalated: true,
      message: 'Conversa marcada para atendimento humano. Um corretor assume em breve.',
      motivo: (args as { motivo: string }).motivo,
    }),
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: effectivePrompt },
    ...history,
    { role: 'user', content: userMessage },
  ]

  const toolsUsed: string[] = []
  const toolCallTraces: ToolCallTrace[] = []
  let totalTokens = 0
  /* Separados porque saída custa ~4x mais que entrada: somar só o total
     subestimaria o gasto de agente, que é justamente quem mais escreve. */
  let tokensEntrada = 0
  let tokensSaida = 0
  const startTime = Date.now()

  const promptSnapshot = messages.map((m) => ({
    role: (m as { role: string }).role,
    content:
      typeof (m as { content: unknown }).content === 'string'
        ? (m as { content: string }).content.substring(0, 500)
        : null,
  }))

  let response = await openai.chat.completions.create({
    model: effectiveModel,
    messages,
    ...(allTools.length > 0 ? { tools: allTools, tool_choice: 'auto' as const } : {}),
    ...optionalParams,
  })

  totalTokens += response.usage?.total_tokens ?? 0
  tokensEntrada += response.usage?.prompt_tokens ?? 0
  tokensSaida += response.usage?.completion_tokens ?? 0

  /* Quantas idas e voltas com o modelo: cada rodada reenvia o histórico
     inteiro, então é a causa mais comum de conta alta numa resposta só. */
  let rodadas = 1

  while (
    response.choices[0].finish_reason === 'tool_calls' ||
    (response.choices[0].message.tool_calls && response.choices[0].message.tool_calls.length > 0)
  ) {
    rodadas += 1
    const toolCalls = response.choices[0].message.tool_calls!

    /* SEQUENCIAL, não Promise.all.
       Paralelizar só é seguro quando as tools são leituras independentes. Aqui o modelo chama, na mesma
       rodada, save_property_draft e submit_property_listing — que escrevem e
       leem o mesmo rascunho. Em paralelo o submit lia o estado anterior e o
       imóvel era criado sem a área e sem o preço que a pessoa acabara de dizer.
       Silencioso, e só aparecia às vezes.
       O custo é latência quando o modelo pede várias tools de uma vez; o
       benefício é que a ordem que ele pediu é a ordem que acontece. */
    const toolResults: ChatCompletionMessageParam[] = []

    for (const call of toolCalls) {
      toolResults.push(
        await (async () => {
        if (call.type === 'function') {
          const args = JSON.parse(call.function.arguments)
          let result: unknown

          toolsUsed.push(call.function.name)
          const toolStart = Date.now()

          // ---- Gate de cadastro (PRD 6.3) ----
          // Ponto de aplicacao real da regra. O modelo pode ate tentar, mas a
          // tool nao executa; ele recebe a instrucao do que fazer antes.
          const gate = autorizarTool(call.function.name, estado)

          if (!gate.permitido) {
            result = {
              erro: 'cadastro_incompleto',
              registration_status: estado.status,
              instrucao: gate.motivo,
            }
            console.log(
              `[base-agent] ${agentName}: ${call.function.name} bloqueada — cadastro ${estado.status}`
            )
          } else if (allHandlers[call.function.name]) {
            try {
              result = await allHandlers[call.function.name](args)
            } catch (error) {
              result = { error: `Falha ao executar a tool: ${(error as Error).message}` }
            }
          } else {
            result = { error: 'Tool não implementada' }
          }

          toolCallTraces.push({
            name: call.function.name,
            arguments: args,
            result,
            duration_ms: Date.now() - toolStart,
          })

          return {
            role: 'tool' as const,
            tool_call_id: call.id,
            content: JSON.stringify(result),
          }
        }

        return {
          role: 'tool' as const,
          tool_call_id: (call as { id: string }).id,
          content: JSON.stringify({ error: 'Tipo de tool desconhecido' }),
        }
        })()
      )
    }

    messages.push(response.choices[0].message as ChatCompletionMessageParam, ...toolResults)

    response = await openai.chat.completions.create({
      model: effectiveModel,
      messages,
      ...(allTools.length > 0 ? { tools: allTools, tool_choice: 'auto' as const } : {}),
      ...optionalParams,
    })

    totalTokens += response.usage?.total_tokens ?? 0
    tokensEntrada += response.usage?.prompt_tokens ?? 0
    tokensSaida += response.usage?.completion_tokens ?? 0
  }

  /* Fontes de URL confiaveis desta rodada: tudo o que as tools devolveram, o
     link de cadastro, o prompt de sistema e o que a equipe JA mandou nesta
     conversa (repetir o link do imovel que o SDR enviou nao e inventar).
     Qualquer outra URL e invencao. */
  const fontesDeLink = [
    ...toolCallTraces.map((t) => JSON.stringify(t.result ?? '')),
    linkCadastro ?? '',
    dbConfig.system_prompt,
    ...(contextoConversa?.urlsEnviadas ?? []),
  ]
  const semInventados = removerLinksInventados(
    response.choices[0].message.content ?? '',
    fontesDeLink
  )
  if (semInventados.removidos.length) {
    console.warn(
      `[${agentName}] link inventado removido da resposta: ${semInventados.removidos.join(', ')}`
    )
  }

  const assistantContent = garantirLinkCadastro(
    semInventados.texto,
    linkCadastro,
    history,
    contextoConversa?.cadastroJaEnviado ?? false
  )
  const totalDuration = Date.now() - startTime

  await registrarUso({
    operacao: 'agente',
    modelo: effectiveModel,
    tokensEntrada,
    tokensSaida,
    tokensTotal: totalTokens,
    duracaoMs: totalDuration,
    agente: agentName,
    contactId,
    /* O "por que custou isso". Histórico longo e retorno grande de tool são as
       duas causas de conta alta, e nenhuma das duas é visível olhando só o
       total de tokens. */
    detalhe: {
      resumo: `${agentName} respondeu${
        toolCallTraces.length ? ` usando ${toolCallTraces.length} ferramenta(s)` : ' sem ferramentas'
      }`,
      entradas: [
        { rotulo: 'Mensagens no histórico', valor: String(history.length) },
        { rotulo: 'Mensagens da conversa no contexto', valor: String(contextoConversa?.total ?? 0) },
        {
          rotulo: 'Prompt de sistema',
          valor: `${Math.round(dbConfig.system_prompt.length / 100) / 10} mil caracteres`,
        },
        { rotulo: 'Mensagem do cliente', valor: `${userMessage.length} caracteres` },
        { rotulo: 'Resposta', valor: `${assistantContent.length} caracteres` },
        {
          rotulo: 'Retorno das ferramentas',
          valor: `${toolCallTraces.reduce(
            (t, c) => t + JSON.stringify(c.result ?? '').length,
            0
          )} caracteres`,
        },
        { rotulo: 'Rodadas com o modelo', valor: String(rodadas) },
      ],
      tools: toolCallTraces.map((t) => ({ nome: t.name, ms: t.duration_ms })),
    },
  })

  const timestamp = new Date().toISOString()
  await updateAgentHistory(
    contactId,
    agentName,
    [
      { role: 'user', content: userMessage, created_at: timestamp },
      { role: 'assistant', content: assistantContent, created_at: timestamp },
    ],
    totalTokens
  )

  return {
    content: assistantContent,
    tokensUsed: totalTokens,
    toolsUsed,
    waDisplayName: dbConfig.wa_display_name,
    trace: {
      model: effectiveModel,
      toolCalls: toolCallTraces,
      promptMessages: promptSnapshot,
      rawResponse: assistantContent,
      durationMs: totalDuration,
    },
  }
}

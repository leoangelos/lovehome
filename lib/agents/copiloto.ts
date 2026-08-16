// ==========================================
// Copiloto do Corretor (PRD 12.8) — assistente INTERNO do painel.
//
// Não passa pelo Orquestrador, não fala com cliente, não usa WhatsApp. Por isso
// não reaproveita `executeAgent`: aquele laço carrega histórico por contato,
// injeta o gate de cadastro, cola as regras de escrita de WhatsApp e oferece
// escalate_to_human — nada disso faz sentido para um corretor logado no painel
// perguntando qual é a agenda dele.
//
// Identidade vem do Supabase Auth. A §12.8 explica por que isso importa: detectar
// "esse telefone é de um corretor" no mesmo número público que os clientes usam
// abriria spoofing de número virando comando interno.
//
// HISTÓRICO É EFÊMERO, e de propósito. `agent_histories` é chaveada por
// `contact_id NOT NULL` — um corretor não é um contato, e forçá-lo lá dentro
// exigiria afrouxar a FK que sustenta as duas camadas de identidade da §6. O
// painel manda a conversa inteira a cada pergunta. O cliente controlar o próprio
// histórico é inofensivo aqui porque TODO o recorte de dados é aplicado no
// servidor, pelo escopo da sessão: forjar mensagem não alcança dado de outra
// carteira, no máximo confunde o próprio assistente de quem forjou.
// ==========================================

import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { criarToolsCopiloto, type EscopoCopiloto } from '@/lib/agents/tools/copiloto'
import { searchPropertiesTool, handleSearchProperties } from '@/lib/agents/tools/properties'
import { registrarUso } from '@/lib/observabilidade/uso'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const MODELO = 'gpt-4o'
const MAX_RODADAS = 5
/** Teto de mensagens vindas do painel — conversa longa não pode virar prompt infinito. */
const MAX_HISTORICO = 20

export interface MensagemCopiloto {
  role: 'user' | 'assistant'
  content: string
}

export interface RespostaCopiloto {
  content: string
  toolsUsadas: string[]
  tokens: number
}

function promptSistema(escopo: EscopoCopiloto): string {
  const recorte = escopo.brokerId
    ? `Você atende ${escopo.nome}, corretor. TODOS os dados que suas tools devolvem já vêm
filtrados para a carteira dele — você não tem como consultar a carteira de outro corretor,
e não deve prometer isso. Se pedirem dado de outra pessoa, diga que o painel só mostra a
carteira própria e sugira falar com um administrador.`
    : `Você atende ${escopo.nome}, que enxerga a operação inteira. Ao citar números, deixe
claro que são da imobiliária toda, não de um corretor específico.`

  /* O modelo precisa saber o que NÃO alcança, senão promete consultar o que
     não tem ferramenta para consultar e a pessoa fica esperando. Isto é para a
     resposta ficar honesta — quem barra de verdade é a lista de tools, montada
     no servidor a partir da matriz da §9.2. */
  const semAcesso = [
    !escopo.recursos.includes('pagamentos') && 'cobrança e inadimplência',
    !escopo.recursos.includes('leads') && 'leads e contatos de cliente',
    !escopo.recursos.includes('contratos') && 'contratos e negócios',
    !escopo.recursos.includes('visitas') && 'agenda de visitas',
  ].filter(Boolean)

  const limite = semAcesso.length
    ? `
O PERFIL DESTA PESSOA NÃO ALCANÇA: ${semAcesso.join(', ')}. Se perguntarem sobre isso,
diga que o acesso dela não cobre esse dado e sugira falar com um administrador. Não estime,
não deduza de outra fonte e não prometa consultar depois.
`
    : ''

  return `Você é o Copiloto do LoveHome, assistente interno da equipe da imobiliária.

${recorte}
${limite}
COMO RESPONDER
- Quem lê está trabalhando: vá direto ao ponto. Duas ou três frases resolvem a maioria.
- Use os dados das tools. Nunca invente visita, lead, negócio, valor ou documento.
- Se a tool não achou nada, diga que não achou. Não preencha o vazio com suposição.
- Pode usar listas curtas quando forem vários itens (agenda, documentos) — aqui é painel
  web, não WhatsApp.
- Valores em reais já vêm formatados. Não recalcule nem converta.
- CPF aparece mascarado. Não peça, não reconstrua e não comente o número.

O QUE VOCÊ NÃO FAZ
- Não aprova negócio, não gera contrato, não confere documento e não agenda visita.
  Essas ações têm gate humano e telas próprias no painel. Quando alguém pedir, diga onde
  fazer: negócios e contratos em /admin/contratos, documentos em /admin/documentos,
  visitas em /admin/visitas.
- Não fala com cliente e não escreve mensagem para enviar por você mesmo. Se pedirem um
  texto para mandar ao cliente, escreva o texto e deixe claro que quem envia é o corretor.

Hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}.`
}

export async function responderCopiloto(
  escopo: EscopoCopiloto,
  pergunta: string,
  historico: MensagemCopiloto[] = []
): Promise<RespostaCopiloto> {
  const { tools, handlers } = criarToolsCopiloto(escopo)

  /* search_properties é reaproveitada da §11 sem recorte por corretor, e é
     intencional: o corretor vende o portfólio da imobiliária, não só o que está
     no nome dele. O que a §9.3 recorta é a GESTÃO dos imóveis dele, não a
     consulta ao que está disponível para oferecer. */
  const todasTools = [...tools, searchPropertiesTool]
  const todosHandlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    ...handlers,
    search_properties: (args) => handleSearchProperties(args as never),
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: promptSistema(escopo) },
    ...historico.slice(-MAX_HISTORICO).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: pergunta },
  ]

  const toolsUsadas: string[] = []
  let tokens = 0
  let tokensEntrada = 0
  let tokensSaida = 0
  const inicio = Date.now()

  let response = await openai.chat.completions.create({
    model: MODELO,
    messages,
    tools: todasTools,
    tool_choice: 'auto',
  })
  tokens += response.usage?.total_tokens ?? 0
  tokensEntrada += response.usage?.prompt_tokens ?? 0
  tokensSaida += response.usage?.completion_tokens ?? 0

  let rodada = 0
  while (response.choices[0].message.tool_calls?.length && rodada < MAX_RODADAS) {
    rodada++
    const chamadas = response.choices[0].message.tool_calls
    messages.push(response.choices[0].message)

    /* Sequencial, como no base-agent. Aqui todas as tools são leitura, mas
       manter o mesmo idioma evita que a próxima tool que escreva algo herde um
       paralelismo que ninguém revisou. */
    for (const call of chamadas) {
      if (call.type !== 'function') continue

      let resultado: unknown
      try {
        const args = JSON.parse(call.function.arguments || '{}')
        toolsUsadas.push(call.function.name)
        const handler = todosHandlers[call.function.name]
        resultado = handler
          ? await handler(args)
          : { erro: `Tool ${call.function.name} não existe.` }
      } catch (e) {
        console.error(`[copiloto] ${call.function.name} falhou:`, e)
        resultado = { erro: 'Não consegui consultar isso agora.' }
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(resultado),
      })
    }

    response = await openai.chat.completions.create({
      model: MODELO,
      messages,
      tools: todasTools,
      tool_choice: 'auto',
    })
    tokens += response.usage?.total_tokens ?? 0
    tokensEntrada += response.usage?.prompt_tokens ?? 0
    tokensSaida += response.usage?.completion_tokens ?? 0
  }

  await registrarUso({
    operacao: 'copiloto',
    modelo: MODELO,
    tokensEntrada,
    tokensSaida,
    tokensTotal: tokens,
    duracaoMs: Date.now() - inicio,
    canal: 'painel',
    detalhe: {
      resumo: `Copiloto respondeu no painel${
        toolsUsadas.length ? ` usando ${toolsUsadas.length} ferramenta(s)` : ''
      }`,
      entradas: [
        { rotulo: 'Mensagens enviadas pelo painel', valor: String(historico.length) },
        { rotulo: 'Rodadas com o modelo', valor: String(rodada + 1) },
      ],
      tools: toolsUsadas.map((t) => ({ nome: t })),
    },
  })

  return {
    content:
      response.choices[0].message.content?.trim() ||
      'Não consegui montar a resposta agora. Tente de novo em instantes.',
    toolsUsadas,
    tokens,
  }
}

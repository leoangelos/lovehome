// ==========================================
// Agente SDR — qualifica quem procura imóvel para comprar ou alugar (PRD 12.3,
// Exemplo 1). Não existe agente separado de "conteúdo": a busca de imóveis é
// a tool search_properties, aqui dentro.
// ==========================================

import { executeAgent } from './base-agent'
import { searchPropertiesTool, handleSearchProperties } from './tools/properties'
import { saveQualificationTool, handleSaveQualification } from './tools/qualification'
import { requestRegistrationFormTool, handleRequestRegistrationForm } from './tools/registration'
import { searchKnowledgeBaseTool, handleSearchKnowledgeBase } from './tools/conhecimento'
import type { EstadoCadastro } from '@/lib/pipeline/resolve-registration'
import type { AgentResponse } from '@/lib/types/agents'
import type OpenAI from 'openai'

export const PROMPT = `Você atende quem procura imóvel na LoveHome, uma imobiliária boutique em São Paulo.
Seu papel é entender o que a pessoa precisa e mostrar imóveis reais que sirvam.

Como conduzir:
1. Descubra a intenção (comprar ou alugar) e chame save_qualification assim que souber.
2. Colete o que falta de forma conversada, uma coisa de cada vez: região, faixa de preço,
   dormitórios, prazo. Nunca dispare três perguntas na mesma mensagem.
3. Não repita o que a pessoa já disse. Se ela abriu com "procuro apartamento na zona sul",
   você já tem tipo e região — pergunte o resto.
4. Assim que tiver operação mais região OU faixa de preço, chame search_properties e
   apresente 2 ou 3 opções. Não espere ter todos os dados para mostrar algo.
5. Apresente os imóveis em frases corridas, com o que importa: bairro, dormitórios, área,
   preço e um detalhe que diferencie. Sempre cite o código (ex: LH-1001).
6. Quando a pessoa demonstrar interesse em conhecer um imóvel, ofereça agendar a visita —
   quem conduz o agendamento é outro agente, então apenas confirme o interesse.

Regras que não se quebram:
- NUNCA invente imóvel, preço ou característica. Só existe o que search_properties devolveu.
- Se a busca não achar nada, diga com franqueza e ofereça ampliar preço ou região vizinha.
- Buscar e conversar NÃO exigem cadastro. Não peça CPF para mostrar imóvel.
- Se alguém falar em investimento, renda ou rentabilidade, diga que vai chamar quem cuida
  disso e encerre sua parte — não tente qualificar investidor.`

export async function runSdrAgent(
  contactId: string,
  message: string,
  cadastro: EstadoCadastro,
  extraContext = ''
): Promise<AgentResponse> {
  const tools: OpenAI.ChatCompletionTool[] = [
    searchPropertiesTool,
    saveQualificationTool,
    requestRegistrationFormTool,
    searchKnowledgeBaseTool,
  ]

  return executeAgent(
    {
      agentName: 'sdr',
      systemPrompt: PROMPT,
      tools,
      toolHandlers: {
        search_properties: (args) => handleSearchProperties(args as never),
        save_qualification: (args) => handleSaveQualification(contactId, args),
        request_registration_form: (args) =>
          handleRequestRegistrationForm(contactId, args as never),
        search_knowledge_base: (args) => handleSearchKnowledgeBase(args as never),
      },
      extraContext,
    },
    contactId,
    message,
    cadastro
  )
}

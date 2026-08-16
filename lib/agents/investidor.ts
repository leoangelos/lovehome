// ==========================================
// Agente Investidor — qualifica perfil de investimento (PRD 12.3, Exemplo 2).
// ==========================================

import { executeAgent } from './base-agent'
import { searchPropertiesTool, handleSearchProperties } from './tools/properties'
import { saveQualificationTool, handleSaveQualification } from './tools/qualification'
import type { EstadoCadastro } from '@/lib/pipeline/resolve-registration'
import type { AgentResponse } from '@/lib/types/agents'
import type OpenAI from 'openai'

export const PROMPT = `Você atende quem quer investir em imóveis para renda na LoveHome.
Fale como quem entende do assunto, sem jargão de corretor de investimento.

O que precisa descobrir, na ordem natural da conversa:
1. Se é a primeira vez investindo ou se já tem portfólio.
2. Quanto tem disponível (ticket).
3. Que retorno espera — e se o foco é renda mensal ou valorização.
Chame save_qualification a cada dado novo, com intent="investimento".

Ao mostrar opções, chame search_properties e priorize o que faz sentido para renda:
studios e unidades compactas em região de alta demanda de locação. Quando o imóvel já
estiver locado, isso é o argumento mais forte — renda desde o primeiro mês.

Regras:
- NUNCA prometa rentabilidade, nem estime percentual de retorno. Você não faz projeção
  financeira. Apresente preço, aluguel praticado na região e deixe a conta com a pessoa.
- NUNCA invente imóvel ou número. Só o que search_properties devolveu.
- Quando o perfil estiver claro, diga que vai passar para o corretor especialista em
  investimento e encerre sua parte de forma natural.`

export async function runInvestidorAgent(
  contactId: string,
  message: string,
  cadastro: EstadoCadastro,
  extraContext = ''
): Promise<AgentResponse> {
  const tools: OpenAI.ChatCompletionTool[] = [searchPropertiesTool, saveQualificationTool]

  return executeAgent(
    {
      agentName: 'investidor',
      systemPrompt: PROMPT,
      tools,
      toolHandlers: {
        search_properties: (args) => handleSearchProperties(args as never),
        save_qualification: (args) => handleSaveQualification(contactId, args),
      },
      extraContext,
    },
    contactId,
    message,
    cadastro
  )
}

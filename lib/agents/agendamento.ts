// ==========================================
// Agente Agendamento — marca visitas consultando a agenda interna (PRD 12.5).
//
// E o primeiro agente do fluxo que esbarra no gate de cadastro: conversar e
// buscar imovel sao livres, mas confirmar horario e acao de consequencia e
// exige registration_status = 'completo'. Quem barra e o base-agent, nao este
// prompt — o prompt so ensina o que fazer quando a tool voltar bloqueada.
// ==========================================

import { executeAgent } from './base-agent'
import {
  checkBrokerAvailabilityTool,
  createVisitTool,
  handleCheckBrokerAvailability,
  handleCreateVisit,
} from './tools/visits'
import { requestRegistrationFormTool, handleRequestRegistrationForm } from './tools/registration'
import { searchPropertiesTool, handleSearchProperties } from './tools/properties'
import type { EstadoCadastro } from '@/lib/pipeline/resolve-registration'
import type { AgentResponse } from '@/lib/types/agents'
import type OpenAI from 'openai'

export const PROMPT = `Você agenda visitas a imóveis da LoveHome.

Como conduzir:
1. Confirme qual imóvel a pessoa quer visitar. Se ela não citar o código, use
   search_properties para localizar pelo que ela descreveu e confirme antes de seguir.
2. Chame check_broker_availability e ofereça no máximo 3 horários, em linguagem natural
   ("quinta às 10h", "sexta de manhã") — nunca data em formato técnico.
3. Quando a pessoa escolher, chame create_visit.
4. Confirme o agendamento em uma mensagem curta: dia, hora, imóvel e nome do corretor.

Se create_visit voltar com erro "cadastro_incompleto":
- Explique em UMA frase que para confirmar a visita você precisa do cadastro, porque o
  corretor precisa saber quem vai receber no imóvel.
- Chame request_registration_form com form_type="cadastro" e envie o link.
- Diga que assim que ela preencher você confirma o horário. NÃO fique repetindo o pedido.
- Não trate isso como recusa: o horário continua reservado na conversa, é só concluir o cadastro.

Se create_visit voltar dizendo que o horário foi ocupado, peça desculpa em meia linha,
chame check_broker_availability de novo e ofereça outras opções.

Nunca invente horário disponível. Nunca confirme visita sem create_visit ter retornado sucesso.`

export async function runAgendamentoAgent(
  contactId: string,
  message: string,
  cadastro: EstadoCadastro,
  extraContext = ''
): Promise<AgentResponse> {
  const tools: OpenAI.ChatCompletionTool[] = [
    checkBrokerAvailabilityTool,
    createVisitTool,
    requestRegistrationFormTool,
    searchPropertiesTool,
  ]

  return executeAgent(
    {
      agentName: 'agendamento',
      systemPrompt: PROMPT,
      tools,
      toolHandlers: {
        check_broker_availability: (args) => handleCheckBrokerAvailability(args as never),
        create_visit: (args) => handleCreateVisit(contactId, args as never),
        request_registration_form: (args) =>
          handleRequestRegistrationForm(contactId, args as never),
        search_properties: (args) => handleSearchProperties(args as never),
      },
      extraContext,
    },
    contactId,
    message,
    cadastro
  )
}

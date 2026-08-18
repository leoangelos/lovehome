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
  cancelVisitTool,
  checkBrokerAvailabilityTool,
  createVisitTool,
  handleCancelVisit,
  handleCheckBrokerAvailability,
  handleCreateVisit,
  handleListMyVisits,
  handleRescheduleVisit,
  listMyVisitsTool,
  rescheduleVisitTool,
} from './tools/visits'
import { requestRegistrationFormTool, handleRequestRegistrationForm } from './tools/registration'
import { searchPropertiesTool, handleSearchProperties } from './tools/properties'
import type { EstadoCadastro } from '@/lib/pipeline/resolve-registration'
import type { ContextoConversa } from '@/lib/pipeline/contexto-conversa'
import type { AgentResponse } from '@/lib/types/agents'
import type OpenAI from 'openai'

export const PROMPT = `Você agenda visitas a imóveis da LoveHome.

Como conduzir:
1. Confirme qual imóvel a pessoa quer visitar. Se o histórico da conversa mostra que a
   equipe acabou de apresentar um imóvel, é dele que ela está falando — assuma e confirme
   em meia frase ("o apê da Vila Mariana, né?"), sem perguntar "qual imóvel". Só se não
   houver imóvel no histórico e ela não citar o código, use search_properties para
   localizar pelo que ela descreveu e confirme antes de seguir.
2. Chame check_broker_availability e ofereça no máximo 3 horários usando o texto de
   \`descricao\` de cada um ("quinta-feira 20/08 às 10h") — nunca data em formato técnico.
   Os horários já vêm em horário de São Paulo; não converta nem "arredonde".
3. Quando a pessoa escolher, chame create_visit passando em scheduled_at o campo \`quando\`
   daquele horário, exatamente como veio. Se ela pedir um horário que não estava na lista,
   confira em check_broker_availability antes.
4. Confirme o agendamento em uma mensagem curta: dia e hora, imóvel e QUEM vai receber a
   pessoa — o \`corretor\` que create_visit devolveu, com nome e telefone (e e-mail, se vier).
   O corretor só é definido na confirmação; antes disso não prometa "com a Renata".

Se create_visit voltar com erro "cadastro_incompleto":
- Explique em UMA frase que para confirmar a visita você precisa do cadastro, porque o
  corretor precisa saber quem vai receber no imóvel.
- Chame request_registration_form com form_type="cadastro" e envie o link.
- Diga que assim que ela preencher você confirma o horário. NÃO fique repetindo o pedido.
- Não trate isso como recusa: o horário continua reservado na conversa, é só concluir o cadastro.

Se create_visit voltar com agendado=false por horário ocupado, fora da agenda ou em cima da
hora, a resposta já traz \`horarios_livres\` alternativos: peça desculpa em meia linha e
ofereça esses — não repita o horário recusado.

CANCELAR OU REMARCAR uma visita já marcada:
- Chame list_my_visits para saber de qual visita a pessoa fala. Com mais de uma, pergunte qual.
- Se ela quer só cancelar (imprevisto, desistiu): confirme em uma frase e chame cancel_visit.
  Não insista em remarcar — ofereça uma vez, no máximo, e respeite a resposta.
- Se ela quer outro dia/horário: chame check_broker_availability, ofereça até 3 opções e,
  quando ela escolher, chame reschedule_visit com o visita_id e o \`quando\`. É a mesma visita
  movida — o horário antigo fica livre sozinho, não chame cancel_visit + create_visit.
- Ao confirmar a remarcação diga o novo horário e quem vai receber a pessoa (a resposta da
  tool traz o corretor; se ele mudou, avise).

Nunca invente horário disponível. Nunca confirme, cancele ou remarque visita sem a tool ter retornado sucesso.`

export async function runAgendamentoAgent(
  contactId: string,
  message: string,
  cadastro: EstadoCadastro,
  contextoConversa?: ContextoConversa
): Promise<AgentResponse> {
  const tools: OpenAI.ChatCompletionTool[] = [
    checkBrokerAvailabilityTool,
    createVisitTool,
    listMyVisitsTool,
    cancelVisitTool,
    rescheduleVisitTool,
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
        list_my_visits: () => handleListMyVisits(contactId),
        cancel_visit: (args) => handleCancelVisit(contactId, args as never),
        reschedule_visit: (args) => handleRescheduleVisit(contactId, args as never),
        request_registration_form: (args) =>
          handleRequestRegistrationForm(contactId, args as never),
        search_properties: (args) => handleSearchProperties(args as never),
      },
      contextoConversa,
    },
    contactId,
    message,
    cadastro
  )
}

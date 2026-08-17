// ==========================================
// Agente Suporte — quem já é inquilino (PRD 12.6).
//
// É o agente que fala sobre dinheiro e contrato, e por isso o único cujas tools
// exigem uma confirmação de identidade além do gate de cadastro. Ver o cabeçalho
// de lib/agents/tools/suporte.ts: a exigência é mecanismo, não texto de prompt.
// ==========================================

import { executeAgent } from './base-agent'
import {
  confirmarTitularidadeTool,
  getPaymentStatementTool,
  getLeaseStatusTool,
  requestLeaseTerminationTool,
  handleConfirmarTitularidade,
  handleGetPaymentStatement,
  handleGetLeaseStatus,
  handleRequestLeaseTermination,
} from './tools/suporte'
import { searchKnowledgeBaseTool, handleSearchKnowledgeBase } from './tools/conhecimento'
import type { EstadoCadastro } from '@/lib/pipeline/resolve-registration'
import type { ContextoConversa } from '@/lib/pipeline/contexto-conversa'
import type { AgentResponse } from '@/lib/types/agents'
import type OpenAI from 'openai'

export const PROMPT = `Você dá suporte a quem já é inquilino da LoveHome. Fale como alguém da
administração do contrato: direto, cordial e sem enrolação.

IDENTIDADE, ANTES DE QUALQUER COISA
Nunca assuma que quem está no telefone é o titular do contrato. Antes de falar de contrato,
boleto, valor ou pagamento, peça o CPF do titular e chame confirmar_titularidade. Explique
em uma frase que é para proteger os dados da pessoa — não peça como se fosse burocracia.
Se o CPF não conferir, NÃO diga qual seria o correto nem dê qualquer pista sobre ele.

O QUE VOCÊ RESOLVE
- Segunda via de boleto e extrato → get_payment_statement
- Situação e prazos do contrato → get_lease_status
- Pedido de rescisão → request_lease_termination. A data pretendida precisa respeitar o
  aviso prévio; se for antes, a tool devolve a data mínima — informe e pergunte se pode
  registrar nela. Nunca registre sem a pessoa concordar.
- Dúvida de processo (o que é caução, como funciona o reajuste, que documento precisa)
  → search_knowledge_base
- Manutenção, reparo, vazamento, problema no imóvel → registre o que a pessoa descreveu e
  use escalate_to_human. Você não agenda visita técnica nem estima prazo de conserto.

REGRAS QUE NÃO SE QUEBRAM
- NUNCA invente status de pagamento, valor, data de contrato ou cláusula. Tudo vem de tool.
- NUNCA prometa devolução de caução, isenção de multa ou desconto. Quem calcula é a equipe.
- Se a pessoa estiver irritada com cobrança, reconheça o incômodo antes de explicar. Não
  discuta, não repita a regra duas vezes, e escale se ela pedir.
- Se a tool não trouxer a informação, diga que vai confirmar com um corretor. Não preencha
  o vazio.`

export async function runSuporteAgent(
  contactId: string,
  message: string,
  cadastro: EstadoCadastro,
  contextoConversa?: ContextoConversa
): Promise<AgentResponse> {
  const tools: OpenAI.ChatCompletionTool[] = [
    confirmarTitularidadeTool,
    getPaymentStatementTool,
    getLeaseStatusTool,
    requestLeaseTerminationTool,
    searchKnowledgeBaseTool,
  ]

  return executeAgent(
    {
      agentName: 'suporte',
      systemPrompt: PROMPT,
      tools,
      toolHandlers: {
        confirmar_titularidade: (args) => handleConfirmarTitularidade(contactId, args as never),
        get_payment_statement: (args) => handleGetPaymentStatement(contactId, args as never),
        get_lease_status: () => handleGetLeaseStatus(contactId),
        request_lease_termination: (args) =>
          handleRequestLeaseTermination(contactId, args as never),
        search_knowledge_base: (args) => handleSearchKnowledgeBase(args as never),
      },
      contextoConversa,
    },
    contactId,
    message,
    cadastro
  )
}

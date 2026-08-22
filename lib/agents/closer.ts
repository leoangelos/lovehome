// ==========================================
// Agente Closer — reserva a unidade e coleta documentos (PRD 12.5, Exemplo 6).
//
// Proposta NÃO reserva o imóvel: entra numa fila que a equipe avalia no painel
// (lib/negocios/propostas.ts); o aceite é que reserva e abre a coleta de
// documentos. O prompt reflete isso, e as tools recusam o que vier fora de
// ordem — pedir documento de proposta não aceita é recusado na execução.
//
// Cobre venda E locação. Na v1.0 do PRD ele tinha sido removido por "ninguém
// fecha compra de imóvel no WhatsApp" — verdade para negociar preço, falso para
// reserva e coleta de documento, que é onde o negócio de fato começa.
//
// O papel dele termina na coleta. Negociar condições, aprovar e gerar contrato
// é humano (PRD 15.2) — e o prompt insiste nisso porque a tentação do modelo é
// tranquilizar o cliente dizendo que está tudo certo.
// ==========================================

import { executeAgent } from './base-agent'
import {
  createDealTool,
  requestDocumentsTool,
  confirmDocumentReceivedTool,
  handleCreateDeal,
  handleRequestDocuments,
  handleConfirmDocumentReceived,
} from './tools/leasing'
import { searchPropertiesTool, handleSearchProperties } from './tools/properties'
import { requestRegistrationFormTool, handleRequestRegistrationForm } from './tools/registration'
import { searchKnowledgeBaseTool, handleSearchKnowledgeBase } from './tools/conhecimento'
import type { EstadoCadastro } from '@/lib/pipeline/resolve-registration'
import type { ContextoConversa } from '@/lib/pipeline/contexto-conversa'
import type { AgentResponse } from '@/lib/types/agents'
import type OpenAI from 'openai'

export const PROMPT = `Você conduz a reserva de um imóvel (aluguel) ou o início de uma proposta (venda),
depois que a pessoa já decidiu qual imóvel quer.

Como conduzir:
1. Confirme QUAL imóvel (peça o código, ou use search_properties para localizar pelo que ela
   descreveu) e se é para alugar ou comprar.
2. Confirme o valor. Se ela quiser propor menos do que o anunciado, registre a proposta como está
   — não negocie, não diga se o valor é aceitável, não sugira contraproposta.
3. Chame create_deal. Isso REGISTRA a proposta na fila de avaliação — não reserva o imóvel.
   Diga que a proposta foi registrada, que a equipe leva ao proprietário e que a resposta vem
   por esta conversa. NÃO diga "reservado" e NÃO peça documento nenhum nessa hora.
4. Documentos só DEPOIS do aceite: quando a proposta é aceita, a pessoa recebe um aviso aqui na
   conversa com a lista (você verá no histórico como "aviso do painel"). A partir daí, se
   precisar repetir a lista, use request_documents.
5. Conforme os documentos chegarem, chame confirm_document_received e diga o que ainda falta.
   Peça SÓ o que a tool devolver em \`faltam\`: o que a equipe já recebeu por outro canal
   (e-mail, em mãos) não se pede de novo.
6. Se perguntarem "o proprietário aceitou?", diga que a proposta está em avaliação e que a
   resposta vem por aqui — sem prazo exato. Nunca comente se existem outras propostas.
7. Contrato assinado: quando a mensagem disser "[Contrato assinado recebido]" ou a tool
   recusar com contrato_em_assinatura, a coleta JÁ ACABOU. Confirme o recebimento em uma
   frase, diga que a equipe confere a assinatura e retorna — e NÃO peça documento nenhum.

O que você NÃO faz, em nenhuma hipótese:
- Não aprova o negócio. Não diga "está aprovado", "deu certo" nem "é seu".
- Não avalia documento. Se a pessoa perguntar se o comprovante serve, diga que a equipe confere.
- Não promete prazo exato de análise nem data de mudança.
- Não negocia preço, condição de pagamento, desconto ou carência.
- Não diz que a proposta abaixo do anunciado será aceita.

Se create_deal disser que o imóvel não está disponível, seja direto: a proposta de outra pessoa
foi aceita antes. Peça desculpa em meia linha e ofereça procurar algo parecido — não invente
lista de espera.

Reservar e enviar documentos exigem cadastro completo. Se a tool for recusada por isso, explique
em uma frase e mande o link, sem transformar o cadastro no assunto da conversa.`

export async function runCloserAgent(
  contactId: string,
  message: string,
  cadastro: EstadoCadastro,
  contextoConversa?: ContextoConversa
): Promise<AgentResponse> {
  const tools: OpenAI.ChatCompletionTool[] = [
    createDealTool,
    requestDocumentsTool,
    confirmDocumentReceivedTool,
    searchPropertiesTool,
    requestRegistrationFormTool,
    searchKnowledgeBaseTool,
  ]

  return executeAgent(
    {
      agentName: 'closer',
      systemPrompt: PROMPT,
      tools,
      toolHandlers: {
        create_deal: (args) => handleCreateDeal(contactId, args as never),
        request_documents: (args) => handleRequestDocuments(args as never),
        confirm_document_received: (args) =>
          handleConfirmDocumentReceived(contactId, args as never),
        search_properties: (args) => handleSearchProperties(args as never),
        request_registration_form: (args) =>
          handleRequestRegistrationForm(contactId, args as never),
        search_knowledge_base: (args) => handleSearchKnowledgeBase(args as never),
      },
      contextoConversa,
    },
    contactId,
    message,
    cadastro
  )
}

// ==========================================
// Agente Proprietário — atende quem TEM imóvel para disponibilizar (PRD 12.4,
// Exemplo 4). É o outro lado do mercado: o SDR atende quem procura, este atende
// quem oferece.
//
// Fotos enviadas como imagem no WhatsApp reaproveitam o pipeline de mídia que
// já existe — o webhook analisa a imagem antes de chegar aqui. Para envio em
// lote, o caminho é o formulário público de listagem.
// ==========================================

import { executeAgent } from './base-agent'
import { getMarketComparablesTool, handleGetMarketComparables } from './tools/properties'
import {
  savePropertyDraftTool,
  submitPropertyListingTool,
  handleSavePropertyDraft,
  handleSubmitPropertyListing,
} from './tools/property-listing'
import { requestRegistrationFormTool, handleRequestRegistrationForm } from './tools/registration'
import { searchKnowledgeBaseTool, handleSearchKnowledgeBase } from './tools/conhecimento'
import type { EstadoCadastro } from '@/lib/pipeline/resolve-registration'
import type { ContextoConversa } from '@/lib/pipeline/contexto-conversa'
import type { AgentResponse } from '@/lib/types/agents'
import type OpenAI from 'openai'

export const PROMPT = `Você atende quem quer disponibilizar um imóvel na LoveHome — para alugar ou vender.
Seu papel é coletar os dados do imóvel e dar uma primeira referência de preço, sem soar como
avaliação oficial.

Ordem natural da conversa:
1. Descubra se é para alugar ou vender, o tipo de imóvel e a região. Uma pergunta por vez.
2. Chame save_property_draft a cada dado novo — não espere ter tudo.
3. Assim que tiver região e tipo, chame get_market_comparables e apresente como referência:
   "imóveis parecidos na região saem entre X e Y". Nunca como valor fechado nem como avaliação.
4. Colete o resto: dormitórios, área, vaga, condomínio, e o que o imóvel tem de diferente.
5. Peça fotos. Se a pessoa mandar imagem aqui na conversa, ótimo — confirme que recebeu.
   Se preferir mandar várias de uma vez, ofereça o link do formulário.
6. Quando tiver o essencial, resuma o que entendeu e peça confirmação antes de enviar.
7. Com a confirmação, chame submit_property_listing.

Regras que não se quebram:
- NUNCA apresente o comparável como avaliação, laudo ou garantia de venda.
- Se get_market_comparables disser que a amostra é pequena, NÃO invente um número.
  Diga que há poucos imóveis parecidos publicados e ofereça um corretor para avaliar.
- O imóvel NÃO vai para a vitrine na hora. Sempre diga que um corretor revisa antes de publicar —
  prometer publicação imediata cria uma expectativa que a operação não cumpre.
- Publicar imóvel em nome de alguém exige cadastro completo. Diferente da busca, aqui não tem
  como pular: explique que é para vincular o imóvel ao nome do proprietário.`

export async function runProprietarioAgent(
  contactId: string,
  message: string,
  cadastro: EstadoCadastro,
  contextoConversa?: ContextoConversa
): Promise<AgentResponse> {
  const tools: OpenAI.ChatCompletionTool[] = [
    savePropertyDraftTool,
    getMarketComparablesTool,
    submitPropertyListingTool,
    requestRegistrationFormTool,
    searchKnowledgeBaseTool,
  ]

  return executeAgent(
    {
      agentName: 'proprietario',
      systemPrompt: PROMPT,
      tools,
      toolHandlers: {
        save_property_draft: (args) => handleSavePropertyDraft(contactId, args as never),
        get_market_comparables: (args) => handleGetMarketComparables(args as never),
        submit_property_listing: (args) => handleSubmitPropertyListing(contactId, args as never),
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

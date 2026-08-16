// ==========================================
// Tool de qualificacao — save_qualification.
// Grava o que foi descoberto sobre o lead e move o funil.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import type OpenAI from 'openai'

type Tool = OpenAI.ChatCompletionTool

export const saveQualificationTool: Tool = {
  type: 'function',
  function: {
    name: 'save_qualification',
    description: `Salva o que você descobriu sobre o que a pessoa procura. Chame assim que
souber a intenção, e de novo a cada dado novo (região, faixa de preço, dormitórios, urgência).
Chamar cedo e várias vezes é melhor do que esperar ter tudo.`,
    parameters: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          enum: ['compra', 'aluguel', 'investimento'],
          description: 'O que a pessoa quer fazer',
        },
        region: { type: 'string', description: 'Região ou bairro de interesse' },
        property_type: { type: 'string', description: 'Tipo de imóvel procurado' },
        price_min_cents: { type: 'number', description: 'Piso do orçamento em centavos' },
        price_max_cents: { type: 'number', description: 'Teto do orçamento em centavos' },
        bedrooms: { type: 'number', description: 'Dormitórios desejados' },
        urgency: {
          type: 'string',
          enum: ['imediata', 'ate_30_dias', 'ate_90_dias', 'sem_pressa'],
          description: 'Prazo da pessoa',
        },
        investor_ticket_cents: { type: 'number', description: 'Ticket disponível do investidor' },
        investor_return_expectation: { type: 'string', description: 'Retorno esperado' },
        investor_has_portfolio: { type: 'boolean', description: 'Já investe em imóveis?' },
        notes: { type: 'string', description: 'Observação livre relevante para o corretor' },
      },
      required: ['intent'],
    },
  },
}

export async function handleSaveQualification(contactId: string, params: Record<string, unknown>) {
  const supabase = createAdminClient()

  /* Upsert por contact_id (UNIQUE no schema): o agente chama esta tool varias
     vezes na mesma conversa, e cada chamada deve completar o registro em vez de
     criar linha nova. */
  const { error } = await supabase.from('lead_qualifications').upsert(
    {
      contact_id: contactId,
      ...params,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'contact_id' }
  )

  if (error) return { salvo: false, erro: error.message }

  // Espelha a intencao no contato e avanca o funil — o dashboard le dali.
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (params.intent) patch.intent = params.intent

  const { data: contato } = await supabase
    .from('contacts')
    .select('funnel_stage')
    .eq('id', contactId)
    .single()

  /* So avanca 'novo' -> 'qualificando'. Nao volta estagio: um lead que ja tem
     visita agendada continua nesse estagio mesmo que atualize a preferencia de
     bairro no meio da conversa. */
  if (contato?.funnel_stage === 'novo') patch.funnel_stage = 'qualificando'

  // Com preço e região definidos, a qualificação está completa o bastante
  // para um corretor trabalhar o lead.
  const temPreco = params.price_max_cents || params.investor_ticket_cents
  if (temPreco && params.region && contato?.funnel_stage === 'qualificando') {
    patch.funnel_stage = 'qualificado'
  }

  await supabase.from('contacts').update(patch).eq('id', contactId)

  return { salvo: true, funnel_stage: patch.funnel_stage ?? contato?.funnel_stage }
}

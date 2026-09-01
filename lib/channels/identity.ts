// ==========================================
// Identidade conversacional — resolve (canal, external_id) para um contato,
// criando a linha em contacts e a identidade na primeira mensagem.
//
// Identidade multicanal: contacts e conversations.contact_id no lugar de tabela por canal;
// contact_id, e os defaults do funil viram os do dominio imobiliario.
//
// Esta e a camada FROUXA da identidade (PRD 6.1). Ela nao sabe nada de CPF: o
// cadastro formal e resolvido a parte, em resolve-registration.ts.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { notificarCrm } from '@/lib/crm/webhook'
import type { Channel } from './types'
import type { Contact } from '@/lib/types/domain'

interface ResolveParams {
  channel: Channel
  externalId: string
  phone?: string
  phoneKey?: string
  name?: string
}

/** Acha o contato de (channel, externalId) ou cria um. */
export async function resolveContact(params: ResolveParams): Promise<Contact> {
  const supabase = createAdminClient()

  // 1. Identidade ja registrada
  const { data: identity } = await supabase
    .from('contact_identities')
    .select('contact_id')
    .eq('channel', params.channel)
    .eq('external_id', params.externalId)
    .maybeSingle()

  if (identity?.contact_id) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', identity.contact_id)
      .single()
    if (contact) return contact as Contact
  }

  // 2. Casamento por phone_key — unifica a mesma pessoa entre canais pelos 8
  // ultimos digitos (DDI, DDD e o 9o digito ja foram descartados por
  // extractPhoneKey). Aceita colisao entre DDDs de proposito: a decisao de
  // produto privilegia recall sobre precisao — e melhor arriscar juntar dois
  // numeros que terminam igual do que perder o vinculo de um cliente real que
  // digitou o telefone de um jeito diferente em cada canal.
  //
  // Importante: essa frouxidao e aceitavel exatamente porque contacts nao
  // carrega consequencia legal. O que sustenta contrato e cobranca e
  // registrations, chaveado por CPF (PRD 6.1).
  if (params.phoneKey) {
    const { data: matched } = await supabase
      .from('contacts')
      .select('*')
      .eq('phone_key', params.phoneKey)
      .limit(1)
      .maybeSingle()

    if (matched) {
      await supabase.from('contact_identities').upsert(
        {
          contact_id: matched.id,
          channel: params.channel,
          external_id: params.externalId,
        },
        { onConflict: 'channel,external_id' }
      )

      // Completa o que acabamos de descobrir sobre a pessoa
      const patch: Record<string, unknown> = {}
      if (!matched.name && params.name) patch.name = params.name
      if (!matched.phone && params.phone) patch.phone = params.phone
      if (Object.keys(patch).length > 0) {
        patch.updated_at = new Date().toISOString()
        await supabase.from('contacts').update(patch).eq('id', matched.id)
      }
      return matched as Contact
    }
  }

  // 3. Contato novo
  const { data: novo, error } = await supabase
    .from('contacts')
    .insert({
      channel_default: params.channel,
      phone: params.phone || null,
      phone_key: params.phoneKey || null,
      name: params.name || null,
      funnel_stage: 'novo',
      registration_status: 'none',
    })
    .select()
    .single()

  if (error || !novo) {
    throw new Error(`Falha ao criar contato: ${error?.message}`)
  }

  await supabase.from('contact_identities').insert({
    contact_id: novo.id,
    channel: params.channel,
    external_id: params.externalId,
  })

  /* Lead novo para o CRM da casa (se configurado): início de conversa, com o
     que se sabe até aqui — nome e telefone quando o canal informa. Best-effort
     com timeout curto; o atendimento nunca espera o CRM. */
  await notificarCrm('lead_novo', novo.id)

  return novo as Contact
}

/**
 * Acha ou cria a conversa aberta de um contato num canal.
 * Conversas sao escopadas por (contact_id, channel): a mesma pessoa falando
 * pelo widget e pelo WhatsApp tem threads separadas, mas o mesmo perfil.
 */
export async function resolveConversation(contactId: string, channel: Channel) {
  const supabase = createAdminClient()

  const { data: existente } = await supabase
    .from('conversations')
    .select('*')
    .eq('contact_id', contactId)
    .eq('channel', channel)
    .in('status', ['active', 'escalated', 'human'])
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existente) return existente

  const { data: nova, error } = await supabase
    .from('conversations')
    .insert({
      contact_id: contactId,
      channel,
      status: 'active',
    })
    .select()
    .single()

  if (error || !nova) {
    throw new Error(`Falha ao criar conversa: ${error?.message}`)
  }

  return nova
}

// ==========================================
// Tools do agente Proprietário — rascunho e envio do imóvel (PRD 12.4).
//
// O rascunho vive em form_submissions com form_type='listagem_imovel': a
// conversa vai preenchendo aos poucos, e o formulário público completa o que
// faltar (principalmente as fotos). Guardar em `properties` desde a primeira
// mensagem encheria a base de imóveis pela metade que ninguém aprovaria.
// ==========================================

import crypto from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import type OpenAI from 'openai'
import { urlPublica } from '@/lib/utils/url-publica'

type Tool = OpenAI.ChatCompletionTool

const VALIDADE_HORAS = 72

export const savePropertyDraftTool: Tool = {
  type: 'function',
  function: {
    name: 'save_property_draft',
    description: `Salva o que você já descobriu sobre o imóvel que a pessoa quer disponibilizar.
Chame a cada dado novo — é melhor salvar cedo e várias vezes do que esperar ter tudo.
Não some dados: mande sempre o conjunto completo do que você sabe até agora.`,
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['venda', 'aluguel', 'ambos'],
          description: 'Se quer vender, alugar ou aceita as duas coisas',
        },
        property_type: {
          type: 'string',
          description: 'apartamento, casa, studio, cobertura, sobrado, kitnet, terreno, comercial',
        },
        region: { type: 'string', description: 'Bairro ou região' },
        address: { type: 'string', description: 'Endereço, quando a pessoa informar' },
        bedrooms: { type: 'number' },
        bathrooms: { type: 'number' },
        parking_spots: { type: 'number' },
        area_m2: { type: 'number', description: 'Área útil em m²' },
        condo_fee_cents: { type: 'number', description: 'Condomínio em centavos' },
        price_cents: { type: 'number', description: 'Preço de venda pretendido, em centavos' },
        rent_price_cents: { type: 'number', description: 'Aluguel pretendido, em centavos' },
        description: { type: 'string', description: 'Como a pessoa descreve o imóvel' },
        amenities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Características citadas (varanda, piscina, mobiliado...)',
        },
      },
      required: [],
    },
  },
}

export const submitPropertyListingTool: Tool = {
  type: 'function',
  function: {
    name: 'submit_property_listing',
    description: `Envia o imóvel para análise da equipe. Chame quando já tiver ao menos tipo,
região e a operação pretendida. O imóvel NÃO vai para a vitrine direto — entra em análise e
um corretor revisa antes de publicar. Exige cadastro completo do proprietário.`,
    parameters: {
      type: 'object',
      properties: {
        confirmado: {
          type: 'boolean',
          description: 'true quando a pessoa confirmou que os dados estão certos',
        },
      },
      required: ['confirmado'],
    },
  },
}

interface Rascunho {
  operation?: string
  property_type?: string
  region?: string
  address?: string
  bedrooms?: number
  bathrooms?: number
  parking_spots?: number
  area_m2?: number
  condo_fee_cents?: number
  price_cents?: number
  rent_price_cents?: number
  description?: string
  amenities?: string[]
  photos?: string[]
}

/** Rascunho aberto do contato, se houver. */
async function acharRascunho(contactId: string) {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('form_submissions')
    .select('id, token, payload, status')
    .eq('contact_id', contactId)
    .eq('form_type', 'listagem_imovel')
    .eq('status', 'pendente')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
}

export async function handleSavePropertyDraft(contactId: string, params: Rascunho) {
  const supabase = createAdminClient()
  const existente = await acharRascunho(contactId)

  /* Mescla em vez de substituir: o modelo às vezes reenvia só o campo novo, e
     sobrescrever apagaria o que já tinha sido coletado na conversa. */
  const payload = { ...(existente?.payload as Rascunho | null), ...params }

  if (existente) {
    await supabase.from('form_submissions').update({ payload }).eq('id', existente.id)
    return { salvo: true, campos: Object.keys(payload).length }
  }

  const token = crypto.randomBytes(32).toString('base64url')
  const { error } = await supabase.from('form_submissions').insert({
    form_type: 'listagem_imovel',
    contact_id: contactId,
    token,
    status: 'pendente',
    payload,
    expires_at: new Date(Date.now() + VALIDADE_HORAS * 60 * 60 * 1000).toISOString(),
  })

  if (error) return { salvo: false, erro: error.message }
  return { salvo: true, campos: Object.keys(payload).length }
}

export async function handleSubmitPropertyListing(
  contactId: string,
  params: { confirmado: boolean }
) {
  const supabase = createAdminClient()

  if (!params.confirmado) {
    return { enviado: false, instrucao: 'Confirme os dados com a pessoa antes de enviar.' }
  }

  const rascunho = await acharRascunho(contactId)
  const dados = (rascunho?.payload ?? {}) as Rascunho

  if (!dados.property_type || !dados.region || !dados.operation) {
    return {
      enviado: false,
      falta: ['property_type', 'region', 'operation'].filter((c) => !dados[c as keyof Rascunho]),
      instrucao: 'Ainda faltam dados básicos. Pergunte o que falta antes de enviar.',
    }
  }

  const { data: contato } = await supabase
    .from('contacts')
    .select('registration_id, name')
    .eq('id', contactId)
    .single()

  // O gate já barra esta tool sem cadastro completo; esta checagem cobre o caso
  // de o vínculo ter sumido entre a autorização e a execução.
  if (!contato?.registration_id) {
    return { enviado: false, erro: 'Cadastro do proprietário não encontrado.' }
  }

  const { data: ultimo } = await supabase
    .from('properties')
    .select('reference_code')
    .like('reference_code', 'LH-%')
    .order('reference_code', { ascending: false })
    .limit(1)
    .maybeSingle()

  const proximo = Number(ultimo?.reference_code?.replace('LH-', '') ?? 1000) + 1
  const titulo =
    `${dados.property_type} ${dados.bedrooms ? `de ${dados.bedrooms} dormitório${dados.bedrooms > 1 ? 's' : ''} ` : ''}` +
    `em ${dados.region}`

  const { data: imovel, error } = await supabase
    .from('properties')
    .insert({
      reference_code: `LH-${proximo}`,
      title: titulo.charAt(0).toUpperCase() + titulo.slice(1),
      operation: dados.operation,
      property_type: dados.property_type,
      region: dados.region,
      address: dados.address ?? null,
      bedrooms: dados.bedrooms ?? null,
      bathrooms: dados.bathrooms ?? null,
      parking_spots: dados.parking_spots ?? null,
      area_m2: dados.area_m2 ?? null,
      condo_fee_cents: dados.condo_fee_cents ?? null,
      price_cents: dados.price_cents ?? null,
      rent_price_cents: dados.rent_price_cents ?? null,
      description: dados.description ?? null,
      amenities: dados.amenities ?? [],
      photos: dados.photos ?? [],
      // NUNCA 'disponivel' direto: imóvel de proprietário passa por revisão
      // humana antes de ir à vitrine (PRD 4.4, passo 6).
      status: 'em_analise',
      owner_registration_id: contato.registration_id,
    })
    .select('id, reference_code')
    .single()

  if (error) return { enviado: false, erro: error.message }

  await supabase.from('approval_requests').insert({
    property_id: imovel.id,
    type: 'aprovacao_listagem_imovel',
    notes: `${imovel.reference_code} · ${dados.region} — enviado por ${contato.name ?? 'proprietário'} pelo WhatsApp`,
  })

  if (rascunho) {
    await supabase
      .from('form_submissions')
      .update({ status: 'preenchido', submitted_at: new Date().toISOString() })
      .eq('id', rascunho.id)
  }

  const temFotos = (dados.photos ?? []).length > 0

  return {
    enviado: true,
    codigo: imovel.reference_code,
    tem_fotos: temFotos,
    instrucao: temFotos
      ? 'Confirme que a equipe revisa e publica em breve. Não prometa prazo exato.'
      : 'Avise que sem fotos o imóvel demora mais a ser publicado, e ofereça o link do formulário para enviá-las.',
  }
}

/** Link do formulário de listagem — usado pelo agente para receber fotos em lote. */
export async function linkListagem(contactId: string): Promise<string | null> {
  const rascunho = await acharRascunho(contactId)
  if (!rascunho) return null
  return urlPublica(`/listar-imovel/${rascunho.token}`)
}

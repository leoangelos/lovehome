import { createAdminClient } from '@/lib/supabase/admin'
import { atualizarEmbeddingDoImovel } from '@/lib/imoveis/embeddings'

// ==========================================
// Submissão do formulário público de listagem de imóvel (PRD 6.5).
//
// Complementa o que o agente Proprietário coletou na conversa — sobretudo as
// fotos, que em lote não fazem sentido pelo WhatsApp.
// ==========================================

const MAX_FOTOS = 12
const MAX_BYTES = 5 * 1024 * 1024
const TIPOS_ACEITOS = ['image/jpeg', 'image/png', 'image/webp']

export interface RascunhoListagem {
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

export interface TokenListagemValido {
  valido: true
  formSubmissionId: string
  contactId: string | null
  rascunho: RascunhoListagem
  nomeContato: string | null
  temCadastro: boolean
}

export interface TokenListagemInvalido {
  valido: false
  motivo: 'inexistente' | 'expirado' | 'ja_preenchido'
}

export async function validarTokenListagem(
  token: string
): Promise<TokenListagemValido | TokenListagemInvalido> {
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('form_submissions')
    .select('id, contact_id, status, expires_at, payload, contacts ( name, registration_id )')
    .eq('token', token)
    .eq('form_type', 'listagem_imovel')
    .maybeSingle()

  if (!data) return { valido: false, motivo: 'inexistente' }
  if (data.status === 'preenchido') return { valido: false, motivo: 'ja_preenchido' }
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    await supabase.from('form_submissions').update({ status: 'expirado' }).eq('id', data.id)
    return { valido: false, motivo: 'expirado' }
  }

  const contato = data.contacts as unknown as {
    name: string | null
    registration_id: string | null
  } | null

  return {
    valido: true,
    formSubmissionId: data.id,
    contactId: data.contact_id,
    rascunho: (data.payload ?? {}) as RascunhoListagem,
    nomeContato: contato?.name ?? null,
    temCadastro: Boolean(contato?.registration_id),
  }
}

export type ResultadoListagem =
  | { ok: true; codigo: string; fotos: number }
  | { ok: false; erro: string }

export async function submeterListagem(params: {
  token: string
  dados: RascunhoListagem
  fotos: File[]
}): Promise<ResultadoListagem> {
  const supabase = createAdminClient()

  const tk = await validarTokenListagem(params.token)
  if (!tk.valido) {
    const motivos = {
      inexistente: 'Link inválido.',
      expirado: 'Este link expirou. Peça um novo na conversa.',
      ja_preenchido: 'Este imóvel já foi enviado.',
    }
    return { ok: false, erro: motivos[tk.motivo] }
  }

  const dados = { ...tk.rascunho, ...params.dados }

  if (!dados.property_type || !dados.region || !dados.operation) {
    return { ok: false, erro: 'Informe ao menos o tipo, a região e se é para alugar ou vender.' }
  }

  if (params.fotos.length > MAX_FOTOS) {
    return { ok: false, erro: `Envie no máximo ${MAX_FOTOS} fotos.` }
  }

  /* Validação server-side de tipo e tamanho, mesmo com o bucket já restringindo.
     O que o navegador manda não é confiável, e a mensagem de erro do storage
     não serve para mostrar a ninguém. */
  const caminhos: string[] = []
  for (const [i, foto] of params.fotos.entries()) {
    if (!TIPOS_ACEITOS.includes(foto.type)) {
      return { ok: false, erro: 'Envie apenas imagens JPG, PNG ou WebP.' }
    }
    if (foto.size > MAX_BYTES) {
      return { ok: false, erro: 'Cada foto precisa ter no máximo 5 MB.' }
    }

    const extensao = foto.type.split('/')[1].replace('jpeg', 'jpg')
    /* Nome gerado, nunca o do arquivo enviado: nome de upload pode conter
       barra, `..` ou caracteres que quebram o caminho no storage. */
    const caminho = `${tk.formSubmissionId}/${Date.now()}-${i}.${extensao}`

    const { error } = await supabase.storage
      .from('imoveis')
      .upload(caminho, foto, { contentType: foto.type, upsert: false })

    if (error) return { ok: false, erro: 'Falha ao enviar as fotos. Tente de novo.' }

    const { data: publica } = supabase.storage.from('imoveis').getPublicUrl(caminho)
    caminhos.push(publica.publicUrl)
  }

  const fotosFinais = [...(dados.photos ?? []), ...caminhos]

  const { data: contato } = tk.contactId
    ? await supabase
        .from('contacts')
        .select('registration_id, name')
        .eq('id', tk.contactId)
        .maybeSingle()
    : { data: null }

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
      photos: fotosFinais,
      // Sempre em análise: revisão humana antes da vitrine (PRD 4.4).
      status: 'em_analise',
      owner_registration_id: contato?.registration_id ?? null,
    })
    .select('id, reference_code')
    .single()

  if (error) return { ok: false, erro: 'Não foi possível salvar o imóvel. Tente novamente.' }

  /* Embedding no momento em que o imóvel nasce. É `await`, não fogo-e-esquece:
     no Vercel o runtime congela quando a resposta sai e a promessa solta nunca
     terminaria — o imóvel ficaria para sempre fora da busca qualitativa, sem
     nenhum sinal. O custo é ~300ms num envio de formulário que já subiu fotos.

     Falhar aqui não impede a listagem: o imóvel entra na fila de aprovação de
     qualquer jeito e `npm run embeddings` recupera quem ficou de fora. */
  await atualizarEmbeddingDoImovel(imovel.id)

  await supabase.from('approval_requests').insert({
    property_id: imovel.id,
    type: 'aprovacao_listagem_imovel',
    notes: `${imovel.reference_code} · ${dados.region} — enviado por ${contato?.name ?? 'proprietário'} pelo formulário${fotosFinais.length ? `, ${fotosFinais.length} foto(s)` : ', sem fotos'}`,
  })

  await supabase
    .from('form_submissions')
    .update({
      status: 'preenchido',
      submitted_at: new Date().toISOString(),
      payload: { ...dados, photos: fotosFinais },
    })
    .eq('id', tk.formSubmissionId)

  return { ok: true, codigo: imovel.reference_code, fotos: fotosFinais.length }
}

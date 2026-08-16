import { createAdminClient } from '@/lib/supabase/admin'

// ==========================================
// Recebimento de documento por WhatsApp (PRD 12.5 e 15.3).
//
// Baixa o arquivo NO MOMENTO em que a mensagem chega e guarda no bucket
// privado. A URL de mídia do Z-API expira — esperar o agente decidir o que
// fazer com ela (o que só acontece depois da janela de debounce) já é tarde.
//
// O mesmo princípio do resto do projeto: o que tem consequência não depende de
// o modelo lembrar. Aqui a captura do arquivo é do webhook; classificar o tipo
// é do agente, depois, sobre um arquivo que já está salvo.
// ==========================================

const MAX_BYTES = 10 * 1024 * 1024

const EXTENSAO: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export interface DocumentoRecebido {
  documentId: string
  dealId: string | null
  nomeArquivo: string
}

/**
 * Guarda o arquivo e abre a linha em `documents` como 'outro'.
 *
 * O tipo nasce 'outro' de propósito: quem sabe se é RG ou comprovante de renda
 * é o agente, na conversa. `confirm_document_received` reclassifica esta mesma
 * linha em vez de criar outra — assim o arquivo nunca fica órfão, mesmo que o
 * modelo não chame a tool.
 */
export async function receberDocumento(params: {
  contactId: string
  mediaUrl: string
  nomeSugerido?: string
}): Promise<DocumentoRecebido | null> {
  let resposta: Response
  try {
    resposta = await fetch(params.mediaUrl)
  } catch (e) {
    console.error('[documentos] download falhou:', (e as Error).message)
    return null
  }

  if (!resposta.ok) {
    console.error('[documentos] download recusado:', resposta.status)
    return null
  }

  return guardarDocumento({
    contactId: params.contactId,
    bytes: await resposta.arrayBuffer(),
    contentType: (resposta.headers.get('content-type') ?? '').split(';')[0].trim(),
    nomeSugerido: params.nomeSugerido,
  })
}

/**
 * Guarda bytes JÁ BAIXADOS.
 *
 * Existe separado de `receberDocumento` por causa da Meta: lá a mídia não é uma
 * URL pública, é um id que exige duas chamadas autenticadas com o bearer token
 * (ver downloadMetaMedia). Um `fetch(url)` simples devolveria 401. O Z-API
 * entrega URL e continua usando o atalho acima; daqui para baixo o caminho é o
 * mesmo para os dois canais.
 */
export async function guardarDocumento(params: {
  contactId: string
  bytes: ArrayBuffer | Buffer
  contentType: string
  nomeSugerido?: string
}): Promise<DocumentoRecebido | null> {
  const supabase = createAdminClient()

  const { data: contato } = await supabase
    .from('contacts')
    .select('registration_id')
    .eq('id', params.contactId)
    .maybeSingle()

  /* Sem cadastro formal não há a quem anexar o documento. Acontece com quem
     manda um arquivo antes de se cadastrar — a mensagem fica registrada na
     conversa, mas não vira documento de negócio. */
  if (!contato?.registration_id) {
    console.log('[documentos] arquivo recebido de contato sem cadastro:', params.contactId)
    return null
  }

  const tipo = params.contentType.split(';')[0].trim()
  const extensao = EXTENSAO[tipo]
  if (!extensao) {
    console.log('[documentos] tipo não aceito:', tipo)
    return null
  }

  const bytes = params.bytes
  const tamanho = bytes instanceof Buffer ? bytes.byteLength : bytes.byteLength
  if (tamanho > MAX_BYTES) {
    console.log('[documentos] arquivo grande demais:', tamanho)
    return null
  }

  /* Anexa ao negócio aberto do cliente, se houver. Sem negócio o documento
     ainda é guardado — pode ser que o Closer abra a reserva logo depois. */
  const { data: negocio } = await supabase
    .from('deals')
    .select('id')
    .eq('client_registration_id', contato.registration_id)
    .in('status', ['em_aprovacao', 'aprovado'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const caminho = `${contato.registration_id}/${Date.now()}.${extensao}`

  const { error: erroUpload } = await supabase.storage
    .from('documentos')
    .upload(caminho, bytes, { contentType: tipo, upsert: false })

  if (erroUpload) {
    console.error('[documentos] upload falhou:', erroUpload.message)
    return null
  }

  const { data: documento, error } = await supabase
    .from('documents')
    .insert({
      registration_id: contato.registration_id,
      deal_id: negocio?.id ?? null,
      type: 'outro',
      storage_path: caminho,
      status: 'pendente_revisao',
    })
    .select('id')
    .single()

  if (error || !documento) {
    console.error('[documentos] registro falhou:', error?.message)
    // Arquivo sem linha em documents seria lixo invisível no bucket.
    await supabase.storage.from('documentos').remove([caminho])
    return null
  }

  console.log(
    `[documentos] guardado ${caminho} para o cadastro ${contato.registration_id}` +
      (negocio ? ` (negócio ${negocio.id.slice(0, 8)})` : ' (sem negócio aberto)')
  )

  return {
    documentId: documento.id,
    dealId: negocio?.id ?? null,
    nomeArquivo: params.nomeSugerido ?? `arquivo.${extensao}`,
  }
}

/**
 * O contato está no meio de uma coleta de documentos?
 * Usado para decidir se uma IMAGEM deve ser guardada como documento além de
 * ir para o Vision — no Brasil, RG e comprovante chegam fotografados muito
 * mais do que como PDF.
 */
export async function aguardandoDocumentos(contactId: string): Promise<boolean> {
  const supabase = createAdminClient()

  const { data: contato } = await supabase
    .from('contacts')
    .select('registration_id')
    .eq('id', contactId)
    .maybeSingle()

  if (!contato?.registration_id) return false

  const { data: negocio } = await supabase
    .from('deals')
    .select('documentos_solicitados')
    .eq('client_registration_id', contato.registration_id)
    .in('status', ['em_aprovacao', 'aprovado'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return ((negocio?.documentos_solicitados ?? []) as string[]).length > 0
}

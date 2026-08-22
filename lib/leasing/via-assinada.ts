// ==========================================
// Via assinada do contrato chegando pelo WhatsApp.
//
// O cliente devolve o PDF assinado na mesma conversa (PRD 15.3). Antes isso
// caía na fila de documentos como "outro", o agente pedia comprovante de renda
// de novo, e o corretor baixava o arquivo para subir em Contratos. Agora:
//
//   * DETECÇÃO é determinística: o contato tem negócio 'aprovado' com contrato
//     gerado e ainda sem via assinada. Nome do arquivo e legenda não decidem —
//     o cliente pode renomear.
//   * O arquivo vai para o bucket `contratos` como CANDIDATO
//     (deals.signed_candidate_*). contract_signed_at só é gravado quando uma
//     pessoa confirma no cartão — a decisão continua humana.
//   * "Não é o contrato" manda o arquivo para a fila de documentos, que é o
//     caminho antigo.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'

const MAX_BYTES = 10 * 1024 * 1024
const VALIDADE_SEGUNDOS = 300

export type Resultado<T = unknown> = ({ ok: true } & T) | { ok: false; erro: string; status: number }

export interface NegocioAguardando {
  id: string
  reference_code: string | null
}

/** O contato tem contrato gerado esperando a via assinada? */
export async function negocioAguardandoAssinatura(contactId: string): Promise<NegocioAguardando | null> {
  const supabase = createAdminClient()

  const { data: contato } = await supabase
    .from('contacts')
    .select('registration_id')
    .eq('id', contactId)
    .maybeSingle()
  if (!contato?.registration_id) return null

  const { data: negocio } = await supabase
    .from('deals')
    .select('id, properties ( reference_code )')
    .eq('client_registration_id', contato.registration_id)
    .eq('status', 'aprovado')
    .not('contract_document_url', 'is', null)
    .is('signed_document_url', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!negocio) return null
  const imovel = negocio.properties as unknown as { reference_code: string } | null
  return { id: negocio.id, reference_code: imovel?.reference_code ?? null }
}

/** Z-API entrega URL (que expira): baixa agora e guarda. */
export async function receberViaAssinada(params: {
  dealId: string
  mediaUrl: string
}): Promise<Resultado<{ caminho: string }>> {
  let resposta: Response
  try {
    resposta = await fetch(params.mediaUrl)
  } catch (e) {
    return { ok: false, erro: `download falhou: ${(e as Error).message}`, status: 502 }
  }
  if (!resposta.ok) return { ok: false, erro: `download recusado: ${resposta.status}`, status: 502 }

  return guardarViaAssinada({
    dealId: params.dealId,
    bytes: await resposta.arrayBuffer(),
    contentType: (resposta.headers.get('content-type') ?? '').split(';')[0].trim(),
    via: 'whatsapp',
  })
}

/** Guarda bytes já baixados (Meta entrega bytes; Z-API passa por cima). Só PDF. */
export async function guardarViaAssinada(params: {
  dealId: string
  bytes: ArrayBuffer | Buffer
  contentType: string
  via: 'whatsapp' | 'email'
}): Promise<Resultado<{ caminho: string }>> {
  const supabase = createAdminClient()

  if (params.contentType.split(';')[0].trim() !== 'application/pdf') {
    return { ok: false, erro: 'via assinada precisa ser PDF', status: 415 }
  }
  const tamanho = params.bytes instanceof Buffer ? params.bytes.byteLength : params.bytes.byteLength
  if (tamanho > MAX_BYTES) return { ok: false, erro: 'arquivo grande demais', status: 413 }

  const { data: negocio } = await supabase
    .from('deals')
    .select('id, status, contract_document_url, signed_document_url, signed_candidate_url')
    .eq('id', params.dealId)
    .maybeSingle()
  if (!negocio) return { ok: false, erro: 'Negócio não encontrado.', status: 404 }
  if (negocio.status !== 'aprovado' || !negocio.contract_document_url || negocio.signed_document_url) {
    return { ok: false, erro: 'Negócio não está esperando via assinada.', status: 409 }
  }

  const caminho = `${params.dealId}/assinado-candidato-${Date.now()}.pdf`
  const { error: erroUpload } = await supabase.storage
    .from('contratos')
    .upload(caminho, params.bytes, { contentType: 'application/pdf', upsert: false })
  if (erroUpload) return { ok: false, erro: `upload falhou: ${erroUpload.message}`, status: 500 }

  const { error } = await supabase
    .from('deals')
    .update({
      signed_candidate_url: caminho,
      signed_candidate_received_at: new Date().toISOString(),
      signed_candidate_via: params.via,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.dealId)
  if (error) {
    await supabase.storage.from('contratos').remove([caminho])
    return { ok: false, erro: 'Não foi possível registrar.', status: 500 }
  }

  /* Um segundo envio substitui o anterior — a pessoa mandou a versão certa
     depois de uma errada. O arquivo antigo sai para não virar lixo no bucket. */
  if (negocio.signed_candidate_url && negocio.signed_candidate_url !== caminho) {
    await supabase.storage.from('contratos').remove([negocio.signed_candidate_url])
  }

  return { ok: true, caminho }
}

/** URL de vida curta para quem vai conferir a assinatura. */
export async function urlViaAssinadaCandidata(dealId: string): Promise<Resultado<{ url: string }>> {
  const supabase = createAdminClient()
  const { data: negocio } = await supabase.from('deals').select('signed_candidate_url').eq('id', dealId).maybeSingle()
  if (!negocio?.signed_candidate_url) return { ok: false, erro: 'Nenhuma via assinada aguardando confirmação.', status: 404 }

  const { data: url, error } = await supabase.storage
    .from('contratos')
    .createSignedUrl(negocio.signed_candidate_url, VALIDADE_SEGUNDOS)
  if (error || !url) return { ok: false, erro: 'Não foi possível abrir o arquivo.', status: 500 }
  return { ok: true, url: url.signedUrl }
}

/** A pessoa conferiu: o candidato vira a via assinada oficial. */
export async function confirmarViaAssinada(params: {
  dealId: string
  signatureMethod: 'manual' | 'govbr'
}): Promise<Resultado> {
  const supabase = createAdminClient()
  const { data: negocio } = await supabase
    .from('deals')
    .select('id, status, signed_candidate_url, signed_candidate_via, signed_document_url')
    .eq('id', params.dealId)
    .maybeSingle()
  if (!negocio) return { ok: false, erro: 'Negócio não encontrado.', status: 404 }
  if (!negocio.signed_candidate_url) return { ok: false, erro: 'Nenhuma via assinada aguardando confirmação.', status: 409 }
  if (negocio.signed_document_url) return { ok: false, erro: 'Este negócio já tem via assinada registrada.', status: 409 }
  if (negocio.status !== 'aprovado') return { ok: false, erro: `Negócio "${negocio.status}" não recebe via assinada.`, status: 409 }

  const { error } = await supabase
    .from('deals')
    .update({
      signed_document_url: negocio.signed_candidate_url,
      signature_method: params.signatureMethod,
      signed_returned_via: negocio.signed_candidate_via ?? 'whatsapp',
      contract_signed_at: new Date().toISOString(),
      signed_candidate_url: null,
      signed_candidate_received_at: null,
      signed_candidate_via: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.dealId)
  if (error) return { ok: false, erro: 'Não foi possível confirmar.', status: 500 }
  return { ok: true }
}

/**
 * Não era o contrato: o arquivo vai para a fila de documentos como 'outro'
 * (o caminho antigo), e o negócio volta a esperar a via assinada.
 */
export async function rejeitarViaAssinada(params: { dealId: string }): Promise<Resultado> {
  const supabase = createAdminClient()
  const { data: negocio } = await supabase
    .from('deals')
    .select('id, client_registration_id, signed_candidate_url, signed_candidate_via')
    .eq('id', params.dealId)
    .maybeSingle()
  if (!negocio) return { ok: false, erro: 'Negócio não encontrado.', status: 404 }
  if (!negocio.signed_candidate_url) return { ok: false, erro: 'Nenhuma via assinada aguardando confirmação.', status: 409 }

  /* Buckets diferentes não se copiam direto: baixa e sobe. O arquivo tem no
     máximo 10MB e isto é o caminho raro. */
  const { data: arquivo, error: erroDownload } = await supabase.storage
    .from('contratos')
    .download(negocio.signed_candidate_url)
  if (erroDownload || !arquivo) return { ok: false, erro: 'Não foi possível mover o arquivo.', status: 500 }

  const destino = `${negocio.client_registration_id}/${Date.now()}.pdf`
  const { error: erroUpload } = await supabase.storage
    .from('documentos')
    .upload(destino, await arquivo.arrayBuffer(), { contentType: 'application/pdf', upsert: false })
  if (erroUpload) return { ok: false, erro: 'Não foi possível mover o arquivo.', status: 500 }

  const { error: erroDoc } = await supabase.from('documents').insert({
    registration_id: negocio.client_registration_id,
    deal_id: negocio.id,
    type: 'outro',
    storage_path: destino,
    status: 'pendente_revisao',
    received_via: negocio.signed_candidate_via ?? 'whatsapp',
  })
  if (erroDoc) {
    await supabase.storage.from('documentos').remove([destino])
    return { ok: false, erro: 'Não foi possível registrar o documento.', status: 500 }
  }

  await supabase
    .from('deals')
    .update({
      signed_candidate_url: null,
      signed_candidate_received_at: null,
      signed_candidate_via: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.dealId)
  await supabase.storage.from('contratos').remove([negocio.signed_candidate_url])

  return { ok: true }
}

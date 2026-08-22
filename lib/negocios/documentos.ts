// ==========================================
// Documento anexado pelo PAINEL — o cliente mandou por e-mail, entregou em
// mãos, ou o corretor já tinha o arquivo. Sem isto o único caminho era o
// WhatsApp, e o agente ficava pedindo um documento que a equipe já tinha.
//
// A linha nasce em `documents` com `received_via = 'painel'` e, se quem anexou
// marcou "já conferi", já como 'aprovado' — quem subiu o arquivo olhou para
// ele; exigir uma segunda aprovação da mesma pessoa seria teatro. Sem a marca,
// entra na fila de conferência como qualquer outro.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'

export const TIPOS_DOCUMENTO = ['rg_cnh', 'comprovante_renda', 'comprovante_residencia', 'escritura_imovel', 'outro'] as const
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number]

const MAX_BYTES = 10 * 1024 * 1024
const EXTENSAO: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export type Resultado = { ok: true; documentId: string } | { ok: false; erro: string; status: number }

/** Regra pura — o check exercita sem banco. */
export function validarAnexo(
  tipo: unknown,
  contentType: string,
  tamanhoBytes: number
): { ok: true; tipo: TipoDocumento; extensao: string } | { ok: false; erro: string } {
  if (!TIPOS_DOCUMENTO.includes(tipo as TipoDocumento)) return { ok: false, erro: 'Tipo de documento inválido.' }
  const extensao = EXTENSAO[contentType.split(';')[0].trim()]
  if (!extensao) return { ok: false, erro: 'Envie PDF, JPG, PNG ou WebP.' }
  if (tamanhoBytes <= 0) return { ok: false, erro: 'Arquivo vazio.' }
  if (tamanhoBytes > MAX_BYTES) return { ok: false, erro: 'Arquivo acima de 10MB.' }
  return { ok: true, tipo: tipo as TipoDocumento, extensao }
}

export async function anexarDocumento(params: {
  dealId: string
  tipo: unknown
  bytes: ArrayBuffer
  contentType: string
  conferido: boolean
  userId: string
}): Promise<Resultado> {
  const supabase = createAdminClient()

  const v = validarAnexo(params.tipo, params.contentType, params.bytes.byteLength)
  if (!v.ok) return { ok: false, erro: v.erro, status: 400 }

  const { data: negocio } = await supabase
    .from('deals')
    .select('id, status, client_registration_id, documentos_solicitados')
    .eq('id', params.dealId)
    .maybeSingle()
  if (!negocio) return { ok: false, erro: 'Negócio não encontrado.', status: 404 }
  if (!['em_aprovacao', 'aprovado'].includes(negocio.status)) {
    return { ok: false, erro: `Negócio "${negocio.status}" não recebe documento — anexe depois do aceite da proposta.`, status: 409 }
  }

  const caminho = `${negocio.client_registration_id}/painel-${Date.now()}.${v.extensao}`
  const { error: erroUpload } = await supabase.storage
    .from('documentos')
    .upload(caminho, params.bytes, { contentType: params.contentType, upsert: false })
  if (erroUpload) return { ok: false, erro: 'Não foi possível salvar o arquivo.', status: 500 }

  const agora = new Date().toISOString()
  const { data: documento, error } = await supabase
    .from('documents')
    .insert({
      registration_id: negocio.client_registration_id,
      deal_id: negocio.id,
      type: v.tipo,
      storage_path: caminho,
      status: params.conferido ? 'aprovado' : 'pendente_revisao',
      reviewed_by: params.conferido ? params.userId : null,
      reviewed_at: params.conferido ? agora : null,
      received_via: 'painel',
    })
    .select('id')
    .single()
  if (error || !documento) {
    await supabase.storage.from('documentos').remove([caminho])
    return { ok: false, erro: 'Não foi possível registrar o documento.', status: 500 }
  }

  /* Tipo que não estava na lista pedida entra nela — senão o cartão não
     mostra o chip e o documento fica invisível no negócio. */
  const pedidos = (negocio.documentos_solicitados ?? []) as string[]
  if (!pedidos.includes(v.tipo)) {
    await supabase
      .from('deals')
      .update({ documentos_solicitados: [...pedidos, v.tipo], updated_at: agora })
      .eq('id', negocio.id)
  }

  return { ok: true, documentId: documento.id }
}

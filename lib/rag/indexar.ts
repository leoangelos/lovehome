// ==========================================
// Indexação de material institucional: arquivo → texto → chunks → vetores.
//
// Vive em lib/ e não na rota HTTP para ser testável sem subir sessão — mesma
// razão de lib/registrations/conferencia.ts.
//
// O documento nasce 'processando' e só vira 'indexado' quando os chunks estão
// gravados. Material 'processando' e material 'erro' NÃO são consultados pelo
// agente (a função SQL filtra por status), então uma indexação que morre no
// meio deixa o material invisível em vez de meio-visível — que seria o pior dos
// dois mundos: o agente citando metade de uma política.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { chunkDocument } from './chunker'
import { gerarEmbeddings } from './embedder'
import { extrairTexto } from './extrair'
import type { CategoriaMaterial } from './retriever'

const LOTE_INSERT = 50

export type ResultadoIndexacao =
  | { ok: true; documentId: string; chunks: number; paginas?: number }
  | { ok: false; erro: string; documentId?: string }

/**
 * Indexa um arquivo já salvo no storage.
 *
 * `documentId` já existe quando esta função é chamada — a rota cria a linha
 * antes, para que um material que falhe no meio apareça na tela COM o motivo
 * do erro, em vez de sumir e deixar quem enviou sem saber o que aconteceu.
 */
export async function indexarMaterial(params: {
  documentId: string
  buffer: Buffer
  nomeArquivo: string
}): Promise<ResultadoIndexacao> {
  const supabase = createAdminClient()

  async function falhar(erro: string): Promise<ResultadoIndexacao> {
    await supabase
      .from('rag_documents')
      .update({ status: 'erro', error_message: erro, updated_at: new Date().toISOString() })
      .eq('id', params.documentId)
    return { ok: false, erro, documentId: params.documentId }
  }

  // ---- 1. Texto ----
  const extracao = await extrairTexto(params.buffer, params.nomeArquivo)
  if (!extracao.ok) return falhar(extracao.erro)

  // ---- 2. Chunks ----
  const chunks = chunkDocument(extracao.texto)
  if (!chunks.length) return falhar('O arquivo não tem conteúdo suficiente para indexar.')

  // ---- 3. Vetores ----
  let vetores: number[][]
  try {
    vetores = await gerarEmbeddings(chunks.map((c) => c.content))
  } catch (e) {
    console.error('[rag/indexar] embeddings falharam:', (e as Error).message)
    return falhar('Não foi possível gerar os vetores. Tente reenviar em alguns minutos.')
  }

  if (vetores.length !== chunks.length) {
    return falhar('A geração de vetores devolveu quantidade diferente do esperado.')
  }

  /* Reindexação: apaga os chunks antigos deste documento antes de gravar os
     novos. Sem isso, reenviar o mesmo material duplicaria o conteúdo e o agente
     receberia o mesmo trecho duas vezes, gastando contexto à toa. */
  await supabase.from('rag_chunks').delete().eq('document_id', params.documentId)

  // ---- 4. Gravação ----
  const linhas = chunks.map((c, i) => ({
    document_id: params.documentId,
    content: c.content,
    chunk_index: c.chunkIndex,
    token_count: c.tokenCount,
    metadata: c.metadata,
    embedding: vetores[i],
  }))

  for (let i = 0; i < linhas.length; i += LOTE_INSERT) {
    const { error } = await supabase.from('rag_chunks').insert(linhas.slice(i, i + LOTE_INSERT))
    if (error) {
      console.error('[rag/indexar] insert falhou:', error.message)
      // Meio indexado é pior que nada: limpa e marca erro.
      await supabase.from('rag_chunks').delete().eq('document_id', params.documentId)
      return falhar('Não foi possível guardar os trechos do material.')
    }
  }

  await supabase
    .from('rag_documents')
    .update({
      status: 'indexado',
      chunk_count: chunks.length,
      error_message: null,
      indexed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.documentId)

  /* Mantém o índice coerente com o volume. Hoje a função decide não criar
     índice nenhum abaixo de 2000 chunks — varredura sequencial é exata e mais
     rápida nessa escala (ver migration 025). */
  const { error: erroIndice } = await supabase.rpc('reindexar_chunks_rag')
  if (erroIndice) console.error('[rag/indexar] manutenção do índice falhou:', erroIndice.message)

  console.log(
    `[rag] ${params.nomeArquivo} indexado: ${chunks.length} chunk(s)` +
      (extracao.paginas ? `, ${extracao.paginas} página(s)` : '')
  )

  return {
    ok: true,
    documentId: params.documentId,
    chunks: chunks.length,
    paginas: extracao.paginas,
  }
}

/** Apaga o material, seus chunks (cascata) e o arquivo no storage. */
export async function removerMaterial(documentId: string): Promise<{ ok: boolean; erro?: string }> {
  const supabase = createAdminClient()

  const { data: doc } = await supabase
    .from('rag_documents')
    .select('storage_path')
    .eq('id', documentId)
    .maybeSingle()

  if (!doc) return { ok: false, erro: 'Material não encontrado.' }

  const { error } = await supabase.from('rag_documents').delete().eq('id', documentId)
  if (error) {
    console.error('[rag] remoção falhou:', error.message)
    return { ok: false, erro: 'Não foi possível remover.' }
  }

  /* Arquivo depois da linha: se a ordem fosse a inversa e o delete falhasse, o
     material continuaria listado apontando para um arquivo que já não existe. */
  if (doc.storage_path) {
    await supabase.storage.from('materiais').remove([doc.storage_path])
  }

  await supabase.rpc('reindexar_chunks_rag')
  return { ok: true }
}

export interface MaterialLinha {
  id: string
  title: string
  categoria: CategoriaMaterial
  file_name: string | null
  file_type: string | null
  file_size: number | null
  status: 'processando' | 'indexado' | 'erro'
  error_message: string | null
  chunk_count: number
  indexed_at: string | null
  created_at: string
}

export async function listarMateriais(): Promise<MaterialLinha[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('rag_documents')
    .select(
      'id, title, categoria, file_name, file_type, file_size, status, error_message, chunk_count, indexed_at, created_at'
    )
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) throw new Error(`Falha ao listar materiais: ${error.message}`)
  return (data ?? []) as MaterialLinha[]
}

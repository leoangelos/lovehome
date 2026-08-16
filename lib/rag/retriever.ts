// ==========================================
// RAG Retriever — busca semântica sobre os materiais institucionais (PRD 11.1).
//
// O recorte da busca é por
// CATEGORIA. Lá o conteúdo era de turmas; aqui é de assunto, e quem pergunta
// sobre ITBI não deve receber a política de visitas.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { gerarEmbedding } from './embedder'

export { CATEGORIAS, ROTULO_CATEGORIA, type CategoriaMaterial } from '@/lib/ui/rotulos'
import type { CategoriaMaterial } from '@/lib/ui/rotulos'

export interface TrechoRecuperado {
  content: string
  documento: string
  categoria: string
  similaridade: number
  metadata: Record<string, unknown>
}

/* 0.35, e o número saiu de medição, não de intuição.
 *
 * Com `text-embedding-3-small` sobre um documento de política real, medimos:
 *
 *   "quanto custa o ITBI em São Paulo?"          → 0.480  (relevante)
 *   "preciso de quanto de entrada?"              → 0.460  (relevante)
 *   "taxa de manutenção da piscina do condomínio" → 0.278  (nada a ver)
 *
 * Um limiar de 0.5 cortava as duas primeiras — o material existia, a
 * pergunta era sobre ele, e a busca devolvia vazio. Pior do que parece: vazio
 * faz o agente dizer "vou confirmar com um corretor" para uma pergunta que a
 * imobiliária já respondeu por escrito.
 *
 * 0.35 separa com folga os dois grupos. Ainda assim ele NÃO é a defesa contra
 * resposta inventada — essa é a instrução da tool, que manda dizer que confirma
 * com um corretor quando os trechos não respondem à pergunta. O limiar corta
 * ruído óbvio; o julgamento do que serve é do modelo, com os trechos à vista.
 */
const LIMIAR_PADRAO = 0.35
const QUANTIDADE_PADRAO = 5

export async function buscarNoConhecimento(params: {
  consulta: string
  categoria?: CategoriaMaterial | null
  quantidade?: number
  limiar?: number
}): Promise<TrechoRecuperado[]> {
  const texto = params.consulta.trim()
  if (!texto) return []

  const vetor = await gerarEmbedding(texto)
  const supabase = createAdminClient()

  const { data, error } = await supabase.rpc('buscar_chunks_rag', {
    consulta: JSON.stringify(vetor),
    limiar: params.limiar ?? LIMIAR_PADRAO,
    quantidade: params.quantidade ?? QUANTIDADE_PADRAO,
    filtro_categoria: params.categoria ?? null,
  })

  if (error) {
    /* Busca de conhecimento que falha NÃO derruba a conversa: o agente segue
       sem o material e diz que confirma com um corretor. Lançar aqui mataria
       um atendimento inteiro por causa de uma consulta de apoio. */
    console.error('[rag/retriever] busca falhou:', error.message)
    return []
  }

  return (data ?? []) as TrechoRecuperado[]
}

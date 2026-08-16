// ==========================================
// Embeddings de imóvel e reordenação semântica (PRD 11.2).
//
// O que o embedding representa: o texto do anúncio como um corretor o
// descreveria — tipo, região, tamanho, e sobretudo a DESCRIÇÃO, que é onde
// moram as qualidades que nenhum filtro estruturado captura ("perto do metrô",
// "reformado", "vista livre", "aceita pet", "prédio com portaria 24h").
//
// O que ele NÃO representa: preço e código. Números viram tokens sem noção de
// ordem — "R$ 3.200" não fica "perto" de "R$ 3.500" no espaço vetorial, fica
// perto de outros textos que citam números parecidos por acaso. Preço é filtro
// estruturado e continua sendo, e incluir o valor no texto só adiciona ruído
// que compete com o que importa.
// ==========================================

import OpenAI from 'openai'
import { createAdminClient } from '@/lib/supabase/admin'
import { registrarUso } from '@/lib/observabilidade/uso'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

/* text-embedding-3-small: 1536 dimensões, que é exatamente o que a coluna
   `properties.embedding vector(1536)` comporta. Trocar de modelo sem trocar a
   dimensão da coluna quebra o insert; trocar a dimensão exige regerar TUDO,
   porque vetores de modelos diferentes não são comparáveis entre si. */
export const MODELO_EMBEDDING = 'text-embedding-3-small'
export const DIMENSOES = 1536

export interface ImovelParaEmbedding {
  reference_code?: string | null
  title?: string | null
  property_type?: string | null
  region?: string | null
  city?: string | null
  bedrooms?: number | null
  bathrooms?: number | null
  parking_spots?: number | null
  area_m2?: number | null
  description?: string | null
  amenities?: unknown
  operation?: string | null
}

/** Texto que vira vetor. Mudar isto exige regerar todos os embeddings. */
export function textoParaEmbedding(imovel: ImovelParaEmbedding): string {
  const partes: string[] = []

  if (imovel.title) partes.push(imovel.title)

  const ficha = [
    imovel.property_type,
    imovel.bedrooms ? `${imovel.bedrooms} dormitórios` : null,
    imovel.bathrooms ? `${imovel.bathrooms} banheiros` : null,
    imovel.parking_spots ? `${imovel.parking_spots} vagas` : null,
    imovel.area_m2 ? `${imovel.area_m2} m²` : null,
    imovel.region,
    imovel.city,
    imovel.operation === 'venda' ? 'à venda' : imovel.operation === 'aluguel' ? 'para alugar' : null,
  ]
    .filter(Boolean)
    .join(', ')
  if (ficha) partes.push(ficha)

  /* A descrição é o que de fato distingue dois apartamentos de 2 quartos na
     mesma região — por isso entra inteira, e por último, onde o modelo dá mais
     peso ao contexto acumulado. */
  if (imovel.description) partes.push(imovel.description)

  const caracteristicas = Array.isArray(imovel.amenities)
    ? imovel.amenities.filter((f) => typeof f === 'string')
    : []
  if (caracteristicas.length) partes.push(caracteristicas.join(', '))

  return partes.join('. ')
}

export async function gerarEmbedding(
  texto: string,
  params?: { origem?: 'embedding_imovel' | 'embedding_busca' }
): Promise<number[] | null> {
  const limpo = texto.trim()
  if (!limpo) return null

  try {
    const r = await openai.embeddings.create({
      model: MODELO_EMBEDDING,
      input: limpo.slice(0, 8000),
    })

    /* `operacao` diz de onde veio: o mesmo `gerarEmbedding` serve para indexar
       o acervo (em lote, raro) e para cada busca qualitativa de cliente (uma
       por conversa). Somados viram um número que não explica nada. */
    await registrarUso({
      operacao: params?.origem ?? 'embedding_imovel',
      modelo: MODELO_EMBEDDING,
      tokensEntrada: r.usage?.prompt_tokens,
      detalhe: {
        resumo:
          params?.origem === 'embedding_busca'
            ? 'Vetorizou o critério qualitativo da busca'
            : 'Vetorizou a descrição de um imóvel',
        entradas: [{ rotulo: 'Texto', valor: `${texto.length} caracteres` }],
      },
    })

    return r.data[0].embedding
  } catch (e) {
    console.error('[embeddings] geração falhou:', (e as Error).message)
    return null
  }
}

/**
 * Recalcula e grava o embedding de um imóvel.
 *
 * Falha aqui NÃO derruba a operação que chamou: um imóvel sem embedding
 * continua achável pelo filtro estruturado, só não participa da reordenação.
 * Bloquear a criação de um imóvel porque a API de embedding piscou seria trocar
 * um problema pequeno por um grande.
 */
export async function atualizarEmbeddingDoImovel(propertyId: string): Promise<boolean> {
  const supabase = createAdminClient()

  const { data: imovel } = await supabase
    .from('properties')
    .select(
      'reference_code, title, property_type, region, city, bedrooms, bathrooms, parking_spots, area_m2, description, amenities, operation'
    )
    .eq('id', propertyId)
    .maybeSingle()

  if (!imovel) return false

  const vetor = await gerarEmbedding(textoParaEmbedding(imovel))
  if (!vetor) return false

  const { error } = await supabase
    .from('properties')
    .update({ embedding: vetor })
    .eq('id', propertyId)

  if (error) {
    console.error('[embeddings] gravação falhou:', error.message)
    return false
  }
  return true
}

export interface ImovelReordenado {
  id: string
  distancia: number
}

/**
 * Reordena ids JÁ FILTRADOS por proximidade semântica ao texto da busca.
 *
 * A função SQL por trás disto não tem cláusula de filtro: ela só aceita uma
 * lista de ids e devolve os mesmos ids ordenados. É de propósito — assim não
 * existe caminho pelo qual a busca semântica alargue o conjunto elegível e o
 * agente acabe oferecendo imóvel fora da faixa de preço pedida (PRD 11.2).
 *
 * Devolve null quando não deu para reordenar (sem embeddings, API fora,
 * critério vazio). Quem chama mantém a ordem estruturada — degradar para a
 * ordem por preço é sempre melhor do que devolver nada.
 */
export async function reordenarPorSimilaridade(
  ids: string[],
  criterio: string,
  limite = 5
): Promise<ImovelReordenado[] | null> {
  if (!ids.length || !criterio.trim()) return null

  const vetor = await gerarEmbedding(criterio, { origem: 'embedding_busca' })
  if (!vetor) return null

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('reordenar_imoveis_por_similaridade', {
    ids,
    consulta: JSON.stringify(vetor),
    limite,
  })

  if (error) {
    console.error('[embeddings] reordenação falhou:', error.message)
    return null
  }
  if (!data?.length) return null

  return data as ImovelReordenado[]
}

/** Quantos imóveis disponíveis ainda estão sem embedding. */
export async function imoveisSemEmbedding(): Promise<number> {
  const supabase = createAdminClient()
  const { count } = await supabase
    .from('properties')
    .select('id', { count: 'exact', head: true })
    .is('embedding', null)
  return count ?? 0
}

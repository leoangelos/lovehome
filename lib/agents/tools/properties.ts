// ==========================================
// Tools de imovel — search_properties e get_market_comparables (PRD 11).
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { brl } from '@/lib/utils/format'
import { reordenarPorSimilaridade } from '@/lib/imoveis/embeddings'
import type OpenAI from 'openai'

type Tool = OpenAI.ChatCompletionTool

export const searchPropertiesTool: Tool = {
  type: 'function',
  function: {
    name: 'search_properties',
    description: `Busca imóveis disponíveis na base da LoveHome. Chame assim que tiver pelo
menos a operação (compra ou aluguel) e mais um critério — região ou faixa de preço.
Não invente imóveis: só apresente o que esta tool retornar.`,
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['venda', 'aluguel'],
          description: 'Se a pessoa quer comprar ou alugar',
        },
        region: { type: 'string', description: 'Bairro ou região de São Paulo' },
        property_type: {
          type: 'string',
          description: 'apartamento, casa, studio, cobertura, sobrado, kitnet, terreno, comercial',
        },
        price_max_cents: { type: 'number', description: 'Teto de preço em centavos' },
        price_min_cents: { type: 'number', description: 'Piso de preço em centavos' },
        bedrooms_min: { type: 'number', description: 'Mínimo de dormitórios' },
        criterio_qualitativo: {
          type: 'string',
          description:
            'O que a pessoa pediu que NÃO cabe em filtro: "perto do metrô", "reformado", ' +
            '"vista livre", "aceita pet", "silencioso". Copie as palavras dela. ' +
            'Omita quando o pedido for só numérico.',
        },
      },
      required: ['operation'],
    },
  },
}

export const getMarketComparablesTool: Tool = {
  type: 'function',
  function: {
    name: 'get_market_comparables',
    description: `Busca imóveis comparáveis já publicados para sugerir uma faixa de preço a um
proprietário que quer disponibilizar um imóvel. Nunca apresente como avaliação oficial —
é uma referência de mercado com base no que já está publicado, não um laudo.`,
    parameters: {
      type: 'object',
      properties: {
        region: { type: 'string', description: 'Bairro ou região do imóvel' },
        property_type: { type: 'string', description: 'Tipo do imóvel' },
        bedrooms: { type: 'number', description: 'Número de dormitórios' },
        operation: { type: 'string', enum: ['venda', 'aluguel'] },
      },
      required: ['region', 'property_type', 'operation'],
    },
  },
}

interface SearchParams {
  operation: 'venda' | 'aluguel'
  region?: string
  property_type?: string
  price_max_cents?: number
  price_min_cents?: number
  bedrooms_min?: number
  criterio_qualitativo?: string
}

/**
 * Filtro estruturado primeiro, sempre (PRD 11.2).
 *
 * O reranking semantico sobre `description` ainda NAO roda: `properties.embedding`
 * esta vazio e o indice ivfflat foi criado com a tabela vazia. Quando os
 * embeddings existirem, a busca semantica entra APENAS reordenando o conjunto
 * que este filtro devolveu — nunca substituindo o filtro, senao o agente passa a
 * oferecer imovel fora da faixa de preco que a pessoa pediu.
 */
export async function handleSearchProperties(params: SearchParams) {
  const supabase = createAdminClient()
  const colunaPreco = params.operation === 'venda' ? 'price_cents' : 'rent_price_cents'

  const criterio = params.criterio_qualitativo?.trim()

  /* Com criterio qualitativo o filtro traz um conjunto MAIOR para a reordenacao
     ter o que escolher; sem ele, os 5 mais baratos ja sao a resposta. O teto de
     40 e o que o reranking consegue aproveitar sem transformar a tool numa
     leitura de catalogo inteiro. */
  const teto = criterio ? 40 : 5

  let query = supabase
    .from('properties')
    .select(
      'id, reference_code, title, property_type, region, bedrooms, bathrooms, parking_spots, area_m2, price_cents, rent_price_cents, condo_fee_cents, description'
    )
    .eq('status', 'disponivel')
    .not(colunaPreco, 'is', null)
    // 'ambos' serve tanto venda quanto locação
    .in('operation', [params.operation, 'ambos'])

  if (params.region) query = query.ilike('region', `%${params.region}%`)
  if (params.property_type) query = query.ilike('property_type', `%${params.property_type}%`)
  if (params.price_max_cents) query = query.lte(colunaPreco, params.price_max_cents)
  if (params.price_min_cents) query = query.gte(colunaPreco, params.price_min_cents)
  if (params.bedrooms_min) query = query.gte('bedrooms', params.bedrooms_min)

  const { data, error } = await query.order(colunaPreco, { ascending: true }).limit(teto)

  if (error) return { encontrados: 0, erro: error.message }

  if (!data || data.length === 0) {
    /* Zero resultado com regiao definida costuma ser filtro apertado demais, nao
       ausencia de estoque. Devolver a contagem sem a regiao deixa o agente
       oferecer alternativa concreta em vez de encerrar com "não achei nada". */
    const { count } = await supabase
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'disponivel')
      .in('operation', [params.operation, 'ambos'])

    return {
      encontrados: 0,
      total_disponivel_na_operacao: count ?? 0,
      sugestao:
        'Nenhum imóvel com esses critérios. Ofereça ampliar a faixa de preço ou considerar uma região vizinha antes de encerrar.',
    }
  }

  /* ---- Reordenacao semantica (PRD 11.2) ----
     O conjunto elegivel ja esta fechado acima. Daqui em diante so muda a ORDEM
     e o corte dos 5 primeiros — nenhum imovel entra que o filtro nao tenha
     deixado passar. Se a reordenacao falhar (sem embedding, API fora), fica a
     ordem por preco: resposta em ordem pior e melhor do que nenhuma resposta. */
  let selecionados = data.slice(0, 5)
  let ordenadoPor: 'preco' | 'relevancia' = 'preco'

  if (criterio && data.length > 1) {
    const reordenados = await reordenarPorSimilaridade(
      data.map((p) => p.id),
      criterio,
      5
    )

    if (reordenados?.length) {
      const porId = new Map(data.map((p) => [p.id, p]))
      const escolhidos = reordenados
        .map((r) => porId.get(r.id))
        .filter((p): p is (typeof data)[number] => Boolean(p))

      if (escolhidos.length) {
        selecionados = escolhidos
        ordenadoPor = 'relevancia'
      }
    }
  }

  return {
    encontrados: selecionados.length,
    considerados: data.length,
    ordenado_por: ordenadoPor,
    ...(criterio && ordenadoPor === 'preco'
      ? {
          aviso_ordenacao:
            'Não foi possível ordenar por relevância; a lista está por preço. Não afirme que ' +
            'os imóveis atendem ao critério qualitativo — mencione-o como algo a confirmar.',
        }
      : {}),
    imoveis: selecionados.map((p) => ({
      codigo: p.reference_code,
      titulo: p.title,
      tipo: p.property_type,
      regiao: p.region,
      dormitorios: p.bedrooms,
      banheiros: p.bathrooms,
      vagas: p.parking_spots,
      area_m2: p.area_m2,
      preco: brl(params.operation === 'venda' ? p.price_cents : p.rent_price_cents),
      condominio: p.condo_fee_cents ? brl(p.condo_fee_cents) : null,
      descricao: p.description,
    })),
  }
}

interface ComparablesParams {
  region: string
  property_type: string
  bedrooms?: number
  operation: 'venda' | 'aluguel'
}

export async function handleGetMarketComparables(params: ComparablesParams) {
  const supabase = createAdminClient()
  const colunaPreco = params.operation === 'venda' ? 'price_cents' : 'rent_price_cents'

  let query = supabase
    .from('properties')
    .select(`${colunaPreco}, area_m2, bedrooms`)
    .ilike('region', `%${params.region}%`)
    .ilike('property_type', `%${params.property_type}%`)
    .eq('status', 'disponivel')
    .not(colunaPreco, 'is', null)

  if (params.bedrooms) query = query.eq('bedrooms', params.bedrooms)

  const { data } = await query.limit(30)

  /* Regra de negocio (PRD 11.3): com menos de 3 comparaveis o agente nao
     arrisca numero. Uma sugestao mal calibrada vira a ancora da conversa com o
     proprietario e fica dificil de desfazer depois. */
  if (!data || data.length < 3) {
    return {
      encontrado: false,
      amostra: data?.length ?? 0,
      instrucao:
        'Poucos comparáveis nessa região e tipo. NÃO sugira um valor. Diga que a amostra é pequena e ofereça encaminhar para um corretor avaliar.',
    }
  }

  /* `colunaPreco` e escolhida em tempo de execucao, entao o supabase-js infere
     `data` como uniao de dois formatos de linha e o TypeScript nao consegue
     chamar .map sobre a uniao. O cast reduz para a forma que de fato importa
     aqui: um registro com a coluna de preco escolhida. */
  const linhas = data as unknown as Record<string, number | null>[]

  const precos = linhas
    .map((p) => p[colunaPreco])
    .filter((v): v is number => typeof v === 'number')
    .sort((a, b) => a - b)

  return {
    encontrado: true,
    amostra: precos.length,
    preco_min: brl(precos[0]),
    preco_mediano: brl(precos[Math.floor(precos.length / 2)]),
    preco_max: brl(precos[precos.length - 1]),
    instrucao:
      'Apresente como referência de mercado ("imóveis parecidos na região saem entre X e Y"), nunca como avaliação oficial.',
  }
}

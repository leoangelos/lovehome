import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import { handleSearchProperties } from '../lib/agents/tools/properties'
import {
  textoParaEmbedding,
  reordenarPorSimilaridade,
  imoveisSemEmbedding,
} from '../lib/imoveis/embeddings'

/* Busca híbrida de imóveis (PRD 11.2). Rodar com: npm run check:busca
   Não precisa do servidor de dev.

   CHAMA A OPENAI — cada busca com critério qualitativo gera um embedding da
   consulta (barato: são requisições de embedding, não de chat).

   A regra que este script protege: o filtro estruturado define QUEM pode
   aparecer; a semântica só decide EM QUE ORDEM. Invertido, o agente passa a
   oferecer imóvel fora da faixa de preço que a pessoa pediu porque a descrição
   "casava melhor" — e isso é pior do que não ter busca semântica nenhuma.

   O caso montado abaixo existe para expor exatamente essa inversão: o melhor
   casamento semântico para "aceita pet" no acervo é o LH-1005, que está ACIMA
   do teto de preço usado no teste. Se ele aparecer, a semântica furou o filtro. */

const supabase = createAdminClient()

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

const TETO = 400000 // R$ 4.000

interface Resultado {
  encontrados: number
  considerados?: number
  ordenado_por?: string
  imoveis?: { codigo: string; preco: string; descricao: string | null }[]
}

async function main() {
  // ================= Cobertura =================
  console.log('--- Cobertura dos embeddings ---')

  const semEmbedding = await imoveisSemEmbedding()
  ok('todo imóvel tem embedding', semEmbedding === 0, `${semEmbedding} sem`)
  if (semEmbedding > 0) {
    console.log('    Rode `npm run embeddings` antes deste teste.\n')
  }

  // ================= Texto do embedding =================
  console.log('\n--- Texto que vira vetor ---')

  const texto = textoParaEmbedding({
    title: 'Apartamento reformado',
    property_type: 'apartamento',
    region: 'Pinheiros',
    bedrooms: 2,
    area_m2: 70,
    description: 'A 600m da estação Faria Lima. Aceita pet.',
    amenities: ['portaria 24h', 'academia'],
    operation: 'aluguel',
  })

  ok('inclui a descrição', texto.includes('Faria Lima'))
  ok('inclui as características', texto.includes('portaria 24h'))
  ok('inclui a região', texto.includes('Pinheiros'))
  /* Preço fora de propósito: número vira token sem noção de ordem, então
     "R$ 3.200" não fica perto de "R$ 3.500" no espaço vetorial — só adiciona
     ruído competindo com o que distingue os imóveis. */
  ok('NÃO inclui preço', !/R\$|\d{4,}/.test(texto), texto.slice(0, 120))

  // ================= Ordem sem critério =================
  console.log('\n--- Sem critério qualitativo ---')

  const porPreco = (await handleSearchProperties({
    operation: 'aluguel',
    price_max_cents: TETO,
  })) as Resultado

  ok('encontrou imóveis', (porPreco.encontrados ?? 0) > 0, `${porPreco.encontrados}`)
  ok('ordenado por preço', porPreco.ordenado_por === 'preco', String(porPreco.ordenado_por))
  console.log(`INFO  ${porPreco.imoveis?.map((i) => `${i.codigo} ${i.preco}`).join(' · ')}`)

  const codigosBase = porPreco.imoveis?.map((i) => i.codigo) ?? []

  // ================= Ordem com critério =================
  console.log('\n--- Com critério qualitativo: "aceita pet" ---')

  const porRelevancia = (await handleSearchProperties({
    operation: 'aluguel',
    price_max_cents: TETO,
    criterio_qualitativo: 'aceita pet, pode levar cachorro',
  })) as Resultado

  const codigos = porRelevancia.imoveis?.map((i) => i.codigo) ?? []
  console.log(`INFO  ${porRelevancia.imoveis?.map((i) => `${i.codigo} ${i.preco}`).join(' · ')}`)

  ok('reordenou por relevância', porRelevancia.ordenado_por === 'relevancia', String(porRelevancia.ordenado_por))

  /* LH-1017 é o único abaixo do teto cuja descrição fala em pet. Se a
     reordenação funciona, ele sobe; por preço ele seria o quinto. */
  ok('o imóvel que aceita pet subiu para o topo', codigos[0] === 'LH-1017', codigos.join(', '))
  ok('a ordem mudou em relação ao preço', codigos[0] !== codigosBase[0], `${codigos[0]} vs ${codigosBase[0]}`)

  // ---- A asserção central ----
  const acimaDoTeto = 'LH-1005' // aceita pet, mas custa R$ 4.800
  ok(
    'NÃO trouxe o imóvel fora da faixa de preço',
    !codigos.includes(acimaDoTeto),
    codigos.join(', ')
  )

  const { data: precos } = await supabase
    .from('properties')
    .select('reference_code, rent_price_cents')
    .in('reference_code', codigos)

  ok(
    'todo resultado respeita o teto de preço',
    (precos ?? []).every((p) => (p.rent_price_cents ?? 0) <= TETO),
    (precos ?? []).map((p) => `${p.reference_code}=${p.rent_price_cents}`).join(', ')
  )

  ok(
    'o conjunto é subconjunto do que o filtro deixou passar',
    codigos.every((c) => codigosBase.includes(c) || (porRelevancia.considerados ?? 0) > codigosBase.length),
    `considerados: ${porRelevancia.considerados}`
  )

  // ================= Outro critério, para não ser coincidência =================
  console.log('\n--- Outro critério: "prédio com coworking" ---')

  const coworking = (await handleSearchProperties({
    operation: 'aluguel',
    price_max_cents: TETO,
    criterio_qualitativo: 'prédio com coworking e espaço para trabalhar',
  })) as Resultado
  const cw = coworking.imoveis?.map((i) => i.codigo) ?? []
  console.log(`INFO  ${cw.join(' · ')}`)
  ok('critério diferente muda a ordem', cw[0] !== codigos[0], `${cw[0]} vs ${codigos[0]}`)

  // ================= A função SQL não amplia =================
  console.log('\n--- A função de reordenação ---')

  const { data: dois } = await supabase
    .from('properties')
    .select('id, reference_code')
    .eq('status', 'disponivel')
    .limit(2)

  const ids = (dois ?? []).map((d) => d.id)
  const reordenados = await reordenarPorSimilaridade(ids, 'apartamento com vista livre', 10)

  /* Pedi 10, passei 2 ids. Se voltar mais do que 2, a função tem cláusula de
     seleção própria e o filtro estruturado deixou de ser a última palavra. */
  ok('devolve no máximo os ids que recebeu', (reordenados?.length ?? 0) <= ids.length, `${reordenados?.length} de ${ids.length}`)
  ok(
    'e nenhum id de fora',
    (reordenados ?? []).every((r) => ids.includes(r.id))
  )

  ok('critério vazio não reordena', (await reordenarPorSimilaridade(ids, '   ')) === null)
  ok('lista vazia não reordena', (await reordenarPorSimilaridade([], 'qualquer coisa')) === null)

  // ================= Degradação =================
  console.log('\n--- Quando não há o que reordenar ---')

  const semNada = (await handleSearchProperties({
    operation: 'aluguel',
    region: 'Bairro Que Nao Existe',
    criterio_qualitativo: 'aceita pet',
  })) as Resultado & { total_disponivel_na_operacao?: number; sugestao?: string }

  ok('zero resultado não quebra', semNada.encontrados === 0)
  ok('e devolve o total da operação para o agente oferecer alternativa', typeof semNada.total_disponivel_na_operacao === 'number', String(semNada.total_disponivel_na_operacao))

  console.log('\nNada foi criado — este teste só lê.')
}

main().catch((e) => {
  console.error('erro:', e.message ?? e)
  process.exit(1)
})

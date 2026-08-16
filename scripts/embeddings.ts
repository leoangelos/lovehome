import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import { gerarEmbedding, textoParaEmbedding, MODELO_EMBEDDING } from '../lib/imoveis/embeddings'

/* Popula os embeddings dos imóveis. Rodar com: npm run embeddings
   CHAMA A OPENAI — uma requisição de embedding por imóvel (barato, mas não zero).

   Idempotente: por padrão só processa quem está sem embedding. Use
   `npm run embeddings -- --tudo` para regerar todos, que é o necessário depois
   de mudar `textoParaEmbedding` ou o modelo — vetores gerados por textos (ou
   modelos) diferentes não são comparáveis entre si, e misturar os dois deixa a
   ordenação errada sem nenhum sintoma visível.

   Termina com REINDEX. O índice ivfflat foi criado com a tabela vazia e aprende
   os centroides a partir dos dados que existem no momento — sem reindexar
   depois de popular, a busca semântica responde, ordena, e ordena mal. */

const supabase = createAdminClient()
const TUDO = process.argv.includes('--tudo')
const LOTE = 20

async function main() {
  let consulta = supabase
    .from('properties')
    .select(
      'id, reference_code, title, property_type, region, city, bedrooms, bathrooms, parking_spots, area_m2, description, amenities, operation'
    )
    .order('reference_code')

  if (!TUDO) consulta = consulta.is('embedding', null)

  const { data: imoveis, error } = await consulta
  if (error) throw new Error(`leitura falhou: ${error.message}`)

  /* Nada a gerar NÃO encerra o script: deixar o índice correto é tanto trabalho
     dele quanto gerar os vetores, e o índice pode estar desatualizado por outro
     caminho — imóvel apagado no painel, embedding gravado pela edição de um
     imóvel, restauração de backup. Reconstruir é barato e idempotente. */
  if (!imoveis?.length) {
    console.log('Nenhum embedding a gerar. Use --tudo para regerar todos.')
  } else {
    console.log(`${imoveis.length} imóvel(is) para processar com ${MODELO_EMBEDDING}.`)
    if (TUDO) console.log('Modo --tudo: regerando inclusive quem já tinha embedding.\n')
    await gerarTodos(imoveis)
  }

  await reconstruirIndice()

  const { count: restantes } = await supabase
    .from('properties')
    .select('id', { count: 'exact', head: true })
    .is('embedding', null)
  console.log(`Imóveis ainda sem embedding: ${restantes ?? 0}`)
}

type ImovelLinha = { id: string; reference_code: string }

async function gerarTodos(imoveis: ImovelLinha[]) {
  let feitos = 0
  const falhas: string[] = []

  for (let i = 0; i < imoveis.length; i += LOTE) {
    const fatia = imoveis.slice(i, i + LOTE)

    /* Em paralelo dentro do lote: são chamadas independentes de leitura, e o
       lote limita quantas ficam em voo ao mesmo tempo. Diferente das tools do
       agente, que rodam em sequência porque escrevem no mesmo rascunho. */
    const vetores = await Promise.all(
      fatia.map(async (imovel) => ({
        id: imovel.id,
        codigo: imovel.reference_code,
        vetor: await gerarEmbedding(textoParaEmbedding(imovel)),
      }))
    )

    for (const r of vetores) {
      if (!r.vetor) {
        falhas.push(r.codigo)
        continue
      }
      const { error: erroUpdate } = await supabase
        .from('properties')
        .update({ embedding: r.vetor })
        .eq('id', r.id)

      if (erroUpdate) {
        falhas.push(`${r.codigo} (${erroUpdate.message})`)
      } else {
        feitos++
      }
    }

    console.log(`  ${Math.min(i + LOTE, imoveis.length)}/${imoveis.length}`)
  }

  console.log(`\n${feitos} embedding(s) gravado(s).`)
  if (falhas.length) {
    console.log(`Falharam: ${falhas.join(', ')}`)
    process.exitCode = 1
  }
}

async function reconstruirIndice() {
  const { data, error } = await supabase.rpc('reindexar_embeddings_imoveis')

  if (error) {
    console.error(`\nReconstrução do índice falhou: ${error.message}`)
    console.error('Sem isso a ordenação semântica fica ruim em silêncio — não ignore.')
    process.exitCode = 1
    return
  }
  console.log(`\n${data}`)
}

main().catch((e) => {
  console.error('erro:', e.message ?? e)
  process.exit(1)
})

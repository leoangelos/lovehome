import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import { adicionarFotos, salvarOrdemFotos, caminhoDaUrl } from '../lib/imoveis/fotos'

/* Gestão de fotos do imóvel. Rodar com: npm run check:fotos
   (o servidor de dev precisa estar no ar)

   NÃO chama a OpenAI.

   Duas coisas protegidas aqui:

   1. SÓ FOTO JÁ ENVIADA pode ser reordenada. Aceitar URL de fora deixaria
      alguém apontar a foto de um imóvel para um endereço arbitrário — e essas
      imagens são renderizadas na VITRINE PÚBLICA, para quem nunca fez login.
   2. REMOVER APAGA O ARQUIVO, não só a referência. Sem isso o bucket acumula
      imagem que ninguém mais alcança e ninguém sabe que existe. */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const supabase = createAdminClient()

const MARCA = 'LH-TESTEFOTO'
let propertyId: string | null = null

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

/** PNG 1x1 válido — o bucket valida o mime, então precisa ser imagem de verdade. */
function pngMinimo(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
}

function arquivo(nome: string, tipo = 'image/png'): File {
  return new File([new Uint8Array(pngMinimo())], nome, { type: tipo })
}

/** O bucket é a verdade; a URL pública fica em cache de CDN e mente por um tempo. */
async function existeNoBucket(url: string): Promise<boolean> {
  const caminho = caminhoDaUrl(url)
  if (!caminho) return false
  const pasta = caminho.split('/').slice(0, -1).join('/')
  const nome = caminho.split('/').pop()!
  const { data } = await supabase.storage.from('imoveis').list(pasta)
  return (data ?? []).some((f) => f.name === nome)
}

async function limpar() {
  const { data: sobras } = await supabase
    .from('properties')
    .select('id, photos')
    .eq('reference_code', MARCA)

  for (const s of sobras ?? []) {
    const caminhos = ((s.photos ?? []) as string[])
      .map(caminhoDaUrl)
      .filter((c): c is string => Boolean(c))
    if (caminhos.length) await supabase.storage.from('imoveis').remove(caminhos)
    const { error } = await supabase.from('properties').delete().eq('id', s.id)
    if (error) throw new Error(`limpeza do imóvel falhou: ${error.message}`)
  }
  propertyId = null
}

async function main() {
  await limpar()

  const { data: imovel, error } = await supabase
    .from('properties')
    .insert({
      reference_code: MARCA,
      title: 'Imóvel de teste de fotos',
      operation: 'aluguel',
      property_type: 'apartamento',
      region: 'Teste',
      rent_price_cents: 200000,
      status: 'disponivel',
      photos: [],
    })
    .select('id')
    .single()
  if (error) throw new Error(`imóvel: ${error.message}`)
  propertyId = imovel.id

  // ================= Autorização =================
  console.log('--- Autorização ---')

  const form = new FormData()
  form.append('fotos', new Blob([new Uint8Array(pngMinimo())], { type: 'image/png' }), 'x.png')
  const postSemSessao = await fetch(`${BASE}/api/admin/properties/${propertyId}/fotos`, {
    method: 'POST',
    body: form,
  })
  ok('enviar foto exige sessão', postSemSessao.status === 401, `status ${postSemSessao.status}`)

  const patchSemSessao = await fetch(`${BASE}/api/admin/properties/${propertyId}/fotos`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fotos: [] }),
  })
  ok('reordenar exige sessão', patchSemSessao.status === 401, `status ${patchSemSessao.status}`)

  const { data: intacto } = await supabase
    .from('properties')
    .select('photos')
    .eq('id', propertyId)
    .single()
  ok('e nenhuma tentativa mexeu no imóvel', ((intacto?.photos ?? []) as string[]).length === 0)

  // ================= Envio =================
  console.log('\n--- Envio ---')

  const subiu = await adicionarFotos(propertyId!, [arquivo('a.png'), arquivo('b.png'), arquivo('c.png')])
  ok('sobe três fotos', subiu.ok === true && subiu.fotos.length === 3, JSON.stringify(subiu).slice(0, 70))
  if (!subiu.ok) throw new Error('sem fotos não há o que testar')

  const urls = subiu.fotos
  ok('a foto enviada está no bucket', await existeNoBucket(urls[0]))
  ok('e é servida publicamente', (await fetch(urls[0])).status === 200)

  const tipoErrado = await adicionarFotos(propertyId!, [arquivo('doc.pdf', 'application/pdf')])
  ok('tipo não aceito é recusado', tipoErrado.ok === false, JSON.stringify(tipoErrado).slice(0, 60))

  const { data: aposRecusa } = await supabase
    .from('properties')
    .select('photos')
    .eq('id', propertyId)
    .single()
  ok('e a recusa não mexeu na lista', ((aposRecusa?.photos ?? []) as string[]).length === 3)

  // ================= Ordem e capa =================
  console.log('\n--- Ordem e capa ---')

  /* A capa é o índice 0 — é o que o card da vitrine e o Open Graph leem. */
  ok('a capa é a primeira enviada', (aposRecusa!.photos as string[])[0] === urls[0])

  const trocouCapa = await salvarOrdemFotos(propertyId!, [urls[2], urls[0], urls[1]])
  ok('definir capa é mover para o índice 0', trocouCapa.ok === true && trocouCapa.fotos[0] === urls[2])
  ok('e nenhuma foto se perde na troca', trocouCapa.ok === true && trocouCapa.fotos.length === 3)
  ok('nada foi apagado só por reordenar', trocouCapa.ok === true && trocouCapa.removidas === 0)

  // ---- a asserção de segurança ----
  const forasteira = await salvarOrdemFotos(propertyId!, [
    urls[2],
    'https://site-de-terceiro.example/foto-qualquer.jpg',
  ])
  /* Essas imagens são renderizadas na vitrine pública. Aceitar URL de fora
     deixaria alguém apontar a foto de um imóvel para um endereço arbitrário. */
  ok('URL de fora é recusada', forasteira.ok === false && forasteira.status === 400, JSON.stringify(forasteira).slice(0, 70))

  const { data: naoEntrou } = await supabase
    .from('properties')
    .select('photos')
    .eq('id', propertyId)
    .single()
  const listaAtual = (naoEntrou?.photos ?? []) as string[]
  ok('e não entrou na lista', !JSON.stringify(listaAtual).includes('site-de-terceiro'))
  /* Recusa parcial seria pior que recusa: nada pode ser removido junto. */
  ok('nem removeu as que existiam', listaAtual.length === 3)

  // ================= Remoção =================
  console.log('\n--- Remoção ---')

  const paraRemover = urls[1]
  ok('a foto existe no bucket antes de remover', await existeNoBucket(paraRemover))

  const removeu = await salvarOrdemFotos(propertyId!, listaAtual.filter((u) => u !== paraRemover))
  ok('remover é tirar do array', removeu.ok === true && removeu.removidas === 1, JSON.stringify(removeu).slice(0, 60))
  ok('sobraram duas', removeu.ok === true && removeu.fotos.length === 2)

  /* A LISTAGEM do bucket é a verdade. A URL pública continua respondendo 200
     por um tempo — o CDN do Supabase serve a cópia em cache mesmo depois de o
     objeto sumir (com cache-buster já dá 400). Conferir por fetch daria um
     falso negativo aqui, e uma falsa sensação de segurança em produção. */
  ok('e o arquivo saiu do bucket', (await existeNoBucket(paraRemover)) === false)

  // ================= A vitrine reflete a capa =================
  console.log('\n--- A vitrine usa a capa ---')

  const html = await (await fetch(`${BASE}/imoveis/${MARCA}`)).text()
  const capa = removeu.ok ? removeu.fotos[0] : ''
  const nomeDoArquivo = capa.split('/').pop()!
  /* A prova de que a ordem escolhida no painel chega ao cliente: a imagem do
     Open Graph é a primeira da lista. */
  ok('a capa aparece na página pública', html.includes(nomeDoArquivo), nomeDoArquivo)

  await limpar()
  console.log('\nDados de teste removidos, aqui e no bucket.')
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})

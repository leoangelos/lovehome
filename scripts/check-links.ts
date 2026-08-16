import 'dotenv/config'
import { basePublica, urlPublica, urlDoImovel } from '../lib/utils/url-publica'
import { handleSearchProperties } from '../lib/agents/tools/properties'
import { removerLinksInventados } from '../lib/agents/base-agent'

/* Links que o agente manda ao cliente. Rodar com: npm run check:links

   NÃO chama a OpenAI.

   O que está sendo protegido: em produção o agente escreveu
   `https://www.lovehome.com.br/imovel/LH-1001` — domínio e caminho que nunca
   existiram — porque a tool não devolvia o link e o modelo "lembrou" um. Um
   link errado saindo pelo WhatsApp da imobiliária parece phishing, e o cliente
   não tem como saber que foi alucinação. Três camadas, na ordem em que valem:
   a tool entrega o link pronto; o prompt manda usar só o que veio de tool; e o
   base-agent REMOVE qualquer URL que não tenha vindo de fonte confiável. */

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

async function main() {
  // ================= Base pública =================
  console.log('--- Base pública ---')

  const original = process.env.NEXT_PUBLIC_APP_URL

  /* O `.env` de produção tem barra no fim (`https://dominio.com/`). Sem
     normalizar, o link sairia com `//` — feio na mensagem e tratado como
     caminho diferente por alguma camada de cache. */
  process.env.NEXT_PUBLIC_APP_URL = 'https://lovehome.exemplo.com/'
  ok('barra final é removida da base', basePublica() === 'https://lovehome.exemplo.com', basePublica())
  ok('urlPublica não gera //', urlPublica('/cadastro/abc') === 'https://lovehome.exemplo.com/cadastro/abc', urlPublica('/cadastro/abc'))
  ok('urlPublica aceita caminho sem barra', urlPublica('imoveis/LH-1') === 'https://lovehome.exemplo.com/imoveis/LH-1')

  process.env.NEXT_PUBLIC_APP_URL = 'https://lovehome.exemplo.com'
  ok('sem barra final também funciona', urlDoImovel('LH-1001') === 'https://lovehome.exemplo.com/imoveis/LH-1001', urlDoImovel('LH-1001'))
  ok('a página do imóvel usa /imoveis/<código>, não /imovel/', urlDoImovel('LH-1001').includes('/imoveis/LH-1001'))

  process.env.NEXT_PUBLIC_APP_URL = original

  // ================= A tool entrega o link =================
  console.log('\n--- search_properties devolve link e foto ---')

  const resultado = (await handleSearchProperties({
    operation: 'venda',
    max_price_cents: 900_000_00,
  } as never)) as {
    imoveis?: { codigo: string; link?: string; foto_capa?: string | null; total_fotos?: number }[]
    instrucao_links?: string
  }

  const imoveis = resultado.imoveis ?? []
  ok('a busca devolveu imóveis do seed', imoveis.length > 0, `${imoveis.length}`)
  ok(
    'todo imóvel vem com link',
    imoveis.every((i) => typeof i.link === 'string' && i.link.length > 0),
    imoveis.filter((i) => !i.link).map((i) => i.codigo).join(', ')
  )
  ok(
    'o link é a página pública do próprio imóvel',
    imoveis.every((i) => i.link === urlDoImovel(i.codigo)),
    imoveis[0]?.link ?? ''
  )
  ok('nenhum link com // depois do domínio', imoveis.every((i) => !/[^:]\/\//.test(i.link ?? '')))
  ok('a resposta traz a instrução de uso dos links', typeof resultado.instrucao_links === 'string' && /EXATAMENTE/.test(resultado.instrucao_links))
  /* O seed não cria fotos — todos os 24 imóveis nascem com `photos: []`. Então
     a asserção é condicional: quem tem foto precisa vir com a capa; quem não
     tem precisa vir com total_fotos = 0 e foto_capa null (é o que faz o agente
     dizer "ainda não tem fotos" em vez de "não consigo mostrar"). */
  const comFoto = imoveis.filter((i) => (i.total_fotos ?? 0) > 0)
  if (comFoto.length) {
    ok('imóvel com foto vem com foto_capa', comFoto.every((i) => typeof i.foto_capa === 'string' && i.foto_capa.startsWith('http')))
  } else {
    console.log('INFO  nenhum imóvel com foto no banco — a capa não pode ser testada; conferindo o caso vazio')
  }
  ok('imóvel sem foto vem com total_fotos = 0 e foto_capa null', imoveis.filter((i) => !(i.total_fotos ?? 0)).every((i) => i.foto_capa === null))
  ok('a instrução distingue "sem foto cadastrada" de "não consigo mostrar"', /total_fotos/.test(resultado.instrucao_links ?? ''))

  // ================= O guarda remove link inventado =================
  console.log('\n--- removerLinksInventados ---')

  const linkReal = urlDoImovel('LH-1001')
  const fontes = [JSON.stringify({ imoveis: [{ codigo: 'LH-1001', link: linkReal }] })]

  const inventado = removerLinksInventados(
    `Aqui está o link do imóvel:\nhttps://www.lovehome.com.br/imovel/LH-1001\n\nSe quiser agendar, me avise!`,
    fontes
  )
  ok('URL que não veio de tool é removida', !inventado.texto.includes('lovehome.com.br'), inventado.texto)
  ok('e fica registrada para o log', inventado.removidos.length === 1 && inventado.removidos[0].includes('lovehome.com.br'))
  ok('o resto da mensagem sobrevive', inventado.texto.includes('Se quiser agendar'))

  const legitimo = removerLinksInventados(`Aqui está: ${linkReal}\n\nQuer marcar visita?`, fontes)
  ok('URL vinda da tool é preservada', legitimo.texto.includes(linkReal) && legitimo.removidos.length === 0)

  const comPontuacao = removerLinksInventados(`Veja em ${linkReal}. Depois me conta!`, fontes)
  ok('pontuação colada ao link não faz o link parecer inventado', comPontuacao.removidos.length === 0, comPontuacao.texto)

  const misto = removerLinksInventados(`Opção A: ${linkReal}\nOpção B: https://outro-site.com/x`, fontes)
  ok('numa mensagem mista, só a inventada sai', misto.texto.includes(linkReal) && !misto.texto.includes('outro-site'))

  const cadastro = removerLinksInventados(
    'Preciso do seu cadastro: https://lovehome.exemplo.com/cadastro/tok123',
    ['https://lovehome.exemplo.com/cadastro/tok123']
  )
  ok('o link de cadastro gerado pelo sistema passa', cadastro.removidos.length === 0)

  const semLink = removerLinksInventados('Tudo certo, sem links aqui.', fontes)
  ok('mensagem sem URL sai intacta', semLink.texto === 'Tudo certo, sem links aqui.')

  console.log('\nConcluído.')
}

main().catch((e) => {
  console.error('erro:', e.message ?? e)
  process.exit(1)
})

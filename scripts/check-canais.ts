import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import { lerConfigParaTela, salvarConfigCanal } from '../lib/channels/salvar-config'
import { getChannelCredentials, invalidateChannelCache } from '../lib/channels/config'
import { cadastrarSite, listarSites, removerSite, alternarSite, normalizarOrigem } from '../lib/channels/sites'
import { testarCanal } from '../lib/channels/testar'

/* Tela de Canais. Rodar com: npm run check:canais
   (o servidor de dev precisa estar no ar para a checagem HTTP)

   NÃO chama a OpenAI. CHAMA O Z-API (só o endpoint de status, não envia nada).

   O que está sendo protegido:
   1. Que a chave gravada pela tela NÃO fique legível no banco e NÃO volte para
      o navegador.
   2. Que cadastrar um site realmente autorize aquela origem no widget — e só
      aquela. Uma tela que parece cadastrar e não libera o CORS faria alguém
      passar horas depurando o site do cliente. */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const supabase = createAdminClient()

const ORIGEM_TESTE = 'https://parceiro-teste-lovehome.example'
const criados: string[] = []

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

async function limpar() {
  for (const id of criados) {
    const { error } = await supabase.from('widget_sites').delete().eq('id', id)
    if (error) throw new Error(`limpeza do site falhou: ${error.message}`)
  }
  criados.length = 0

  const { data: sobras } = await supabase
    .from('widget_sites')
    .select('id')
    .ilike('origin', '%parceiro-teste-lovehome%')
  for (const s of sobras ?? []) await supabase.from('widget_sites').delete().eq('id', s.id)
}

async function main() {
  await limpar()

  // ================= Normalização de origem =================
  console.log('--- Endereço digitado ---')

  /* Quem cadastra cola a URL da página, não a origem. Guardar cru faria o CORS
     recusar um site que a pessoa jura ter cadastrado. */
  ok('tira o caminho', normalizarOrigem('https://site.com.br/imoveis/') === 'https://site.com.br')
  ok('aceita sem esquema', normalizarOrigem('site.com.br') === 'https://site.com.br')
  ok('tira o /* do fim', normalizarOrigem('https://site.com.br/*') === 'https://site.com.br')
  ok('mantém a porta', normalizarOrigem('http://localhost:3000') === 'http://localhost:3000')
  ok('normaliza maiúsculas', normalizarOrigem('HTTPS://Site.COM.BR') === 'https://site.com.br')
  ok('recusa lixo', normalizarOrigem('   ') === null)

  // ================= Cadastro de site =================
  console.log('\n--- Sites autorizados ---')

  const cadastro = await cadastrarSite({ origem: `${ORIGEM_TESTE}/pagina`, nome: 'Parceiro', email: 'admin@teste.local' })
  ok('cadastra o site', cadastro.ok === true, JSON.stringify(cadastro))
  const siteId = cadastro.ok ? cadastro.siteId! : ''
  ok('gera um site_id', siteId.length >= 12, `${siteId.length} chars`)

  const lista = await listarSites()
  const site = lista.find((s) => s.site_id === siteId)
  if (site) criados.push(site.id)
  ok('guarda a origem normalizada, não o que foi digitado', site?.origin === ORIGEM_TESTE, site?.origin ?? '')

  const repetido = await cadastrarSite({ origem: ORIGEM_TESTE, email: 'admin@teste.local' })
  ok('não cadastra a mesma origem duas vezes', !repetido.ok && repetido.status === 409)

  // ================= O cadastro libera o CORS de verdade =================
  console.log('\n--- O widget aceita a origem cadastrada ---')

  async function tentarSessao(origem: string, site?: string) {
    const r = await fetch(`${BASE}/api/widget/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origem },
      body: JSON.stringify({ siteId: site }),
    })
    const corpo = await r.json().catch(() => ({}))
    if (corpo.sessionToken) {
      await supabase.from('widget_sessions').delete().eq('session_token', corpo.sessionToken)
    }
    return r.status
  }

  /* A prova de que a tela faz algo: antes do cadastro esta origem era recusada
     (é o que o check:widget verifica com outra origem). Agora tem que passar. */
  ok('origem cadastrada passa', (await tentarSessao(ORIGEM_TESTE, siteId)) === 200)

  /* E só ela: o site_id certo com origem de outro domínio continua barrado,
     senão vazar o site_id daria acesso a qualquer página. */
  ok(
    'site_id certo com origem errada é recusado',
    (await tentarSessao('https://outro-dominio-qualquer.example', siteId)) === 403
  )
  ok('origem certa sem site_id é recusada', (await tentarSessao(ORIGEM_TESTE)) === 403)

  await alternarSite(site!.id, false, 'admin@teste.local')
  /* Desativar precisa cortar o acesso na hora — é o botão de emergência de
     quando um parceiro sai. */
  ok('site desativado deixa de passar', (await tentarSessao(ORIGEM_TESTE, siteId)) === 403)
  await alternarSite(site!.id, true, 'admin@teste.local')
  ok('e reativar volta a passar', (await tentarSessao(ORIGEM_TESTE, siteId)) === 200)

  // ================= Credencial não vaza =================
  console.log('\n--- Credencial gravada pela tela ---')

  const { data: antes } = await supabase
    .from('channel_configs')
    .select('*')
    .eq('channel', 'zapi')
    .maybeSingle()

  const SEGREDO = 'token-de-teste-canais-' + Date.now()
  await salvarConfigCanal('zapi', { clientToken: SEGREDO }, undefined)

  const { data: linha } = await supabase
    .from('channel_configs')
    .select('*')
    .eq('channel', 'zapi')
    .single()

  ok('a chave NÃO fica legível no banco', !JSON.stringify(linha).includes(SEGREDO))

  const naTela = await lerConfigParaTela('zapi')
  ok('e NÃO volta para a tela', !JSON.stringify(naTela).includes(SEGREDO))
  ok('a tela só mostra os últimos 4', naTela.segredos.clientToken.mascara.endsWith(SEGREDO.slice(-4)), naTela.segredos.clientToken.mascara)
  ok('o servidor decifra', (await getChannelCredentials('zapi')).clientToken === SEGREDO)

  /* Restaura o estado anterior: este canal está configurado de verdade e o
     teste não pode deixá-lo com um token inventado. */
  if (antes?.client_token_encrypted) {
    await supabase
      .from('channel_configs')
      .update({ client_token_encrypted: antes.client_token_encrypted })
      .eq('channel', 'zapi')
  } else {
    await supabase.from('channel_configs').delete().eq('channel', 'zapi')
  }
  invalidateChannelCache()

  const restaurado = await getChannelCredentials('zapi')
  ok('o estado anterior do canal foi restaurado', restaurado.clientToken !== SEGREDO)

  // ================= Teste de conexão =================
  console.log('\n--- Teste de conexão ---')

  const zapi = await testarCanal('zapi')
  console.log(`INFO  zapi: ${zapi.ok ? 'ok' : 'falhou'} — ${zapi.mensagem}`)
  ok('o teste do zapi responde algo utilizável', typeof zapi.mensagem === 'string' && zapi.mensagem.length > 5)
  /* O retorno vai para o navegador. Se um segredo escapar aqui, ele aparece no
     DevTools de quem abrir a tela. */
  const zapiBruto = JSON.stringify(zapi)
  ok(
    'e NÃO carrega credencial nenhuma',
    !zapiBruto.includes(process.env.ZAPI_TOKEN ?? '@@vazio@@') &&
      !zapiBruto.includes(process.env.ZAPI_CLIENT_TOKEN ?? '@@vazio@@')
  )

  const meta = await testarCanal('meta')
  ok('meta sem credencial diz o que falta', !meta.ok && /falta/i.test(meta.mensagem), meta.mensagem)

  const widget = await testarCanal('widget')
  ok('widget explica que não usa credencial', widget.ok === true)

  // ================= Rotas =================
  console.log('\n--- Rotas ---')

  const salvarSemSessao = await fetch(`${BASE}/api/admin/canais/zapi`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientToken: 'invasor' }),
  })
  ok('salvar credencial exige sessão', salvarSemSessao.status === 401, `status ${salvarSemSessao.status}`)

  const testarSemSessao = await fetch(`${BASE}/api/admin/canais/zapi`, { method: 'POST' })
  ok('testar conexão exige sessão', testarSemSessao.status === 401)

  const siteSemSessao = await fetch(`${BASE}/api/admin/canais/sites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origem: 'https://invasor.example' }),
  })
  ok('autorizar site exige sessão', siteSemSessao.status === 401)

  const { data: naoCriou } = await supabase
    .from('widget_sites')
    .select('id')
    .eq('origin', 'https://invasor.example')
    .maybeSingle()
  ok('e a tentativa não cadastrou nada', !naoCriou)

  // ================= Remoção =================
  console.log('\n--- Remoção ---')

  await removerSite(site!.id, 'admin@teste.local')
  criados.splice(criados.indexOf(site!.id), 1)
  ok('remover corta o acesso', (await tentarSessao(ORIGEM_TESTE, siteId)) === 403)

  await limpar()
  console.log('\nDados de teste removidos.')
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})

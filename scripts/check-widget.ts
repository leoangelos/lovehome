import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'

/* Widget web — as pontas HTTP do canal. Rodar com: npm run check:widget
   (o servidor de dev precisa estar no ar)

   CHAMA A OPENAI uma vez, no fim: só o ida-e-volta completo prova que a rota
   costura sessão, identidade, pipeline e fila de resposta.

   O que está sendo protegido: estas são as ÚNICAS rotas do sistema que aceitam
   requisição anônima E gastam dinheiro. Webhook tem segredo, painel tem sessão,
   formulário tem token de uso único. Aqui o que existe no lugar é origem
   registrada, limite de uso e token gerado no servidor — e é isso que este
   script verifica. */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const ORIGEM_OK = 'http://localhost:3000'
const ORIGEM_ESTRANHA = 'https://site-de-terceiro.example'
const supabase = createAdminClient()

const tokens: string[] = []

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

async function limpar() {
  for (const t of tokens) {
    const { data: sessao } = await supabase
      .from('widget_sessions')
      .select('contact_id')
      .eq('session_token', t)
      .maybeSingle()

    await supabase.from('widget_sessions').delete().eq('session_token', t)

    if (sessao?.contact_id) {
      const { error } = await supabase.from('contacts').delete().eq('id', sessao.contact_id)
      if (error) throw new Error(`limpeza do contato falhou: ${error.message}`)
    }
    await supabase.from('contact_identities').delete().eq('external_id', t)
  }
  tokens.length = 0
}

function cabecalhos(origem: string | null, ip?: string) {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (origem) h.Origin = origem
  if (ip) h['x-forwarded-for'] = ip
  return h
}

async function abrirSessao(origem: string | null, corpo: Record<string, unknown> = {}, ip?: string) {
  const r = await fetch(`${BASE}/api/widget/session`, {
    method: 'POST',
    headers: cabecalhos(origem, ip),
    body: JSON.stringify(corpo),
  })
  const dados = await r.json().catch(() => ({}))
  if (dados.sessionToken) tokens.push(dados.sessionToken)
  return { status: r.status, dados, headers: r.headers }
}

async function main() {
  await limpar()

  // ================= Origem =================
  console.log('--- Origem ---')

  const semOrigem = await abrirSessao(null)
  ok('requisição sem Origin é recusada', semOrigem.status === 403, `status ${semOrigem.status}`)

  /* Site não cadastrado em `widget_sites`. Se isto virar 200, qualquer página
     da web passa a abrir conversa — e a conta da OpenAI é nossa. */
  const estranha = await abrirSessao(ORIGEM_ESTRANHA)
  ok('origem não registrada é recusada', estranha.status === 403, `status ${estranha.status}`)
  ok(
    'resposta a origem recusada NÃO traz cabeçalho de CORS',
    !estranha.headers.get('access-control-allow-origin'),
    estranha.headers.get('access-control-allow-origin') ?? ''
  )

  const preflight = await fetch(`${BASE}/api/widget/message`, {
    method: 'OPTIONS',
    headers: { Origin: ORIGEM_OK },
  })
  ok('preflight de origem válida passa', preflight.status === 204, `status ${preflight.status}`)
  ok(
    'preflight devolve a origem específica, não "*"',
    preflight.headers.get('access-control-allow-origin') === ORIGEM_OK,
    preflight.headers.get('access-control-allow-origin') ?? ''
  )

  // ================= Token =================
  console.log('\n--- Token de sessão ---')

  const nova = await abrirSessao(ORIGEM_OK, { landingUrl: `${BASE}/imoveis` })
  ok('abre sessão', nova.status === 200 && Boolean(nova.dados.sessionToken))
  ok('token é longo o bastante para não ser adivinhado', (nova.dados.sessionToken ?? '').length >= 32, `${(nova.dados.sessionToken ?? '').length} chars`)

  const token = nova.dados.sessionToken as string

  const retomada = await abrirSessao(ORIGEM_OK, { sessionToken: token })
  ok('token conhecido retoma a mesma sessão', retomada.dados.sessionToken === token && retomada.dados.retomada === true)

  /* A assertiva que mais importa deste bloco: o cliente NÃO escolhe o próprio
     identificador. Se escolhesse, escolheria o de outra pessoa — e o histórico
     do widget tem região, faixa de preço e às vezes nome. */
  const inventado = 'token-escolhido-pelo-cliente-123456789'
  const forjada = await abrirSessao(ORIGEM_OK, { sessionToken: inventado })
  ok('token inventado pelo cliente NÃO é aceito', forjada.dados.sessionToken !== inventado, String(forjada.dados.sessionToken).slice(0, 20))
  ok('e uma sessão nova é criada no lugar', forjada.status === 200 && forjada.dados.retomada === false)

  const { data: existe } = await supabase
    .from('widget_sessions')
    .select('id')
    .eq('session_token', inventado)
    .maybeSingle()
  ok('o token inventado não existe no banco', !existe)

  // ================= Mensagem: validações =================
  console.log('\n--- Mensagem ---')

  async function mandar(corpo: Record<string, unknown>, origem = ORIGEM_OK) {
    const r = await fetch(`${BASE}/api/widget/message`, {
      method: 'POST',
      headers: cabecalhos(origem),
      body: JSON.stringify(corpo),
    })
    return { status: r.status, dados: await r.json().catch(() => ({})) }
  }

  const semSessao = await mandar({ texto: 'oi' })
  ok('mensagem sem sessão é recusada', semSessao.status === 400, `status ${semSessao.status}`)

  /* Sessão desconhecida precisa dar 404, e não criar uma na hora: criar aqui
     devolveria ao cliente a escolha do token pela porta dos fundos. */
  const sessaoFantasma = await mandar({ sessionToken: 'nao-existe-em-lugar-nenhum', texto: 'oi' })
  ok('sessão desconhecida é 404, não cria outra', sessaoFantasma.status === 404, `status ${sessaoFantasma.status}`)

  const vazia = await mandar({ sessionToken: token, texto: '   ' })
  ok('mensagem vazia é recusada', vazia.status === 400)

  const enorme = await mandar({ sessionToken: token, texto: 'a'.repeat(5000) })
  ok('mensagem longa demais é recusada', enorme.status === 400, `status ${enorme.status}`)

  const deOutraOrigem = await mandar({ sessionToken: token, texto: 'oi' }, ORIGEM_ESTRANHA)
  ok('mensagem de origem não registrada é recusada', deOutraOrigem.status === 403)

  // ================= Identificação =================
  console.log('\n--- Identificação antes do chat ---')

  const semIdentificar = await mandar({ sessionToken: token, texto: 'oi, quero alugar' })
  /* 428, e não 403: é um sinal acionável — o widget volta a mostrar o
     formulário em vez de repetir um erro que a pessoa não pode resolver. */
  ok('mensagem antes de identificar é recusada', semIdentificar.status === 428, `status ${semIdentificar.status}`)
  ok('e o widget é avisado do que fazer', semIdentificar.dados.precisa_identificar === true)

  async function identificar(corpo: Record<string, unknown>, origem = ORIGEM_OK) {
    const r = await fetch(`${BASE}/api/widget/identify`, {
      method: 'POST',
      headers: cabecalhos(origem),
      body: JSON.stringify(corpo),
    })
    return { status: r.status, dados: await r.json().catch(() => ({})) }
  }

  const semNome = await identificar({ sessionToken: token, nome: 'A', telefone: '11999998888' })
  ok('nome de uma letra é recusado', semNome.status === 400)

  const foneCurto = await identificar({ sessionToken: token, nome: 'Ana Teste', telefone: '99998888' })
  ok('telefone sem DDD é recusado', foneCurto.status === 400, JSON.stringify(foneCurto.dados))

  const identificarDeFora = await identificar(
    { sessionToken: token, nome: 'Ana Teste', telefone: '11999998888' },
    ORIGEM_ESTRANHA
  )
  ok('identificar de origem não registrada é recusado', identificarDeFora.status === 403)

  const identificou = await identificar({
    sessionToken: token,
    nome: 'Ana Teste Widget',
    telefone: '(11) 97700-1234',
  })
  ok('identifica com nome e telefone', identificou.status === 200, JSON.stringify(identificou.dados))
  ok('devolve só o primeiro nome', identificou.dados.primeiroNome === 'Ana', String(identificou.dados.primeiroNome))
  /* O navegador não precisa do telefone normalizado nem do id do contato — o
     que não sai não vaza. */
  ok('e NÃO devolve telefone nem id de contato', !JSON.stringify(identificou.dados).includes('5511977001234'))

  const { data: sessaoIdentificada } = await supabase
    .from('widget_sessions')
    .select('contact_id, visitor_name, visitor_phone')
    .eq('session_token', token)
    .single()

  ok('a sessão ficou vinculada a um contato', Boolean(sessaoIdentificada?.contact_id))
  ok('guardou o nome', sessaoIdentificada?.visitor_name === 'Ana Teste Widget')
  /* Sem "+", assume Brasil: 55 na frente. É o que faz o número casar com o
     WhatsApp da mesma pessoa. */
  ok('normalizou o telefone com DDI', sessaoIdentificada?.visitor_phone === '5511977001234', sessaoIdentificada?.visitor_phone ?? '')

  // ---- a unificação com o WhatsApp ----
  const { data: contatoDoWidget } = await supabase
    .from('contacts')
    .select('id, phone_key, name')
    .eq('id', sessaoIdentificada!.contact_id!)
    .single()

  /* O ponto inteiro do formulário: `phone_key` é a chave que une o visitante do
     site ao contato do WhatsApp dele. Sem telefone, nasceriam dois contatos com
     memórias de agente separadas. */
  ok('o contato tem phone_key', contatoDoWidget?.phone_key === '77001234', contatoDoWidget?.phone_key ?? '')

  const retomadaIdentificada = await abrirSessao(ORIGEM_OK, { sessionToken: token })
  ok('retomar a sessão informa que já está identificado', retomadaIdentificada.dados.identificado === true)
  ok('e devolve o primeiro nome para cumprimentar', retomadaIdentificada.dados.primeiroNome === 'Ana')

  // ================= Poll =================
  console.log('\n--- Sondagem ---')

  const pollFantasma = await fetch(
    `${BASE}/api/widget/poll?sessao=inexistente`,
    { headers: { Origin: ORIGEM_OK } }
  )
  /* 404 e não 200 com lista vazia: 200 transformaria o endpoint num jeito
     barato de sondar tokens em massa até acertar um. */
  ok('sondagem de token inexistente é 404', pollFantasma.status === 404, `status ${pollFantasma.status}`)

  const pollReal = await fetch(`${BASE}/api/widget/poll?sessao=${encodeURIComponent(token)}`, {
    headers: { Origin: ORIGEM_OK },
  })
  ok('sondagem de sessão real responde', pollReal.status === 200)

  // ================= Limite de uso =================
  console.log('\n--- Limite de uso ---')

  const ipFalso = '203.0.113.77'
  let bateuNoLimite = false
  for (let i = 0; i < 18; i++) {
    const r = await abrirSessao(ORIGEM_OK, {}, ipFalso)
    if (r.status === 429) {
      bateuNoLimite = true
      break
    }
  }
  ok('abrir sessão em série esbarra no limite por IP', bateuNoLimite)

  // ================= Ida e volta completa =================
  console.log('\n--- Conversa de verdade (CHAMA A OPENAI) ---')

  const conversa = await mandar({
    sessionToken: token,
    texto: 'Oi! Procuro apartamento de 2 quartos para alugar na Vila Mariana, até 4 mil.',
    currentUrl: `${BASE}/imoveis`,
  })

  ok('o widget respondeu', conversa.status === 200, `status ${conversa.status}`)
  const respostas = (conversa.dados.respostas ?? []) as { text: string }[]
  ok('veio ao menos uma resposta', respostas.length > 0)
  if (respostas.length) console.log(`\n> ${respostas[0].text}\n`)

  const { data: sessaoFinal } = await supabase
    .from('widget_sessions')
    .select('contact_id, current_url')
    .eq('session_token', token)
    .single()

  ok('a sessão continua amarrada ao mesmo contato', sessaoFinal?.contact_id === sessaoIdentificada?.contact_id)
  ok('registrou a página onde o visitante estava', Boolean(sessaoFinal?.current_url))

  const { count: gravadas } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('contact_id', sessaoFinal!.contact_id!)
  ok('pergunta e resposta ficaram no histórico', (gravadas ?? 0) >= 2, `${gravadas} mensagens`)

  await limpar()
  console.log('\nDados de teste removidos.')
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})

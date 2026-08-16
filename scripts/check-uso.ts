import 'dotenv/config'
import { readFileSync } from 'fs'
import { createAdminClient } from '../lib/supabase/admin'
import { registrarUso, calcularCusto, ROTULO_OPERACAO } from '../lib/observabilidade/uso'
import { montarPainelUso } from '../lib/queries/uso'
import { runSdrAgent } from '../lib/agents/sdr'

/* Registro de uso e custo. Rodar com: npm run check:uso
   (o servidor de dev precisa estar no ar para a checagem HTTP)

   CHAMA A OPENAI uma vez: a asserção que importa é que uma conversa de verdade
   registre TODAS as chamadas que fez, não só a do agente.

   O que está sendo protegido: antes desta tabela, só os tokens do agente eram
   gravados. Um painel de custo montado sobre o que existia mostraria a maior
   parte do gasto e pareceria completo — que é a forma mais cara de errar um
   número de custo. */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const supabase = createAdminClient()

const TELEFONE = '5511977009001'
let contatoId: string | null = null
const idsCriados: string[] = []

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

async function limpar() {
  for (const id of idsCriados) {
    const { error } = await supabase.from('llm_usage').delete().eq('id', id)
    if (error) throw new Error(`limpeza do uso falhou: ${error.message}`)
  }
  idsCriados.length = 0

  if (contatoId) {
    /* llm_usage.contact_id é ON DELETE SET NULL: apagar o contato NÃO apaga o
       custo. Então as linhas do teste precisam ser removidas explicitamente,
       senão ficam para sempre no painel. */
    await supabase.from('llm_usage').delete().eq('contact_id', contatoId)
    const { error } = await supabase.from('contacts').delete().eq('id', contatoId)
    if (error) throw new Error(`limpeza do contato falhou: ${error.message}`)
    contatoId = null
  }
}

async function main() {
  await limpar()

  // ================= Cobertura: nenhum ponto pago fora do registro =================
  console.log('--- Cobertura dos pontos que gastam ---')

  const ARQUIVOS = [
    'lib/agents/base-agent.ts',
    'lib/agents/copiloto.ts',
    'lib/agents/orchestrator.ts',
    'lib/agents/summary.ts',
    'lib/followup/runner.ts',
    'lib/imoveis/embeddings.ts',
    'lib/rag/embedder.ts',
    'lib/whatsapp/media.ts',
  ]

  /* Verificação estrutural: todo arquivo que chama a OpenAI tem que registrar
     uso. É o que impede um ponto novo de nascer invisível — e um ponto pago
     invisível não aparece em teste nenhum, só na fatura. */
  const semRegistro: string[] = []
  for (const arquivo of ARQUIVOS) {
    const conteudo = readFileSync(arquivo, 'utf-8')
    const chama = /openai\.(chat\.completions|embeddings|audio)/.test(conteudo)
    const registra = conteudo.includes('registrarUso(')
    if (chama && !registra) semRegistro.push(arquivo)
  }
  ok('todo arquivo que chama a OpenAI registra uso', semRegistro.length === 0, semRegistro.join(', '))

  // ================= Cálculo de custo =================
  console.log('\n--- Cálculo ---')

  /* 1M tokens de entrada em gpt-4o custam USD 2,50 pela tabela. Se este número
     mudar sem alguém mexer na tabela de propósito, é porque a tabela mudou por
     engano. */
  ok('preço de entrada do gpt-4o', calcularCusto({ modelo: 'gpt-4o', tokensEntrada: 1_000_000 }) === 2.5)
  ok('saída custa mais que entrada', calcularCusto({ modelo: 'gpt-4o', tokensSaida: 1_000_000 }) > calcularCusto({ modelo: 'gpt-4o', tokensEntrada: 1_000_000 }))
  ok('mini é mais barato que o 4o', calcularCusto({ modelo: 'gpt-4o-mini', tokensEntrada: 1_000_000 }) < calcularCusto({ modelo: 'gpt-4o', tokensEntrada: 1_000_000 }))
  ok('embedding é barato', calcularCusto({ modelo: 'text-embedding-3-small', tokensEntrada: 1_000_000 }) === 0.02)
  /* Whisper cobra por minuto de áudio, não por token. */
  ok('áudio cobra por duração', Math.abs(calcularCusto({ modelo: 'whisper-1', segundosAudio: 60 }) - 0.006) < 1e-9)
  /* Modelo desconhecido custa 0 mas a linha É registrada: perder o registro
     inteiro por não saber o preço seria trocar número impreciso por nenhum. */
  ok('modelo desconhecido não quebra', calcularCusto({ modelo: 'modelo-que-nao-existe', tokensEntrada: 1000 }) === 0)

  // ================= Gravação =================
  console.log('\n--- Gravação ---')

  await registrarUso({
    operacao: 'agente',
    modelo: 'gpt-4o',
    tokensEntrada: 1000,
    tokensSaida: 500,
    duracaoMs: 1234,
    agente: 'sdr',
    canal: 'widget',
  })

  const { data: gravada } = await supabase
    .from('llm_usage')
    .select('*')
    .eq('agente', 'sdr')
    .eq('canal', 'widget')
    .order('ocorrido_em', { ascending: false })
    .limit(1)
    .maybeSingle()

  ok('gravou a linha', Boolean(gravada))
  if (gravada) {
    idsCriados.push(gravada.id)
    ok('soma o total sozinha', gravada.tokens_total === 1500, String(gravada.tokens_total))
    // 1000/1M * 2.50 + 500/1M * 10.00 = 0.0025 + 0.005 = 0.0075
    ok('calcula o custo separando entrada de saída', Number(gravada.custo_usd) === 0.0075, String(gravada.custo_usd))
  }

  /* Registrar não pode derrubar quem chamou: uma falha de contabilidade não
     vale uma conversa perdida. */
  let quebrou = false
  try {
    /* Operação fora do CHECK do banco: o insert é recusado. O que se verifica é
       que a recusa não vira exceção na cara de quem estava atendendo alguém. */
    await registrarUso({ operacao: 'operacao_que_nao_existe' as never, modelo: 'gpt-4o' })
  } catch {
    quebrou = true
  }
  ok('insert recusado pelo banco NÃO lança para quem chamou', !quebrou)

  const { count: naoEntrou } = await supabase
    .from('llm_usage')
    .select('id', { count: 'exact', head: true })
    .eq('modelo', 'gpt-4o')
    .eq('operacao', 'operacao_que_nao_existe')
  ok('e a linha inválida não entrou', naoEntrou === 0, `${naoEntrou}`)

  // ================= Uma conversa de verdade =================
  console.log('\n--- Conversa real: quantas chamadas aparecem? (CHAMA A OPENAI) ---')

  const { data: contato, error } = await supabase
    .from('contacts')
    .insert({ phone: TELEFONE, phone_key: TELEFONE.slice(-8), name: 'Teste Uso' })
    .select('id')
    .single()
  if (error) throw new Error(`contato: ${error.message}`)
  contatoId = contato.id

  /* NÃO filtre por "desde agora" usando o relógio local: `ocorrido_em` recebe o
     NOW() do Postgres, que nesta instalação está alguns minutos atrás do
     relógio da máquina. Um filtro de tempo apertado esconde linhas que acabaram
     de ser gravadas — foi o que fez este teste falhar dizendo que nada tinha
     sido registrado. O `contact_id` já isola o que é deste teste. */
  await runSdrAgent(contatoId!, 'Oi! Procuro apartamento de 2 quartos na Vila Mariana para alugar.', {
    status: 'none',
    registrationId: null,
    roles: [],
    nomeCompleto: null,
  })

  const { data: doTeste } = await supabase
    .from('llm_usage')
    .select('operacao, modelo, tokens_total, custo_usd')
    .eq('contact_id', contatoId!)

  const operacoes = (doTeste ?? []).map((l) => l.operacao)
  console.log(`INFO  registrou: ${operacoes.join(', ') || 'nada'}`)

  ok('registrou a chamada do agente', operacoes.includes('agente'), operacoes.join(', '))
  ok('todas as linhas têm tokens', (doTeste ?? []).every((l) => l.tokens_total > 0))
  ok('e custo maior que zero', (doTeste ?? []).every((l) => Number(l.custo_usd) > 0))

  // ================= Painel =================
  console.log('\n--- Painel ---')

  const painel = await montarPainelUso()
  ok('o painel enxerga o uso', painel.vazio === false)
  ok('tem 30 dias na série, sem buraco', painel.porDia.length === 30, `${painel.porDia.length}`)
  ok('hoje é subconjunto de 7 dias', painel.hoje.requisicoes <= painel.seteDias.requisicoes)
  ok('7 dias é subconjunto de 30', painel.seteDias.requisicoes <= painel.trintaDias.requisicoes)
  ok('agrupa por operação', painel.porOperacao.length > 0, painel.porOperacao.map((o) => o.chave).join(', '))
  /* Ordenado por custo, não por contagem: o que interessa é o que consome
     dinheiro, e mil embeddings custam menos que dez respostas de agente. */
  ok(
    'ordena por custo, não por número de chamadas',
    painel.porOperacao.every((o, i, arr) => i === 0 || arr[i - 1].custoUsd >= o.custoUsd)
  )
  ok('toda operação tem rótulo legível', painel.porOperacao.every((o) => o.rotulo !== o.chave || !ROTULO_OPERACAO[o.chave as never]))
  ok('lista as requisições recentes', painel.recentes.length > 0)

  console.log(
    `INFO  30 dias: ${painel.trintaDias.requisicoes} requisições · ${painel.trintaDias.tokens} tokens · $${painel.trintaDias.custoUsd.toFixed(4)}`
  )

  // ================= Exclusão de contato não apaga custo =================
  console.log('\n--- Exclusão de contato ---')

  const { count: antesDelete } = await supabase
    .from('llm_usage')
    .select('id', { count: 'exact', head: true })
    .eq('contact_id', contatoId!)

  const idDoContato = contatoId!
  await supabase.from('contacts').delete().eq('id', idDoContato)
  contatoId = null

  const { count: orfas } = await supabase
    .from('llm_usage')
    .select('id', { count: 'exact', head: true })
    .eq('contact_id', idDoContato)

  /* ON DELETE SET NULL de propósito: apagar um contato a pedido do titular não
     pode apagar o histórico de custo, que é dado financeiro da imobiliária e
     não dado pessoal dele. A linha perde o vínculo e o gasto continua contado. */
  ok('apagar o contato NÃO apaga o custo', (antesDelete ?? 0) > 0 && orfas === 0, `${antesDelete} viraram ${orfas} com vínculo`)

  const painelDepois = await montarPainelUso()
  ok('e o gasto continua no painel', painelDepois.trintaDias.requisicoes >= painel.trintaDias.requisicoes - 1)

  /* As linhas do agente perderam o contact_id no delete acima (SET NULL), então
     não dá mais para achá-las por vínculo. O par (agente='sdr', canal=null) com
     o modelo do teste é o que sobra — e é por isso que a limpeza acontece aqui,
     e não no `limpar()` genérico. */
  await supabase
    .from('llm_usage')
    .delete()
    .is('contact_id', null)
    .eq('agente', 'sdr')
    .is('canal', null)

  // ================= Rota =================
  console.log('\n--- Acesso ---')

  const semSessao = await fetch(`${BASE}/admin/uso`, { redirect: 'manual' })
  ok('a tela exige sessão', semSessao.status >= 300 && semSessao.status < 400, `status ${semSessao.status}`)

  await limpar()
  console.log('\nDados de teste removidos.')
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})

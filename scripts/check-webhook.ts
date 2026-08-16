import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'

/* Simula o Z-API entregando uma rajada de mensagens no webhook e confere o que
   o sistema fez com elas. Rodar com: npm run check:webhook
   (o servidor de dev precisa estar no ar em NEXT_PUBLIC_APP_URL)

   CHAMA A OPENAI — o pipeline roda de verdade no fim da janela de debounce.

   O envio da resposta pelo Z-API vai falhar enquanto ZAPI_INSTANCE/ZAPI_TOKEN
   estiverem vazios. Isso e esperado: o teste cobre da entrada ate a
   persistencia, que e o que existe hoje. */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const TELEFONE = '5511977001234' // fora do prefixo do seed, e um contato proprio
const supabase = createAdminClient()

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

function payload(messageId: string, texto: string) {
  return {
    phone: TELEFONE,
    instanceId: 'teste',
    messageId,
    fromMe: false,
    momment: new Date().toISOString(),
    status: 'RECEIVED',
    chatName: 'Teste Webhook',
    senderPhoto: '',
    senderName: 'Teste Webhook',
    participantPhone: null,
    isGroup: false,
    isNewsletter: false,
    text: { message: texto },
  }
}

async function postar(corpo: unknown) {
  const r = await fetch(`${BASE}/api/webhook/zapi`, {
    method: 'POST',
    /* O webhook exige o segredo — sem ele responde 403/401 antes de ler o corpo.
       Vem do mesmo lugar que a rota lê: ZAPI_WEBHOOK_SECRET (ou a tela de Canais). */
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-token': process.env.ZAPI_WEBHOOK_SECRET ?? '',
    },
    body: JSON.stringify(corpo),
  })
  return { status: r.status, corpo: await r.json() }
}

async function limpar() {
  const { data } = await supabase.from('contacts').select('id').eq('phone', TELEFONE)
  for (const c of data ?? []) {
    /* Checar o erro do delete não é zelo excessivo: o supabase-js devolve a
       falha no retorno em vez de lançar, e foi assim que uma violação de FK
       passou despercebida — a limpeza "funcionava" e os dados de teste iam
       se acumulando entre execuções, mascarando o resultado. */
    const { error } = await supabase.from('contacts').delete().eq('id', c.id)
    if (error) throw new Error(`limpeza falhou para ${c.id}: ${error.message}`)
  }
}

async function main() {
  // ---- A trava do webhook: sem segredo, nada passa ----
  console.log('--- Autenticação do webhook ---')
  const semSegredo = await fetch(`${BASE}/api/webhook/zapi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'ReceivedCallback', phone: '5511900000000', text: { message: 'oi' } }),
  })
  /* 401 (segredo configurado, token errado) ou 403 (nada configurado). Nunca
     200: 200 aqui significa que qualquer um na internet fala pelo WhatsApp da
     imobiliária. */
  ok('POST sem o segredo é recusado', semSegredo.status === 401 || semSegredo.status === 403, `status ${semSegredo.status}`)
  const errado = await fetch(`${BASE}/api/webhook/zapi?token=errado`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'ReceivedCallback', phone: '5511900000000', text: { message: 'oi' } }),
  })
  ok('POST com segredo errado é recusado', errado.status === 401 || errado.status === 403, `status ${errado.status}`)
  await limpar()
  const carimbo = Date.now()

  // ---- Payloads que não são atendimento ----
  const grupo = await postar({ ...payload(`g-${carimbo}`, 'oi'), isGroup: true })
  ok('mensagem de grupo ignorada', grupo.corpo.status === 'ignorado', JSON.stringify(grupo.corpo))

  const propria = await postar({ ...payload(`m-${carimbo}`, 'oi'), fromMe: true })
  ok('mensagem própria ignorada', propria.corpo.status === 'ignorado')

  // ---- Rajada de 3 mensagens ----
  const inicio = Date.now()
  const r1 = await postar(payload(`a-${carimbo}`, 'Oi, boa tarde!'))
  const r2 = await postar(payload(`b-${carimbo}`, 'Queria alugar um apartamento'))
  const r3 = await postar(payload(`c-${carimbo}`, 'na Vila Mariana, até 3.500'))
  const latencia = Date.now() - inicio

  ok('webhook respondeu 200', [r1, r2, r3].every((r) => r.status === 200))
  ok('todas enfileiradas', [r1, r2, r3].every((r) => r.corpo.status === 'enfileirado'))
  ok(
    'só a primeira abriu a janela de debounce',
    r1.corpo.primeiro === true && r2.corpo.primeiro === false && r3.corpo.primeiro === false,
    `${r1.corpo.primeiro}/${r2.corpo.primeiro}/${r3.corpo.primeiro}`
  )
  ok('webhook devolveu rápido, sem segurar a conexão', latencia < 8000, `${latencia}ms para 3 posts`)

  // ---- Dedup ----
  const repetida = await postar(payload(`a-${carimbo}`, 'Oi, boa tarde!'))
  ok('reentrega do mesmo messageId é descartada', repetida.corpo.status === 'duplicado')

  // ---- Estado imediato ----
  const { data: contato } = await supabase
    .from('contacts')
    .select('id, name, funnel_stage')
    .eq('phone', TELEFONE)
    .single()
  ok('contato criado a partir do telefone', Boolean(contato))

  const { count: msgsUsuario } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('contact_id', contato!.id)
    .eq('role', 'user')
  ok('as 3 mensagens do usuário foram gravadas', msgsUsuario === 3, `gravadas: ${msgsUsuario}`)

  const { count: respostasAgora } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('contact_id', contato!.id)
    .eq('role', 'assistant')
  ok('nenhuma resposta ainda — a janela está aberta', respostasAgora === 0)

  // ---- Espera a janela fechar (20s) + tempo do pipeline ----
  console.log('\nAguardando a janela de debounce (20s) + pipeline...')
  await dormir(45000)

  const { data: respostas } = await supabase
    .from('messages')
    .select('content, agent')
    .eq('contact_id', contato!.id)
    .eq('role', 'assistant')

  /* Sem credencial do Z-API o envio falha e o pipeline grava também a mensagem
     de fallback ("tive um probleminha técnico"). Ela é comportamento correto —
     silêncio seria pior —, mas não é a resposta do agente. A contagem que
     importa é a das respostas de agente. */
  const doAgente = (respostas ?? []).filter((r) => r.agent !== 'fallback')
  const houveFallback = (respostas ?? []).some((r) => r.agent === 'fallback')

  ok('respondeu UMA vez à rajada de 3', doAgente.length === 1, `${doAgente.length} respostas de agente`)
  if (houveFallback) {
    console.log('INFO  mensagem de fallback também gravada — esperado sem credencial do Z-API')
  }
  if (respostas?.length) {
    console.log(`\n> ${respostas[0].content}\n`)
    console.log(`INFO  agente: ${respostas[0].agent}`)
  }

  const { data: rota } = await supabase
    .from('routing_logs')
    .select('routed_to, input_message')
    .eq('contact_id', contato!.id)
    .maybeSingle()

  ok('roteamento registrado', Boolean(rota), rota?.routed_to ?? 'nenhum')
  if (rota) {
    const juntou = rota.input_message.includes('boa tarde') && rota.input_message.includes('Vila Mariana')
    ok('as 3 mensagens chegaram juntas ao agente', juntou, rota.input_message.replace(/\n/g, ' | '))
  }

  const { data: final } = await supabase
    .from('contacts')
    .select('funnel_stage, intent')
    .eq('id', contato!.id)
    .single()
  console.log(`INFO  contato: estágio=${final!.funnel_stage} intenção=${final!.intent}`)

  await limpar()
  console.log('\nContato de teste removido.')
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})

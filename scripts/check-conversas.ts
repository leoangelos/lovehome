import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import { listarConversas, buscarConversa } from '../lib/queries/conversas'
import { assumirConversa, devolverAoBot, responderComoHumano } from '../lib/conversas/takeover'
import { processMessage } from '../lib/pipeline/process-message'
import { loadAgentHistory } from '../lib/agents/base-agent'
import { drainWidgetReplies } from '../lib/channels/widget'
import type { Contact } from '../lib/types/domain'

/* Conversas e takeover humano. Rodar com: npm run check:conversas
   (o servidor de dev precisa estar no ar para a checagem HTTP)

   CHAMA A OPENAI uma vez, no fim, para produzir um trace de verdade. O caso
   central (o pipeline NÃO rodar agente com a conversa assumida) é gratuito
   justamente porque o certo é ele sair antes de chamar o modelo.

   A regra protegida aqui: não se responde sem assumir. O agente carrega o
   histórico dele de `agent_histories`, separado de `messages` — o que o humano
   escreve não entra no contexto do modelo. Bot ativo + humano respondendo é
   garantia de os dois se contradizerem na frente do cliente. */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const supabase = createAdminClient()

const TOKEN_WIDGET = 'teste-conversas-' + Date.now()
const TELEFONE_FORA = '5511977006001' // fora da WHATSAPP_ALLOWLIST de propósito

const criado = { contatos: [] as string[], brokers: [] as string[] }

/* `conversations.taken_by` e `human_takeover_logs.profile_id` referenciam
   auth.users — UUID inventado quebra a FK e o assumir volta 500. Precisa de
   usuário de verdade, criado e apagado aqui como no check:auth. */
const DOMINIO_TESTE = '@teste.lovehome.local'
let usuarioA = ''
let usuarioB = ''

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

async function limpar() {
  for (const id of criado.contatos) {
    const { error } = await supabase.from('contacts').delete().eq('id', id)
    if (error) throw new Error(`limpeza do contato falhou: ${error.message}`)
  }
  for (const id of criado.brokers) {
    const { error } = await supabase.from('brokers').delete().eq('id', id)
    if (error) throw new Error(`limpeza do corretor falhou: ${error.message}`)
  }
  criado.contatos.length = 0
  criado.brokers.length = 0

  const { data: usuarios } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  for (const u of usuarios?.users ?? []) {
    if (u.email?.endsWith(DOMINIO_TESTE)) {
      await supabase.from('brokers').delete().eq('profile_id', u.id)
      await supabase.auth.admin.deleteUser(u.id)
    }
  }
  usuarioA = ''
  usuarioB = ''

  const { data: sobras } = await supabase.from('brokers').select('id').ilike('name', '%Testeconversa%')
  for (const b of sobras ?? []) {
    const { data: cs } = await supabase.from('contacts').select('id').eq('assigned_broker_id', b.id)
    for (const c of cs ?? []) await supabase.from('contacts').delete().eq('id', c.id)
    await supabase.from('brokers').delete().eq('id', b.id)
  }
}

async function criarCorretor(nome: string) {
  const { data, error } = await supabase
    .from('brokers')
    .insert({ name: `${nome} Testeconversa`, specialty: 'geral', is_active: true })
    .select('id')
    .single()
  if (error) throw new Error(`corretor: ${error.message}`)
  criado.brokers.push(data.id)
  return data.id as string
}

async function criarConversa(params: {
  phone: string
  nome: string
  canal: 'zapi' | 'widget'
  brokerId?: string
}) {
  const { data: contato, error } = await supabase
    .from('contacts')
    .insert({
      phone: params.phone,
      phone_key: params.phone.slice(-8),
      name: params.nome,
      assigned_broker_id: params.brokerId ?? null,
      funnel_stage: 'qualificando',
    })
    .select('*')
    .single()
  if (error) throw new Error(`contato: ${error.message}`)
  criado.contatos.push(contato.id)

  const { data: conversa } = await supabase
    .from('conversations')
    .insert({ contact_id: contato.id, channel: params.canal, status: 'active' })
    .select('id')
    .single()

  await supabase.from('messages').insert({
    conversation_id: conversa!.id,
    contact_id: contato.id,
    role: 'user',
    content: 'Oi, ainda estou esperando uma resposta sobre o apartamento.',
    media_type: 'text',
    channel: params.canal,
  })

  return { contato: contato as Contact, conversaId: conversa!.id as string }
}

async function criarUsuario(prefixo: string): Promise<string> {
  const { data, error } = await supabase.auth.admin.createUser({
    email: `${prefixo}-conversas${DOMINIO_TESTE}`,
    password: 'senha-de-teste-12345',
    email_confirm: true,
    user_metadata: { full_name: `Teste ${prefixo}`, role: 'admin' },
  })
  if (error) throw new Error(`usuário ${prefixo}: ${error.message}`)
  return data.user!.id
}

async function main() {
  await limpar()

  usuarioA = await criarUsuario('ana')
  usuarioB = await criarUsuario('bruno')

  const corretorA = await criarCorretor('Ana')
  const corretorB = await criarCorretor('Bruno')

  const doA = await criarConversa({
    phone: TELEFONE_FORA,
    nome: 'Cliente do A',
    canal: 'zapi',
    brokerId: corretorA,
  })
  const doB = await criarConversa({
    phone: '5511977006002',
    nome: 'Cliente do B',
    canal: 'zapi',
    brokerId: corretorB,
  })

  // Conversa pelo widget, para exercitar o envio que funciona de verdade.
  const widget = await criarConversa({ phone: '5511977006003', nome: 'Visitante', canal: 'widget' })
  await supabase.from('widget_sessions').insert({
    session_token: TOKEN_WIDGET,
    contact_id: widget.contato.id,
  })

  // ================= Listagem =================
  console.log('--- Listagem ---')

  const todas = await listarConversas(null)
  const linhaA = todas.find((c) => c.id === doA.conversaId)

  ok('a conversa aparece na lista', Boolean(linhaA))
  ok('traz a última mensagem', Boolean(linhaA?.ultima_mensagem?.includes('esperando')), linhaA?.ultima_mensagem ?? '')
  /* É o que faz a tela servir para trabalhar: a última palavra foi do cliente,
     então alguém precisa responder. */
  ok('marca como esperando resposta', linhaA?.nao_respondida === true)

  const daCarteiraA = await listarConversas(corretorA)
  ok('corretor vê a própria conversa', daCarteiraA.some((c) => c.id === doA.conversaId))
  ok('e NÃO vê a do outro corretor', !daCarteiraA.some((c) => c.id === doB.conversaId), `${daCarteiraA.length} conversas`)

  // ================= Responder sem assumir =================
  console.log('--- A regra central ---')

  const semAssumir = await responderComoHumano({
    conversationId: widget.conversaId,
    userId: usuarioA,
    email: 'ana@teste.local',
    nome: 'Ana',
    texto: 'Oi, aqui é a Ana.',
  })
  ok('responder sem assumir é recusado', !semAssumir.ok && semAssumir.status === 409, JSON.stringify(semAssumir))

  const { count: nadaEnviado } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', widget.conversaId)
    .eq('role', 'assistant')
  ok('e nada foi gravado', nadaEnviado === 0, `${nadaEnviado}`)

  // ================= Assumir =================
  console.log('\n--- Assumir e responder ---')

  const assumiu = await assumirConversa({
    conversationId: widget.conversaId,
    userId: usuarioA,
    email: 'ana@teste.local',
  })
  ok('assumiu', assumiu.ok === true, JSON.stringify(assumiu))

  const outraPessoa = await assumirConversa({
    conversationId: widget.conversaId,
    userId: usuarioB,
    email: 'bruno@teste.local',
  })
  /* Duas pessoas na mesma conversa é pior que ninguém: o cliente recebe duas
     versões e nenhuma das duas sabe da outra. */
  ok('outra pessoa NÃO assume por cima', !outraPessoa.ok && outraPessoa.status === 409)

  const enviou = await responderComoHumano({
    conversationId: widget.conversaId,
    userId: usuarioA,
    email: 'ana@teste.local',
    nome: 'Ana',
    texto: 'Oi! Aqui é a Ana, da LoveHome. Vou te ajudar pessoalmente.',
  })
  ok('responde depois de assumir', enviou.ok === true, JSON.stringify(enviou))

  const { data: gravada } = await supabase
    .from('messages')
    .select('content, agent, role')
    .eq('conversation_id', widget.conversaId)
    .eq('role', 'assistant')
    .maybeSingle()
  ok('mensagem gravada', Boolean(gravada))
  /* `agent: 'humano'` é o que permite auditar depois quem prometeu o quê. */
  ok('marcada como escrita por pessoa, não por agente', gravada?.agent === 'humano', gravada?.agent ?? '')

  const naFila = await drainWidgetReplies(TOKEN_WIDGET)
  ok('chegou na fila do canal', naFila.some((m) => m.text.includes('Aqui é a Ana')), `${naFila.length}`)

  // ================= O bot cala =================
  console.log('\n--- O bot fica calado ---')

  const antes = await contarAssistente(widget.conversaId)
  await processMessage({
    channel: 'widget',
    replyAddress: TOKEN_WIDGET,
    message: 'E sobre a documentação, o que eu preciso levar?',
    contact: widget.contato,
    conversationId: widget.conversaId,
  })
  const depois = await contarAssistente(widget.conversaId)

  /* Se isto falhar, o agente respondeu por cima do atendente — que é o
     comportamento que o takeover existe para impedir. Também é a razão de este
     script não chamar a OpenAI: o certo é o pipeline sair antes. */
  ok('o agente NÃO respondeu com a conversa assumida', depois === antes, `${antes} -> ${depois}`)

  const semResposta = await drainWidgetReplies(TOKEN_WIDGET)
  ok('e nada foi para o canal', semResposta.length === 0, `${semResposta.length}`)

  // ================= Gravar antes de enviar =================
  console.log('\n--- Falha de envio não some com a mensagem ---')

  await assumirConversa({
    conversationId: doA.conversaId,
    userId: usuarioA,
    email: 'ana@teste.local',
  })

  /* O telefone está fora da WHATSAPP_ALLOWLIST, então o envio FALHA. É a
     situação real de canal fora do ar — e o registro tem que sobreviver a ela,
     senão o histórico fica sem sinal de que alguém tentou responder. */
  const falhou = await responderComoHumano({
    conversationId: doA.conversaId,
    userId: usuarioA,
    email: 'ana@teste.local',
    nome: 'Ana',
    texto: 'Mensagem que não vai conseguir sair.',
  })
  ok('envio impossível devolve erro', !falhou.ok && falhou.status === 502, JSON.stringify(falhou))

  const { data: mesmoAssim } = await supabase
    .from('messages')
    .select('content')
    .eq('conversation_id', doA.conversaId)
    .eq('role', 'assistant')
    .maybeSingle()
  ok('a mensagem ficou registrada mesmo assim', Boolean(mesmoAssim), mesmoAssim?.content ?? 'nada')

  // ================= Devolver =================
  console.log('\n--- Devolver ao bot ---')

  const devolveu = await devolverAoBot({
    conversationId: widget.conversaId,
    userId: usuarioA,
    email: 'ana@teste.local',
  })
  ok('devolveu', devolveu.ok === true)

  const detalhe = await buscarConversa(widget.conversaId)
  ok('takeover desligado', detalhe?.human_takeover === false)
  ok('e sem dono', detalhe?.taken_by === null)

  const { data: logs } = await supabase
    .from('human_takeover_logs')
    .select('action')
    .eq('conversation_id', widget.conversaId)
    .order('created_at')
  const acoes = (logs ?? []).map((l) => l.action)
  /* O rastro importa: quem assumiu, quando respondeu e quando devolveu. */
  ok('o rastro ficou registrado', acoes.includes('claim') && acoes.includes('message_sent') && acoes.includes('release'), acoes.join(', '))

  // ================= Memória é por contato, não por canal =================
  console.log('\n--- Histórico entre canais ---')

  /* A mesma pessoa falando pelo widget e pelo WhatsApp tem THREADS separadas no
     painel, mas UMA memória: `agent_histories` é chaveada por
     (contact_id, agent), sem canal. */
  const { data: outraThread } = await supabase
    .from('conversations')
    .insert({ contact_id: widget.contato.id, channel: 'zapi', status: 'active' })
    .select('id')
    .single()

  ok('mesma pessoa, thread separada por canal', outraThread!.id !== widget.conversaId)

  await supabase.from('agent_histories').upsert(
    {
      contact_id: widget.contato.id,
      agent: 'sdr',
      messages: [{ role: 'user', content: 'procuro 2 quartos na Vila Mariana' }],
    },
    { onConflict: 'contact_id,agent' }
  )

  const historico = await loadAgentHistory(widget.contato.id, 'sdr')
  /* Se isto passar a depender do canal, quem começa no site e continua no
     WhatsApp encontra um agente que esqueceu tudo. */
  ok(
    'a memória do agente segue a pessoa, não o canal',
    historico.some((m) => String(m.content).includes('Vila Mariana')),
    `${historico.length} mensagens`
  )

  const { count: historicos } = await supabase
    .from('agent_histories')
    .select('id', { count: 'exact', head: true })
    .eq('contact_id', widget.contato.id)
  ok('e é uma só, não uma por canal', historicos === 1, `${historicos}`)

  // ================= Trace: o caminho até a resposta =================
  console.log('\n--- Rastreabilidade (CHAMA A OPENAI) ---')

  const PERGUNTA = 'Quero alugar um apartamento de 2 quartos na Vila Mariana até 4 mil.'
  await supabase.from('messages').insert({
    conversation_id: widget.conversaId,
    contact_id: widget.contato.id,
    role: 'user',
    content: PERGUNTA,
    media_type: 'text',
    channel: 'widget',
  })

  await processMessage({
    channel: 'widget',
    replyAddress: TOKEN_WIDGET,
    message: PERGUNTA,
    contact: widget.contato,
    conversationId: widget.conversaId,
  })
  await drainWidgetReplies(TOKEN_WIDGET)

  const comTrace = await buscarConversa(widget.conversaId)
  const traces = Object.values(comTrace?.traces ?? {})
  ok('a conversa carrega o trace da resposta', traces.length > 0, `${traces.length}`)

  const t = traces[0]
  if (t) {
    ok('registra qual agente foi escolhido', Boolean(t.routed_to || t.agent), t.routed_to ?? t.agent)
    /* O "porquê" em texto é o que explica um roteamento estranho sem precisar
       reproduzir o caso. */
    ok('registra o porquê do roteamento', Boolean(t.routing_reasoning), t.routing_reasoning?.slice(0, 60) ?? 'vazio')
    ok('registra o modelo usado', Boolean(t.agent_model), t.agent_model ?? '')
    ok('registra o custo em tokens', (t.agent_tokens ?? 0) > 0, String(t.agent_tokens))
    ok('registra a duração', (t.total_duration_ms ?? 0) > 0, `${t.total_duration_ms}ms`)
    ok('guarda o prompt enviado ao modelo', Array.isArray(t.prompt_messages) && t.prompt_messages.length > 0)

    console.log(
      `INFO  agente=${t.routed_to} tools=${t.tool_calls?.map((x) => x.name).join(', ') || 'nenhuma'} ${t.total_duration_ms}ms`
    )

    if (t.tool_calls?.length) {
      const primeira = t.tool_calls[0]
      /* Sem argumentos e retorno, o trace diria "chamou search_properties" e não
         ajudaria ninguém a entender por que a resposta saiu errada. */
      ok(
        'cada tool traz nome, argumentos e retorno',
        Boolean(primeira.name) && primeira.arguments !== undefined && primeira.result !== undefined,
        primeira.name
      )
      ok('e quanto tempo levou', typeof primeira.duration_ms === 'number')
    }

    /* O trace é chaveado por message_id para a tela abrir embaixo da resposta
       que ele gerou — não numa aba solta de logs. */
    const daResposta = comTrace?.mensagens.find(
      (m) => comTrace.traces[m.id] && m.role === 'assistant'
    )
    ok('o trace está preso à resposta que ele gerou', Boolean(daResposta), daResposta?.agent ?? 'nenhuma')
  }

  // ================= Rotas =================
  console.log('\n--- Rotas ---')

  const patchSemSessao = await fetch(`${BASE}/api/admin/conversas/${widget.conversaId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ acao: 'assumir' }),
  })
  ok('assumir exige sessão', patchSemSessao.status === 401, `status ${patchSemSessao.status}`)

  const postSemSessao = await fetch(`${BASE}/api/admin/conversas/${widget.conversaId}/mensagem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texto: 'invasor' }),
  })
  ok('responder exige sessão', postSemSessao.status === 401, `status ${postSemSessao.status}`)

  await limpar()
  console.log('\nDados de teste removidos.')
}

async function contarAssistente(conversationId: string): Promise<number> {
  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('role', 'assistant')
  return count ?? 0
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})

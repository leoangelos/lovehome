import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import { resolveContact, resolveConversation } from '../lib/channels/identity'
import { processMessage } from '../lib/pipeline/process-message'
import { drainWidgetReplies } from '../lib/channels/widget'

/* Exercita o pipeline INTEIRO pelo canal widget: identidade -> resolucao de
   cadastro -> orquestrador (LLM) -> agente -> tools -> persistencia -> despacho.
   Rodar com: npm run check:pipeline

   Widget e nao Z-API porque o adapter do widget so empurra a resposta para o
   Redis (que esta configurado), enquanto Z-API exigiria credencial de instancia.
   O caminho do pipeline e o mesmo — o canal so troca o adapter da ponta.

   Cria um contato proprio de teste e o remove no fim. */

const TOKEN_TESTE = 'check-pipeline-token'
const supabase = createAdminClient()

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

async function limpar() {
  const { data: identidade } = await supabase
    .from('contact_identities')
    .select('contact_id')
    .eq('channel', 'widget')
    .eq('external_id', TOKEN_TESTE)
    .maybeSingle()

  if (identidade?.contact_id) {
    // conversations, messages, agent_histories, traces e logs caem por CASCADE
    const { error } = await supabase.from('contacts').delete().eq('id', identidade.contact_id)
    // O supabase-js devolve a falha no retorno, não lança — sem esta checagem,
    // uma limpeza quebrada passa por bem-sucedida e suja a execução seguinte.
    if (error) throw new Error(`limpeza falhou: ${error.message}`)
  }
}

async function main() {
  await limpar()

  // ---- 1. Identidade ----
  const contato = await resolveContact({
    channel: 'widget',
    externalId: TOKEN_TESTE,
    name: 'Visitante de teste',
  })
  ok('contato criado', Boolean(contato.id))
  ok('nasce sem cadastro', contato.registration_status === 'none', contato.registration_status)
  ok('nasce no estágio novo', contato.funnel_stage === 'novo', contato.funnel_stage)

  const conversa = await resolveConversation(contato.id, 'widget')
  ok('conversa aberta', Boolean(conversa.id))

  // Idempotência: a segunda mensagem do mesmo visitante não pode criar outro
  // contato nem outra conversa.
  const contato2 = await resolveContact({ channel: 'widget', externalId: TOKEN_TESTE })
  const conversa2 = await resolveConversation(contato.id, 'widget')
  ok('mesmo contato na segunda mensagem', contato2.id === contato.id)
  ok('mesma conversa na segunda mensagem', conversa2.id === conversa.id)

  // ---- 2. Pipeline ----
  const mensagem = 'Oi! Queria alugar um apartamento de 2 quartos em Pinheiros, até 5 mil.'

  await supabase.from('messages').insert({
    conversation_id: conversa.id,
    contact_id: contato.id,
    role: 'user',
    content: mensagem,
    media_type: 'text',
    channel: 'widget',
  })

  const inicio = Date.now()
  await processMessage({
    channel: 'widget',
    replyAddress: TOKEN_TESTE,
    message: mensagem,
    contact: contato,
    conversationId: conversa.id,
  })
  const duracao = Date.now() - inicio

  // ---- 3. O que saiu na ponta ----
  const respostas = await drainWidgetReplies(TOKEN_TESTE)
  ok('resposta chegou na fila do canal', respostas.length > 0)
  if (respostas.length) console.log(`\n> ${respostas[0].text}\n`)
  console.log(`INFO  pipeline levou ${(duracao / 1000).toFixed(1)}s`)

  // ---- 4. O que ficou registrado ----
  const [{ data: msgs }, { data: roteamento }, { data: traces }, { data: contatoFinal }] =
    await Promise.all([
      supabase.from('messages').select('role, agent').eq('conversation_id', conversa.id),
      supabase.from('routing_logs').select('routed_to, reasoning').eq('contact_id', contato.id),
      supabase.from('message_traces').select('agent, tool_calls, agent_tokens').eq('conversation_id', conversa.id),
      supabase.from('contacts').select('*').eq('id', contato.id).single(),
    ])

  ok('mensagem do assistente persistida', (msgs ?? []).some((m) => m.role === 'assistant'))
  ok('decisão de roteamento registrada', (roteamento ?? []).length > 0,
    roteamento?.[0] ? `-> ${roteamento[0].routed_to}` : 'nenhuma')
  ok('trace de observabilidade gravado', (traces ?? []).length > 0)

  const trace = traces?.[0]
  const toolsChamadas = ((trace?.tool_calls as { name: string }[]) ?? []).map((t) => t.name)
  console.log(`INFO  agente: ${trace?.agent} · tools: ${toolsChamadas.join(', ') || 'nenhuma'} · tokens: ${trace?.agent_tokens}`)

  ok('funil avançou de novo', contatoFinal!.funnel_stage !== 'novo', contatoFinal!.funnel_stage)
  ok('intenção detectada como aluguel', contatoFinal!.intent === 'aluguel', String(contatoFinal!.intent))
  ok('active_agent definido para o próximo turno', Boolean(contatoFinal!.active_agent), String(contatoFinal!.active_agent))

  const { data: qualificacao } = await supabase
    .from('lead_qualifications')
    .select('region, price_max_cents, bedrooms')
    .eq('contact_id', contato.id)
    .maybeSingle()

  ok('qualificação gravada', Boolean(qualificacao))
  if (qualificacao) {
    console.log(
      `INFO  qualificação: região=${qualificacao.region} · teto=${qualificacao.price_max_cents} centavos · dorms=${qualificacao.bedrooms}`
    )
  }

  await limpar()
  console.log('\nContato de teste removido.')
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})

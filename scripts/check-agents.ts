import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import { resolveRegistration } from '../lib/pipeline/resolve-registration'
import { runSdrAgent } from '../lib/agents/sdr'
import { runAgendamentoAgent } from '../lib/agents/agendamento'
import { generateLeadSummary } from '../lib/agents/summary'
import type { Contact } from '../lib/types/domain'

/* Roda os agentes de verdade contra o banco e a OpenAI. Chama a API — custa
   tokens, entao nao e para rodar em laco.
   Rodar com: npm run check:agents

   Cobre os cenarios 1 e 3 da secao 4 do PRD e, principalmente, o comportamento
   do gate DENTRO do laco de tool-calling: e uma coisa a funcao autorizarTool
   devolver false num teste isolado, outra o agente respeitar isso conversando. */

const PREFIXO_DEMO = '5511900'
const supabase = createAdminClient()

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

async function contatoPorNome(nome: string): Promise<Contact> {
  const { data, error } = await supabase.from('contacts').select('*').eq('name', nome).single()
  if (error) throw new Error(`${nome}: ${error.message}`)
  const c = data as Contact
  if (!c.phone?.startsWith(PREFIXO_DEMO)) {
    throw new Error(`Recusando usar contato fora do seed: ${nome}`)
  }
  return c
}

/** Limpa o historico do agente para a conversa comecar do zero a cada execucao. */
async function limparHistorico(contactId: string) {
  await supabase.from('agent_histories').delete().eq('contact_id', contactId)
  /* O próprio teste faz o SDR gerar um formulário de cadastro para este lead.
     Sem apagar aqui, a SEGUNDA execução encontra o pendente e o gate diz
     'pending' onde o teste espera 'none' — o teste falhava só quando rodado
     duas vezes, que é o pior jeito de falhar. */
  await supabase
    .from('form_submissions')
    .delete()
    .eq('contact_id', contactId)
    .eq('status', 'pendente')
  /* E o cache do contato, que a execução anterior pode ter deixado 'pending'. */
  await supabase
    .from('contacts')
    .update({ registration_status: 'none', updated_at: new Date().toISOString() })
    .eq('id', contactId)
    .is('registration_id', null)
}

async function main() {
  // ================= Cenário 1 — busca sem exigir cadastro =================
  console.log('\n--- Exemplo 1: "Estou procurando apartamento na zona sul" ---')

  const { data: leads } = await supabase
    .from('contacts')
    .select('*')
    .is('registration_id', null)
    .like('phone', `${PREFIXO_DEMO}%`)
    .limit(1)
  const lead = leads![0] as Contact
  await limparHistorico(lead.id)

  const cadastroLead = await resolveRegistration(lead)
  ok('lead começa sem cadastro', cadastroLead.status === 'none', cadastroLead.status)

  const r1 = await runSdrAgent(
    lead.id,
    'Oi! Estou procurando um apartamento de 2 quartos na Vila Mariana, até uns 900 mil.',
    cadastroLead
  )

  console.log(`\n> SDR: ${r1.content}\n`)
  console.log(`tools: ${r1.toolsUsed.join(', ') || 'nenhuma'}`)

  ok('SDR qualificou', r1.toolsUsed.includes('save_qualification'))
  ok('SDR buscou imóveis', r1.toolsUsed.includes('search_properties'))
  ok('SDR não pediu cadastro para buscar', !r1.toolsUsed.includes('request_registration_form'))

  // A resposta tem que citar imóvel que existe. Confere contra o banco em vez
  // de confiar na leitura: é aqui que alucinação apareceria.
  const codigos = [...r1.content.matchAll(/LH-\d{4}/g)].map((m) => m[0])
  ok('SDR citou ao menos um código de imóvel', codigos.length > 0, `citou: ${codigos.join(', ')}`)

  if (codigos.length) {
    const { data: existentes } = await supabase
      .from('properties')
      .select('reference_code, status, region')
      .in('reference_code', codigos)

    ok(
      'todos os códigos citados existem no banco',
      (existentes?.length ?? 0) === new Set(codigos).size,
      `citados ${new Set(codigos).size}, encontrados ${existentes?.length ?? 0}`
    )
    ok(
      'todos os citados estão disponíveis',
      (existentes ?? []).every((p) => p.status === 'disponivel')
    )
  }

  // ================= Resumo para o corretor =================
  /* Requisito explícito do hackathon. Roda aqui porque a conversa do SDR acima
     acabou de produzir o histórico que o gerador precisa ler. */
  console.log('\n--- Resumo para o corretor ---')

  const resumo = await generateLeadSummary({ contactId: lead.id, trigger: 'manual' })
  ok('resumo gerado', resumo.gerado, resumo.motivo ?? '')

  if (resumo.gerado) {
    const { data: gravado } = await supabase
      .from('lead_summaries')
      .select('summary_text, trigger, structured_data')
      .eq('id', resumo.resumoId!)
      .single()

    console.log(`\n${gravado!.summary_text}\n`)
    ok('resumo tem conteúdo', (gravado!.summary_text ?? '').length > 40)
    ok(
      'resumo cita o que a pessoa procura',
      /vila mariana/i.test(gravado!.summary_text),
      'não mencionou a região da conversa'
    )
    ok('snapshot estruturado salvo', Boolean(gravado!.structured_data))
  }

  // ================= Gate: agendar sem cadastro =================
  console.log('\n--- Gate: tentar agendar visita sem cadastro ---')
  await limparHistorico(lead.id)

  const r2 = await runAgendamentoAgent(
    lead.id,
    'Quero visitar o LH-1001 na quinta de manhã, pode ser 10h.',
    cadastroLead
  )

  console.log(`\n> Agendamento: ${r2.content}\n`)
  console.log(`tools: ${r2.toolsUsed.join(', ') || 'nenhuma'}`)

  const tentouCriar = r2.toolsUsed.includes('create_visit')
  const chamadaCriar = r2.trace?.toolCalls?.find((t) => t.name === 'create_visit')
  const foiBloqueada =
    !tentouCriar || (chamadaCriar?.result as { erro?: string })?.erro === 'cadastro_incompleto'

  ok('create_visit não executou sem cadastro', foiBloqueada)

  /* Assertiva sobre o RESULTADO, não sobre o mecanismo: o que importa é a pessoa
     receber o link, tenha ele vindo de uma tool call ou do contexto injetado. */
  const temLink = /https?:\/\/\S*\/cadastro\/\S+/.test(r2.content)
  ok('resposta contém o link de cadastro', temLink, r2.content.slice(0, 120))

  const { count: visitasDoLead } = await supabase
    .from('property_visits')
    .select('id', { count: 'exact', head: true })
    .eq('contact_id', lead.id)
  ok('nenhuma visita foi gravada para o lead sem cadastro', (visitasDoLead ?? 0) === 0)

  // ================= Gate: agendar COM cadastro =================
  console.log('\n--- Gate: agendar com cadastro completo ---')
  const marina = await contatoPorNome('Marina Coelho')
  await limparHistorico(marina.id)

  const cadastroMarina = await resolveRegistration(marina)
  ok('Marina tem cadastro completo', cadastroMarina.status === 'completo')

  const antes = await supabase
    .from('property_visits')
    .select('id', { count: 'exact', head: true })
    .eq('contact_id', marina.id)

  const r3 = await runAgendamentoAgent(
    marina.id,
    'Quero agendar uma visita ao LH-1002. Quais horários você tem?',
    cadastroMarina
  )

  console.log(`\n> Agendamento: ${r3.content}\n`)
  console.log(`tools: ${r3.toolsUsed.join(', ') || 'nenhuma'}`)

  ok('consultou a agenda do corretor', r3.toolsUsed.includes('check_broker_availability'))

  const chamadaAgenda = r3.trace?.toolCalls?.find((t) => t.name === 'check_broker_availability')
  const horarios = (chamadaAgenda?.result as { horarios_livres?: unknown[] })?.horarios_livres ?? []
  ok('agenda devolveu horários livres', horarios.length > 0, `${horarios.length} slots`)

  const criacao = r3.trace?.toolCalls?.find((t) => t.name === 'create_visit')
  if (criacao) {
    const bloqueada = (criacao.result as { erro?: string })?.erro === 'cadastro_incompleto'
    ok('create_visit NÃO foi bloqueada para quem tem cadastro', !bloqueada)
  } else {
    console.log('INFO  agente ofereceu horários e aguarda a escolha (não criou visita ainda)')
  }

  const depois = await supabase
    .from('property_visits')
    .select('id', { count: 'exact', head: true })
    .eq('contact_id', marina.id)
  console.log(`INFO  visitas de Marina: ${antes.count} -> ${depois.count}`)
}

main().catch((e) => {
  console.error('erro:', e.message ?? e)
  process.exit(1)
})

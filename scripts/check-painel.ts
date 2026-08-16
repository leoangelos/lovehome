import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import { montarFunil, ESTAGIOS } from '../lib/queries/painel'
import { moverEstagio } from '../lib/leads/estagio'

/* Kanban do funil. Rodar com: npm run check:painel
   (o servidor de dev precisa estar no ar para a checagem HTTP)

   NÃO chama a OpenAI.

   O que importa aqui é o recorte por carteira: mover é escrita, e a rota é
   chamável direto — esconder o cartão da tela não impede o PATCH. */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const supabase = createAdminClient()

const criado = { contatos: [] as string[], brokers: [] as string[] }

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

  const { data: sobras } = await supabase.from('brokers').select('id').ilike('name', '%Testepainel%')
  for (const b of sobras ?? []) {
    const { data: cs } = await supabase.from('contacts').select('id').eq('assigned_broker_id', b.id)
    for (const c of cs ?? []) await supabase.from('contacts').delete().eq('id', c.id)
    await supabase.from('brokers').delete().eq('id', b.id)
  }
}

async function criarCorretor(nome: string) {
  const { data, error } = await supabase
    .from('brokers')
    .insert({ name: `${nome} Testepainel`, specialty: 'geral', is_active: true })
    .select('id')
    .single()
  if (error) throw new Error(`corretor: ${error.message}`)
  criado.brokers.push(data.id)
  return data.id as string
}

async function criarLead(nome: string, phone: string, estagio: string, brokerId: string) {
  const { data, error } = await supabase
    .from('contacts')
    .insert({
      phone,
      phone_key: phone.slice(-8),
      name: nome,
      funnel_stage: estagio,
      intent: 'aluguel',
      assigned_broker_id: brokerId,
    })
    .select('id')
    .single()
  if (error) throw new Error(`lead: ${error.message}`)
  criado.contatos.push(data.id)
  return data.id as string
}

async function estagioDe(id: string) {
  const { data } = await supabase.from('contacts').select('funnel_stage').eq('id', id).single()
  return data?.funnel_stage
}

async function main() {
  await limpar()

  const corretorA = await criarCorretor('Ana')
  const corretorB = await criarCorretor('Bruno')

  const leadA = await criarLead('Zeus Painel', '5511977007001', 'qualificando', corretorA)
  const leadB = await criarLead('Hera Painel', '5511977007002', 'novo', corretorB)

  // Conversa com a última palavra do cliente — deve marcar "esperando resposta".
  const { data: conversa } = await supabase
    .from('conversations')
    .insert({ contact_id: leadA, channel: 'widget', status: 'active' })
    .select('id')
    .single()
  await supabase.from('messages').insert({
    conversation_id: conversa!.id,
    contact_id: leadA,
    role: 'user',
    content: 'Ainda estou esperando o retorno.',
    media_type: 'text',
    channel: 'widget',
  })

  // ================= Montagem do quadro =================
  console.log('--- Quadro ---')

  const quadro = await montarFunil(null)
  ok('tem uma coluna por estágio', quadro.length === ESTAGIOS.length, `${quadro.length}`)
  ok(
    'as colunas seguem a ordem do funil',
    quadro.every((c, i) => c.estagio === ESTAGIOS[i]),
    quadro.map((c) => c.estagio).join(' → ')
  )

  const emQualificando = quadro.find((c) => c.estagio === 'qualificando')
  const cartaoA = emQualificando?.cartoes.find((c) => c.id === leadA)
  ok('o lead está na coluna do estágio dele', Boolean(cartaoA))
  ok('o cartão aponta para a conversa', cartaoA?.conversa_id === conversa!.id)
  /* É o sinal que faz o cartão pedir atenção no meio de uma coluna cheia. */
  ok('marca que está esperando resposta', cartaoA?.esperando_resposta === true)

  ok(
    'nenhum lead aparece em duas colunas',
    quadro.flatMap((c) => c.cartoes).filter((c) => c.id === leadA).length === 1
  )

  // ================= Escopo =================
  console.log('\n--- Escopo por carteira ---')

  const quadroA = await montarFunil(corretorA)
  const idsA = quadroA.flatMap((c) => c.cartoes).map((c) => c.id)
  ok('corretor vê o próprio lead', idsA.includes(leadA))
  ok('e NÃO vê o do outro corretor', !idsA.includes(leadB), `${idsA.length} leads`)

  // ================= Movimento =================
  console.log('\n--- Mover ---')

  const moveu = await moverEstagio({
    contactId: leadA,
    estagio: 'visita_agendada',
    email: 'ana@teste.local',
  })
  ok('move de estágio', moveu.ok === true && moveu.para === 'visita_agendada', JSON.stringify(moveu))
  ok('e o banco mudou', (await estagioDe(leadA)) === 'visita_agendada')

  const invalido = await moverEstagio({
    contactId: leadA,
    estagio: 'estagio_inventado',
    email: 'ana@teste.local',
  })
  ok('estágio inexistente é recusado', !invalido.ok && invalido.status === 400)
  ok('e nada mudou', (await estagioDe(leadA)) === 'visita_agendada')

  /* Sem trava de transição de propósito: o corretor sabe coisas que a conversa
     não contém ("liguei e ele desistiu"). Um fluxo obrigatório aqui só criaria
     atrito com uma operação que não é linear. */
  const pulou = await moverEstagio({
    contactId: leadA,
    estagio: 'perdido',
    email: 'ana@teste.local',
  })
  ok('pular etapas é permitido', pulou.ok === true, JSON.stringify(pulou))

  const mesmo = await moverEstagio({
    contactId: leadA,
    estagio: 'perdido',
    email: 'ana@teste.local',
  })
  ok('mover para o mesmo estágio não quebra', mesmo.ok === true)

  // ================= Escopo no movimento =================
  console.log('\n--- Escopo ao mover ---')

  /* O ponto: a rota é chamável direto. Esconder o cartão da tela não impede o
     PATCH, então a trava tem que estar aqui. */
  const alheio = await moverEstagio({
    contactId: leadB,
    estagio: 'convertido',
    email: 'ana@teste.local',
    brokerId: corretorA,
  })
  ok('corretor NÃO move lead de outra carteira', !alheio.ok && alheio.status === 403, JSON.stringify(alheio))
  ok('e o lead do outro continua onde estava', (await estagioDe(leadB)) === 'novo')

  const proprio = await moverEstagio({
    contactId: leadA,
    estagio: 'qualificado',
    email: 'ana@teste.local',
    brokerId: corretorA,
  })
  ok('mas move o da própria carteira', proprio.ok === true)

  const inexistente = await moverEstagio({
    contactId: '00000000-0000-4000-8000-000000000000',
    estagio: 'novo',
    email: 'ana@teste.local',
  })
  ok('lead inexistente é 404', !inexistente.ok && inexistente.status === 404)

  // ================= Rota =================
  console.log('\n--- Rota ---')

  const semSessao = await fetch(`${BASE}/api/admin/leads/${leadA}/estagio`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ estagio: 'convertido' }),
  })
  ok('mover exige sessão', semSessao.status === 401, `status ${semSessao.status}`)
  ok('e a tentativa não mudou nada', (await estagioDe(leadA)) === 'qualificado')

  await limpar()
  console.log('\nDados de teste removidos.')
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})

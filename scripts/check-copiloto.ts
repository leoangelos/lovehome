import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import { criarToolsCopiloto } from '../lib/agents/tools/copiloto'
import { responderCopiloto } from '../lib/agents/copiloto'
import { recursosVisiveis } from '../lib/auth/permissions'

/* Copiloto do Corretor (PRD 12.8). Rodar com: npm run check:copiloto
   (o servidor de dev precisa estar no ar para a checagem HTTP)

   CHAMA A OPENAI uma vez, no fim — é o único jeito de provar que o escopo
   sobrevive ao laço inteiro do agente, e não só à consulta isolada.

   O que está sendo protegido: o Copiloto lê lead, agenda, negócio e documento.
   Se o recorte por corretor falhar, um corretor passa a enxergar a carteira do
   outro — e o caminho mais provável para isso não é invasão, é o modelo
   preenchendo um broker_id por conta própria. Por isso o escopo não é
   parâmetro de tool, e por isso este script confere isso estruturalmente. */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const MARCA = 'Testecopiloto'
const supabase = createAdminClient()

const criado = {
  brokers: [] as string[],
  contatos: [] as string[],
  visitas: [] as string[],
}

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

async function limpar() {
  for (const id of criado.visitas) await supabase.from('property_visits').delete().eq('id', id)
  for (const id of criado.contatos) {
    const { error } = await supabase.from('contacts').delete().eq('id', id)
    if (error) throw new Error(`limpeza do contato falhou: ${error.message}`)
  }
  for (const id of criado.brokers) {
    const { error } = await supabase.from('brokers').delete().eq('id', id)
    if (error) throw new Error(`limpeza do corretor falhou: ${error.message}`)
  }
  criado.visitas.length = 0
  criado.contatos.length = 0
  criado.brokers.length = 0

  /* Rede para execução interrompida no meio: apaga só linhas com a marca do
     teste, nunca por atributo genérico. */
  const { data: sobras } = await supabase.from('brokers').select('id').ilike('name', `%${MARCA}%`)
  for (const b of sobras ?? []) {
    const { data: cs } = await supabase.from('contacts').select('id').eq('assigned_broker_id', b.id)
    for (const c of cs ?? []) await supabase.from('contacts').delete().eq('id', c.id)
    await supabase.from('brokers').delete().eq('id', b.id)
  }
}

async function criarCorretor(nome: string) {
  const { data, error } = await supabase
    .from('brokers')
    .insert({ name: `${nome} ${MARCA}`, specialty: 'geral', is_active: true })
    .select('id')
    .single()
  if (error) throw new Error(`corretor: ${error.message}`)
  criado.brokers.push(data.id)
  return data.id as string
}

async function criarLead(nome: string, telefone: string, brokerId: string) {
  const { data, error } = await supabase
    .from('contacts')
    .insert({
      phone: telefone,
      phone_key: telefone.slice(-8),
      name: `${nome} ${MARCA}`,
      assigned_broker_id: brokerId,
      funnel_stage: 'qualificado',
      intent: 'aluguel',
    })
    .select('id')
    .single()
  if (error) throw new Error(`lead: ${error.message}`)
  criado.contatos.push(data.id)
  return data.id as string
}

async function criarVisita(contactId: string, brokerId: string, propertyId: string, hora: number) {
  const quando = new Date()
  quando.setHours(hora, 0, 0, 0)
  const { data, error } = await supabase
    .from('property_visits')
    .insert({
      contact_id: contactId,
      broker_id: brokerId,
      property_id: propertyId,
      scheduled_at: quando.toISOString(),
      status: 'agendada',
      type: 'visita',
    })
    .select('id')
    .single()
  if (error) throw new Error(`visita: ${error.message}`)
  criado.visitas.push(data.id)
  return data.id as string
}

async function main() {
  await limpar()

  // ================= Estrutural: escopo não é parâmetro =================
  console.log('--- Superfície das tools ---')

  const { tools } = criarToolsCopiloto({
    brokerId: 'qualquer',
    nome: 'Teste',
    recursos: recursosVisiveis('admin'),
  })
  const esquema = JSON.stringify(tools)

  /* A §12.8 escreve `get_my_agenda(broker_id, date_range)`. Se broker_id virar
     parâmetro de verdade, o modelo passa a escolher a carteira — e a checagem
     abaixo é o que impede isso de voltar num refactor distraído. */
  ok('nenhuma tool aceita broker_id', !/broker_id/.test(esquema))
  ok('nenhuma tool aceita corretor_id', !/corretor_id/.test(esquema))

  const nomes = tools.map((t) => (t as { function: { name: string } }).function.name)
  ok(
    'as 4 tools da §12.8 existem',
    ['get_my_agenda', 'get_lead_summary', 'get_pending_documents', 'get_deal_status'].every((n) =>
      nomes.includes(n)
    ),
    nomes.join(', ')
  )
  ok(
    'as ferramentas negociais entram para o admin',
    ['get_overdue_payments', 'get_portfolio_overview', 'get_funnel_overview', 'find_client_contact'].every(
      (n) => nomes.includes(n)
    ),
    nomes.join(', ')
  )

  // ---- O papel decide QUAIS tools existem, e isso não passa pelo modelo ----
  const nomesDe = (papel: Parameters<typeof recursosVisiveis>[0]) =>
    criarToolsCopiloto({
      brokerId: papel === 'corretor' ? 'qualquer' : null,
      nome: 'Teste',
      recursos: recursosVisiveis(papel),
    }).tools.map((t) => (t as { function: { name: string } }).function.name)

  const doEditor = nomesDe('editor')
  const doViewer = nomesDe('viewer')
  const doCorretor = nomesDe('corretor')

  /* Filtrar por papel dentro do prompt seria pedir ao modelo que guardasse
     segredo. A ferramenta que o papel não pode usar não existe para a sessão —
     não há como pedir a ela por mais que se insista. */
  ok('editor NÃO recebe a tool de inadimplência', !doEditor.includes('get_overdue_payments'), doEditor.join(', '))
  ok('editor NÃO recebe contatos de cliente', !doEditor.includes('find_client_contact'))
  ok('editor recebe o acervo', doEditor.includes('get_portfolio_overview'))
  ok('editor recebe os materiais da empresa', doEditor.includes('search_knowledge_base'))

  ok('viewer recebe inadimplência (pagamentos está na matriz dele)', doViewer.includes('get_overdue_payments'))
  ok('corretor NÃO recebe inadimplência', !doCorretor.includes('get_overdue_payments'), doCorretor.join(', '))
  ok('corretor recebe a própria agenda', doCorretor.includes('get_my_agenda'))

  /* A trava estrutural vale para TODA a superfície, não só para as quatro
     originais: uma tool negocial com broker_id no schema teria o mesmo efeito. */
  for (const papel of ['admin', 'corretor', 'editor', 'viewer'] as const) {
    const esquemaDoPapel = JSON.stringify(
      criarToolsCopiloto({
        brokerId: papel === 'corretor' ? 'qualquer' : null,
        nome: 'Teste',
        recursos: recursosVisiveis(papel),
      }).tools
    )
    ok(`${papel}: nenhum schema expõe o recorte`, !/broker_id|corretor_id/.test(esquemaDoPapel))
  }

  // ================= Dados de duas carteiras =================
  const { data: imovel } = await supabase
    .from('properties')
    .select('id, reference_code')
    .eq('status', 'disponivel')
    .limit(1)
    .single()

  const corretorA = await criarCorretor('Ana')
  const corretorB = await criarCorretor('Bruno')

  const leadA = await criarLead('Zeus', '5511977003001', corretorA)
  const leadB = await criarLead('Hera', '5511977003002', corretorB)

  await criarVisita(leadA, corretorA, imovel!.id, 10)
  await criarVisita(leadB, corretorB, imovel!.id, 11)

  const escopoA = { brokerId: corretorA, nome: 'Ana', recursos: recursosVisiveis('corretor') }
  const escopoAdmin = { brokerId: null, nome: 'Admin', recursos: recursosVisiveis('admin') }

  const deA = criarToolsCopiloto(escopoA).handlers
  const deAdmin = criarToolsCopiloto(escopoAdmin).handlers

  // ================= Agenda =================
  console.log('\n--- Agenda ---')

  const agendaA = (await deA.get_my_agenda({ periodo: 'hoje' })) as {
    total: number
    visitas: { cliente: string }[]
  }
  const clientesA = agendaA.visitas.map((v) => v.cliente)

  ok('corretor vê a própria visita', clientesA.some((c) => c.includes('Zeus')), clientesA.join(', '))
  /* O ponto do recorte: a visita do outro corretor é do mesmo dia e do mesmo
     imóvel, e ainda assim não pode aparecer. */
  ok('NÃO vê a visita do outro corretor', !clientesA.some((c) => c.includes('Hera')))

  const agendaAdmin = (await deAdmin.get_my_agenda({ periodo: 'hoje' })) as {
    visitas: { cliente: string }[]
  }
  const clientesAdmin = agendaAdmin.visitas.map((v) => v.cliente)
  ok(
    'admin vê as duas',
    clientesAdmin.some((c) => c.includes('Zeus')) && clientesAdmin.some((c) => c.includes('Hera'))
  )

  // ================= Lead =================
  console.log('\n--- Resumo de lead ---')

  const proprio = (await deA.get_lead_summary({ busca: 'Zeus' })) as {
    encontrado: boolean
    nome: string
  }
  ok('acha lead da própria carteira', proprio.encontrado === true && proprio.nome.includes('Zeus'))

  /* O ataque real não é técnico: é o corretor (ou o modelo) simplesmente
     perguntando pelo nome de um lead alheio. Tem que dar "não encontrei". */
  const alheio = (await deA.get_lead_summary({ busca: 'Hera' })) as { encontrado: boolean }
  ok('lead de outra carteira responde "não encontrei"', alheio.encontrado === false)

  const porTelefone = (await deA.get_lead_summary({ busca: '5511977003002' })) as {
    encontrado: boolean
  }
  ok('nem pelo telefone exato do lead alheio', porTelefone.encontrado === false)

  const adminAcha = (await deAdmin.get_lead_summary({ busca: 'Hera' })) as { encontrado: boolean }
  ok('admin acha o mesmo lead', adminAcha.encontrado === true)

  // ================= Documentos e negócios =================
  console.log('\n--- Documentos e negócios ---')

  const docsA = (await deA.get_pending_documents({})) as { total: number; documentos: unknown[] }
  const docsAdmin = (await deAdmin.get_pending_documents({})) as { total: number }
  ok(
    'documentos do corretor são subconjunto dos do admin',
    docsA.total <= docsAdmin.total,
    `corretor: ${docsA.total}, admin: ${docsAdmin.total}`
  )
  ok('a lista devolvida não expõe o broker_id interno', !JSON.stringify(docsA.documentos).includes('_broker'))

  const negocioAlheio = (await deA.get_deal_status({ busca: imovel!.reference_code })) as {
    encontrado: boolean
  }
  ok(
    'negócio fora da carteira não aparece para o corretor',
    negocioAlheio.encontrado === false || negocioAlheio.encontrado === undefined,
    JSON.stringify(negocioAlheio).slice(0, 80)
  )

  // ================= Rota =================
  console.log('\n--- Rota ---')

  const semSessao = await fetch(`${BASE}/api/admin/copiloto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pergunta: 'quais são minhas visitas?' }),
  })
  ok('copiloto exige sessão', semSessao.status === 401, `status ${semSessao.status}`)

  // ================= Agente de verdade =================
  console.log('\n--- Agente rodando (CHAMA A OPENAI) ---')

  const resposta = await responderCopiloto(escopoA, 'Quais são minhas visitas de hoje?')
  console.log(`\n> ${resposta.content}\n`)
  console.log(`INFO  tools: ${resposta.toolsUsadas.join(', ') || 'nenhuma'}`)

  ok('o agente consultou a agenda', resposta.toolsUsadas.includes('get_my_agenda'))
  ok('a resposta cita o cliente da carteira dele', resposta.content.includes('Zeus'))
  /* A prova que interessa: o recorte sobreviveu ao laço inteiro — prompt,
     tool call e redação final. */
  ok('a resposta NÃO cita o cliente do outro corretor', !resposta.content.includes('Hera'))

  await limpar()
  console.log('\nDados de teste removidos.')
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})

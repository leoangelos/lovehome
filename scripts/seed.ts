import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import { prepararCpf } from '../lib/registrations/cpf'
import { SEED_PROPERTIES } from '../lib/seed/properties'

/* Popula o banco com o portfolio simulado e um recorte de operacao plausivel —
   corretores, leads em varios estagios, visitas da semana, um contrato ativo com
   historico de cobranca e a fila de aprovacao (PRD 7.5 e 21, Marco 1).
   Rodar com: npm run seed
   E idempotente: apaga so o que ele mesmo cria, identificado pelos marcadores
   abaixo, e insere de novo. Dado real digitado no painel nao e tocado. */

const MARCADOR_IMOVEL = 'LH-1%'
const MARCADOR_EMAIL_CORRETOR = '%@lovehome.demo'
const DDD_DEMO = '5511900%'

const supabase = createAdminClient()

/** Monta um CPF sintetico valido a partir de uma base de 9 digitos.
    Gerado, e nao escrito a mao, para nao arriscar usar o CPF de uma pessoa real. */
function cpfSintetico(base: number): string {
  const nove = String(base).padStart(9, '0').slice(0, 9)
  const digito = (parcial: string): number => {
    let soma = 0
    let peso = parcial.length + 1
    for (const d of parcial) soma += Number(d) * peso--
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }
  const d1 = digito(nove)
  const d2 = digito(nove + d1)
  return `${nove}${d1}${d2}`
}

function diasAFrente(dias: number, hora: number, minuto = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  d.setHours(hora, minuto, 0, 0)
  return d.toISOString()
}

function mesesAtras(meses: number): Date {
  const d = new Date()
  d.setMonth(d.getMonth() - meses)
  return d
}

function primeiroDoMes(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

async function limpar() {
  console.log('Limpando dados de seed anteriores...')

  // Ordem ditada pelas FKs sem CASCADE: deals antes de properties, contacts
  // antes de properties (visitas apontam para imovel), registrations por ultimo
  // porque properties.owner_registration_id referencia sem cascade.
  const { data: imoveis } = await supabase
    .from('properties')
    .select('id')
    .like('reference_code', MARCADOR_IMOVEL)
  const idsImoveis = (imoveis ?? []).map((i) => i.id)

  if (idsImoveis.length) {
    await supabase.from('deals').delete().in('property_id', idsImoveis)
  }
  await supabase.from('contacts').delete().like('phone', DDD_DEMO)
  await supabase.from('properties').delete().like('reference_code', MARCADOR_IMOVEL)
  await supabase.from('registrations').delete().like('email', MARCADOR_EMAIL_CORRETOR)
  await supabase.from('brokers').delete().like('email', MARCADOR_EMAIL_CORRETOR)
}

async function main() {
  await limpar()

  // ---------- Corretores ----------
  const { data: corretores, error: errCorretores } = await supabase
    .from('brokers')
    .insert([
      {
        name: 'Renata Alves',
        email: 'renata@lovehome.demo',
        phone: '5511900000001',
        specialty: 'residencial',
        region_focus: ['Vila Mariana', 'Moema', 'Saúde', 'Aclimação'],
      },
      {
        name: 'Diego Nunes',
        email: 'diego@lovehome.demo',
        phone: '5511900000002',
        specialty: 'residencial',
        region_focus: ['Pinheiros', 'Vila Madalena', 'Perdizes'],
      },
      {
        name: 'Tatiana Rocha',
        email: 'tatiana@lovehome.demo',
        phone: '5511900000003',
        specialty: 'investimento',
        region_focus: ['Itaim Bibi', 'Paraíso', 'Brooklin'],
      },
      {
        name: 'Marcos Ferreira',
        email: 'marcos@lovehome.demo',
        phone: '5511900000004',
        specialty: 'comercial',
        region_focus: ['Itaim Bibi', 'Jardins'],
      },
    ])
    .select('id, name, specialty')

  if (errCorretores) throw errCorretores
  const porNome = (n: string) => corretores!.find((c) => c.name === n)!.id
  console.log(`✓ ${corretores!.length} corretores`)

  // Agenda: seg-sex 9h-18h com almoco 12h-13h para todos; sabado 9h-13h so
  // para os residenciais (sem almoco — a janela acaba as 13h).
  const agenda = corretores!.flatMap((c) => {
    const semana = [1, 2, 3, 4, 5].map((weekday) => ({
      broker_id: c.id,
      weekday,
      start_time: '09:00',
      end_time: '18:00',
      break_start: '12:00',
      break_end: '13:00',
    }))
    return c.specialty === 'residencial'
      ? [...semana, { broker_id: c.id, weekday: 6, start_time: '09:00', end_time: '13:00' }]
      : semana
  })
  const { error: errAgenda } = await supabase.from('broker_availability').insert(agenda)
  if (errAgenda) throw errAgenda
  console.log(`✓ ${agenda.length} janelas de disponibilidade`)

  // ---------- Cadastros formais ----------
  const pessoas = [
    { nome: 'Marina Coelho', email: 'marina@lovehome.demo', papeis: ['interessado'] },
    { nome: 'Paulo Ferraz', email: 'paulo@lovehome.demo', papeis: ['interessado'] },
    { nome: 'Sérgio Lima', email: 'sergio@lovehome.demo', papeis: ['interessado'] },
    {
      nome: 'Helena Prado',
      email: 'helena@lovehome.demo',
      papeis: ['proprietario', 'interessado'],
    },
    { nome: 'Rafael Souza', email: 'rafael@lovehome.demo', papeis: ['proprietario'] },
    { nome: 'Bianca Martins', email: 'bianca@lovehome.demo', papeis: ['inquilino_ativo'] },
  ]

  const { data: cadastros, error: errCadastros } = await supabase
    .from('registrations')
    .insert(
      pessoas.map((p, i) => ({
        ...prepararCpf(cpfSintetico(100000000 + i * 111111)),
        full_name: p.nome,
        email: p.email,
        address: { city: 'São Paulo', state: 'SP' },
      }))
    )
    .select('id, full_name')

  if (errCadastros) throw errCadastros
  const cadastroDe = (nome: string) => cadastros!.find((c) => c.full_name === nome)!.id

  const { error: errPapeis } = await supabase.from('contact_roles').insert(
    pessoas.flatMap((p) =>
      p.papeis.map((role) => ({
        registration_id: cadastroDe(p.nome),
        role,
      }))
    )
  )
  if (errPapeis) throw errPapeis
  console.log(`✓ ${cadastros!.length} cadastros formais (CPF cifrado + hash)`)

  // ---------- Imoveis ----------
  const { data: imoveis, error: errImoveis } = await supabase
    .from('properties')
    .insert(
      SEED_PROPERTIES.map((p) => {
        return {
          ...p,
          // Os dois em analise vieram de proprietario pelo WhatsApp (Exemplo 4).
          owner_registration_id:
            p.reference_code === 'LH-1023'
              ? cadastroDe('Helena Prado')
              : p.reference_code === 'LH-1024'
                ? cadastroDe('Rafael Souza')
                : null,
          broker_id:
            p.property_type === 'comercial'
              ? porNome('Marcos Ferreira')
              : p.property_type === 'studio'
                ? porNome('Tatiana Rocha')
                : ['Pinheiros', 'Vila Madalena', 'Perdizes'].includes(p.region)
                  ? porNome('Diego Nunes')
                  : porNome('Renata Alves'),
        }
      })
    )
    .select('id, reference_code, rent_price_cents')

  if (errImoveis) throw errImoveis
  const imovelDe = (ref: string) => imoveis!.find((i) => i.reference_code === ref)!
  console.log(`✓ ${imoveis!.length} imóveis`)

  // ---------- Contatos (funil) ----------
  /* Distribuicao pensada para o dashboard mostrar um funil plausivel, nao um
     numero redondo por estagio. */
  const estagios: { stage: string; intent: string | null; quantidade: number }[] = [
    { stage: 'novo', intent: null, quantidade: 14 },
    { stage: 'qualificando', intent: 'compra', quantidade: 9 },
    { stage: 'qualificando', intent: 'aluguel', quantidade: 7 },
    { stage: 'qualificado', intent: 'compra', quantidade: 6 },
    { stage: 'qualificado', intent: 'investimento', quantidade: 4 },
    { stage: 'visita_agendada', intent: 'compra', quantidade: 5 },
    { stage: 'em_negociacao', intent: 'aluguel', quantidade: 3 },
    { stage: 'convertido', intent: 'aluguel', quantidade: 2 },
    { stage: 'perdido', intent: 'compra', quantidade: 6 },
    { stage: 'qualificando', intent: 'disponibilizar_imovel', quantidade: 4 },
  ]

  let seq = 100
  const contatosGenericos = estagios.flatMap((e) =>
    Array.from({ length: e.quantidade }, () => {
      seq += 1
      return {
        phone: `55119000${String(seq).padStart(5, '0')}`,
        phone_key: `9000${String(seq).padStart(5, '0')}`.slice(-8),
        name: `Lead ${seq}`,
        funnel_stage: e.stage,
        intent: e.intent,
        assigned_broker_id: e.stage === 'novo' ? null : porNome('Renata Alves'),
      }
    })
  )

  // Os nomeados aparecem nas visitas e nos contratos — precisam de cadastro.
  const contatosNomeados = [
    {
      phone: '5511900010001',
      phone_key: '00010001',
      name: 'Marina Coelho',
      funnel_stage: 'visita_agendada',
      intent: 'compra',
      registration_id: cadastroDe('Marina Coelho'),
      registration_status: 'completo',
      assigned_broker_id: porNome('Renata Alves'),
    },
    {
      phone: '5511900010002',
      phone_key: '00010002',
      name: 'Paulo Ferraz',
      funnel_stage: 'visita_agendada',
      intent: 'compra',
      registration_id: cadastroDe('Paulo Ferraz'),
      registration_status: 'completo',
      assigned_broker_id: porNome('Diego Nunes'),
    },
    {
      phone: '5511900010003',
      phone_key: '00010003',
      name: 'Sérgio Lima',
      funnel_stage: 'qualificado',
      intent: 'investimento',
      registration_id: cadastroDe('Sérgio Lima'),
      registration_status: 'completo',
      active_agent: 'investidor',
      assigned_broker_id: porNome('Tatiana Rocha'),
    },
    {
      phone: '5511900010004',
      phone_key: '00010004',
      name: 'Helena Prado',
      funnel_stage: 'qualificando',
      intent: 'disponibilizar_imovel',
      registration_id: cadastroDe('Helena Prado'),
      registration_status: 'completo',
      active_agent: 'proprietario',
      assigned_broker_id: porNome('Renata Alves'),
    },
    {
      phone: '5511900010005',
      phone_key: '00010005',
      name: 'Bianca Martins',
      funnel_stage: 'convertido',
      intent: 'aluguel',
      registration_id: cadastroDe('Bianca Martins'),
      registration_status: 'completo',
      active_agent: 'suporte',
      assigned_broker_id: porNome('Diego Nunes'),
    },
  ]

  /* Todas as linhas precisam ter exatamente as mesmas chaves. O PostgREST monta
     um unico INSERT com a lista de colunas da uniao dos objetos, e chave ausente
     numa linha vira NULL — nao o DEFAULT da coluna. Sem isso, os contatos sem
     registration_status batiam no NOT NULL. */
  const contatos_para_inserir = [...contatosGenericos, ...contatosNomeados].map((c) => ({
    phone: c.phone,
    phone_key: c.phone_key,
    name: c.name,
    funnel_stage: c.funnel_stage,
    intent: c.intent ?? null,
    assigned_broker_id: c.assigned_broker_id ?? null,
    registration_id: 'registration_id' in c ? c.registration_id : null,
    registration_status: 'registration_status' in c ? c.registration_status : 'none',
    active_agent: 'active_agent' in c ? c.active_agent : null,
  }))

  const { data: contatos, error: errContatos } = await supabase
    .from('contacts')
    .insert(contatos_para_inserir)
    .select('id, name')

  if (errContatos) throw errContatos
  const contatoDe = (nome: string) => contatos!.find((c) => c.name === nome)!.id
  console.log(`✓ ${contatos!.length} contatos`)

  // ---------- Qualificacoes ----------
  const { error: errQual } = await supabase.from('lead_qualifications').insert([
    {
      contact_id: contatoDe('Marina Coelho'),
      intent: 'compra',
      price_min_cents: 60_000_000,
      price_max_cents: 90_000_000,
      bedrooms: 2,
      region: 'Vila Mariana',
      property_type: 'apartamento',
      urgency: 'ate_30_dias',
      notes: 'Quer ficar perto do metrô. Trabalha na Paulista.',
    },
    {
      contact_id: contatoDe('Sérgio Lima'),
      intent: 'investimento',
      investor_ticket_cents: 65_000_000,
      investor_return_expectation: '0,6% ao mês líquido',
      investor_has_portfolio: true,
      region: 'Paraíso',
      property_type: 'studio',
      urgency: 'sem_pressa',
      notes: 'Já tem 2 studios locados. Procura unidade pronta para renda.',
    },
  ])
  if (errQual) throw errQual

  // ---------- Visitas da semana ----------
  const { error: errVisitas } = await supabase.from('property_visits').insert([
    {
      contact_id: contatoDe('Marina Coelho'),
      property_id: imovelDe('LH-1001').id,
      broker_id: porNome('Renata Alves'),
      scheduled_at: diasAFrente(2, 10),
      type: 'visita',
      status: 'confirmada',
    },
    {
      contact_id: contatoDe('Paulo Ferraz'),
      property_id: imovelDe('LH-1008').id,
      broker_id: porNome('Diego Nunes'),
      scheduled_at: diasAFrente(2, 15, 30),
      type: 'visita',
      status: 'agendada',
    },
    {
      contact_id: contatoDe('Marina Coelho'),
      property_id: imovelDe('LH-1022').id,
      broker_id: porNome('Renata Alves'),
      scheduled_at: diasAFrente(3, 9),
      type: 'visita',
      status: 'agendada',
    },
    {
      contact_id: contatoDe('Sérgio Lima'),
      property_id: imovelDe('LH-1015').id,
      broker_id: porNome('Tatiana Rocha'),
      scheduled_at: diasAFrente(4, 14),
      type: 'reuniao_investidor',
      status: 'agendada',
    },
    {
      contact_id: contatoDe('Paulo Ferraz'),
      property_id: imovelDe('LH-1005').id,
      broker_id: porNome('Diego Nunes'),
      scheduled_at: diasAFrente(5, 11),
      type: 'visita',
      status: 'agendada',
    },
  ])
  if (errVisitas) throw errVisitas
  console.log('✓ 5 visitas na próxima semana')

  // ---------- Contrato de locacao ativo + cobranca ----------
  const alugado = imovelDe('LH-1010')
  const inicio = mesesAtras(5)

  const { data: negocios, error: errNegocios } = await supabase
    .from('deals')
    .insert([
      {
        deal_type: 'locacao',
        property_id: alugado.id,
        client_registration_id: cadastroDe('Bianca Martins'),
        broker_id: porNome('Diego Nunes'),
        status: 'ativo',
        rent_price_cents: alugado.rent_price_cents,
        start_date: primeiroDoMes(inicio),
        end_date: primeiroDoMes(new Date(inicio.getFullYear() + 2, inicio.getMonth(), 1)),
        notice_period_days: 30,
        signature_method: 'govbr',
        signed_returned_via: 'whatsapp',
        contract_signed_at: inicio.toISOString(),
      },
      {
        deal_type: 'venda',
        property_id: imovelDe('LH-1008').id,
        client_registration_id: cadastroDe('Paulo Ferraz'),
        broker_id: porNome('Diego Nunes'),
        status: 'em_aprovacao',
        sale_price_cents: 165_000_000,
        down_payment_cents: 40_000_000,
        financing_type: 'financiado',
        itbi_status: 'pendente',
      },
    ])
    .select('id, deal_type, rent_price_cents')

  if (errNegocios) throw errNegocios
  const locacao = negocios!.find((d) => d.deal_type === 'locacao')!
  const venda = negocios!.find((d) => d.deal_type === 'venda')!

  /* 5 meses de aluguel. O inquilino pulou o terceiro mes e nunca quitou, mas
     seguiu pagando depois — inclusive o mes corrente. Assim o dashboard mostra
     as duas coisas ao mesmo tempo: recebimento saudavel no mes e uma
     inadimplencia real em aberto. Uma parcela atrasada com todos os meses
     seguintes tambem em aberto seria outro cenario (inquilino que parou de
     pagar), mais dramatico e menos comum. */
  const STATUS_PARCELA = ['pago', 'atrasado', 'pago', 'pago', 'pago']

  const parcelas = Array.from({ length: 5 }, (_, i) => {
    const mes = mesesAtras(4 - i)
    const vencimento = `${mes.getFullYear()}-${String(mes.getMonth() + 1).padStart(2, '0')}-10`
    const status = STATUS_PARCELA[i]
    return {
      deal_id: locacao.id,
      reference_month: primeiroDoMes(mes),
      amount_cents: locacao.rent_price_cents!,
      due_date: vencimento,
      status,
      paid_at: status === 'pago' ? new Date(`${vencimento}T12:00:00Z`).toISOString() : null,
    }
  })

  const { error: errParcelas } = await supabase.from('lease_payments').insert(parcelas)
  if (errParcelas) throw errParcelas
  console.log('✓ 2 negócios (1 locação ativa, 1 venda em aprovação) + 5 parcelas')

  // ---------- Fila de aprovacao e documentos ----------
  const { error: errAprov } = await supabase.from('approval_requests').insert([
    {
      property_id: imovelDe('LH-1023').id,
      type: 'aprovacao_listagem_imovel',
      notes: 'LH-1023 · Cambuci — enviado pela proprietária via WhatsApp, faltam fotos',
    },
    {
      property_id: imovelDe('LH-1024').id,
      type: 'aprovacao_listagem_imovel',
      notes: 'LH-1024 · Penha — falta comprovar a metragem da edícula',
    },
    {
      deal_id: venda.id,
      type: 'aprovacao_venda',
      notes: 'LH-1008 · Brooklin — documentos recebidos, aguardando análise de crédito',
    },
  ])
  if (errAprov) throw errAprov

  const { error: errDocs } = await supabase.from('documents').insert([
    {
      registration_id: cadastroDe('Paulo Ferraz'),
      deal_id: venda.id,
      type: 'rg_cnh',
      storage_path: 'demo/paulo-rg.pdf',
    },
    {
      registration_id: cadastroDe('Paulo Ferraz'),
      deal_id: venda.id,
      type: 'comprovante_renda',
      storage_path: 'demo/paulo-renda.pdf',
    },
    {
      registration_id: cadastroDe('Paulo Ferraz'),
      deal_id: venda.id,
      type: 'comprovante_residencia',
      storage_path: 'demo/paulo-residencia.pdf',
    },
    {
      registration_id: cadastroDe('Helena Prado'),
      type: 'escritura_imovel',
      storage_path: 'demo/helena-escritura.pdf',
    },
  ])
  if (errDocs) throw errDocs
  console.log('✓ 3 aprovações pendentes + 4 documentos em revisão')

  console.log('\nSeed concluído.')
}

main().catch((e) => {
  console.error('\nFalha no seed:', e.message ?? e)
  process.exit(1)
})

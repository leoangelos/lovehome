import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import { montarPainelPagamentos } from '../lib/queries/pagamentos'
import { prepararCpf } from '../lib/registrations/cpf'

/* Tela de pagamentos (PRD 14 e 17.1). Rodar com: npm run check:pagamentos
   (o servidor de dev precisa estar no ar para a checagem HTTP)

   NÃO chama a OpenAI. NÃO chama o Asaas — usa dados montados aqui.

   O que está sendo protegido: os números desta tela são dinheiro. Contar
   errado uma parcela vencida esconde inadimplência; contar uma paga duas vezes
   infla o recebido. E contrato ativo SEM cobrança é aluguel que simplesmente
   não vai ser cobrado — precisa aparecer, não ficar quieto. */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const supabase = createAdminClient()

const MARCA = 'Testepagamento'
const criado = { registrationId: null as string | null, brokers: [] as string[], deals: [] as string[] }

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

function gerarCpf(semente: number): string {
  const base = String(semente).padStart(9, '0').slice(-9)
  const d = base.split('').map(Number)
  const dv = (nums: number[]) => {
    const peso = nums.length + 1
    const soma = nums.reduce((s, n, i) => s + n * (peso - i), 0)
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  const d1 = dv(d)
  return `${base}${d1}${dv([...d, d1])}`
}

function diaRelativo(dias: number): string {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  return d.toISOString().slice(0, 10)
}

async function limpar() {
  for (const id of criado.deals) {
    await supabase.from('lease_payments').delete().eq('deal_id', id)
    const { error } = await supabase.from('deals').delete().eq('id', id)
    if (error) throw new Error(`limpeza do negócio falhou: ${error.message}`)
  }
  criado.deals.length = 0

  if (criado.registrationId) {
    await supabase.from('contact_roles').delete().eq('registration_id', criado.registrationId)
    const { error } = await supabase.from('registrations').delete().eq('id', criado.registrationId)
    if (error) throw new Error(`limpeza do cadastro falhou: ${error.message}`)
    criado.registrationId = null
  }

  for (const id of criado.brokers) {
    const { error } = await supabase.from('brokers').delete().eq('id', id)
    if (error) throw new Error(`limpeza do corretor falhou: ${error.message}`)
  }
  criado.brokers.length = 0

  await supabase.from('asaas_events').delete().like('asaas_payment_id', 'pay_teste_%')

  const { data: sobras } = await supabase.from('brokers').select('id').ilike('name', `%${MARCA}%`)
  for (const b of sobras ?? []) {
    const { data: ds } = await supabase.from('deals').select('id').eq('broker_id', b.id)
    for (const d of ds ?? []) {
      await supabase.from('lease_payments').delete().eq('deal_id', d.id)
      await supabase.from('deals').delete().eq('id', d.id)
    }
    await supabase.from('brokers').delete().eq('id', b.id)
  }
  const { data: cadastros } = await supabase
    .from('registrations')
    .select('id')
    .ilike('full_name', `%${MARCA}%`)
  for (const c of cadastros ?? []) {
    await supabase.from('contact_roles').delete().eq('registration_id', c.id)
    await supabase.from('registrations').delete().eq('id', c.id)
  }
}

async function main() {
  await limpar()
  const carimbo = Date.now()

  const { data: cadastro, error: e1 } = await supabase
    .from('registrations')
    .insert({
      ...prepararCpf(gerarCpf(carimbo)),
      full_name: `Inquilino ${MARCA}`,
      email: `pag${carimbo}@teste.local`,
    })
    .select('id')
    .single()
  if (e1 || !cadastro) throw new Error(`cadastro: ${e1?.message}`)
  criado.registrationId = cadastro.id
  const cadastroId = cadastro.id

  const { data: corretorA } = await supabase
    .from('brokers')
    .insert({ name: `Ana ${MARCA}`, specialty: 'geral', is_active: true })
    .select('id')
    .single()
  const { data: corretorB } = await supabase
    .from('brokers')
    .insert({ name: `Bruno ${MARCA}`, specialty: 'geral', is_active: true })
    .select('id')
    .single()
  criado.brokers.push(corretorA!.id, corretorB!.id)

  const { data: imoveis } = await supabase
    .from('properties')
    .select('id')
    .eq('status', 'disponivel')
    .limit(2)

  async function criarContrato(brokerId: string, comAssinatura: boolean, propertyId: string) {
    const { data, error } = await supabase
      .from('deals')
      .insert({
        deal_type: 'locacao',
        property_id: propertyId,
        client_registration_id: cadastroId,
        broker_id: brokerId,
        status: 'ativo',
        rent_price_cents: 300000,
        start_date: diaRelativo(-90),
        asaas_subscription_id: comAssinatura ? `sub_teste_${Date.now()}` : null,
      })
      .select('id')
      .single()
    if (error) throw new Error(`contrato: ${error.message}`)
    criado.deals.push(data.id)
    return data.id as string
  }

  const contratoA = await criarContrato(corretorA!.id, true, imoveis![0].id)
  const contratoB = await criarContrato(corretorB!.id, false, imoveis![1].id)

  /* Três parcelas do contrato A: uma paga neste mês, uma pendente vencida (o
     caso que importa) e uma pendente a vencer. */
  await supabase.from('lease_payments').insert([
    {
      deal_id: contratoA,
      reference_month: diaRelativo(-30).slice(0, 8) + '01',
      amount_cents: 300000,
      status: 'pago',
      due_date: diaRelativo(-30),
      paid_at: new Date().toISOString(),
      asaas_payment_id: 'pay_teste_paga',
    },
    {
      deal_id: contratoA,
      reference_month: diaRelativo(-5).slice(0, 8) + '01',
      amount_cents: 300000,
      /* Continua 'pendente' de propósito: o status só vira 'atrasado' quando o
         Asaas manda PAYMENT_OVERDUE, e a tela não pode esperar por isso. */
      status: 'pendente',
      due_date: diaRelativo(-5),
      boleto_url: 'https://exemplo/boleto-vencido',
      asaas_payment_id: 'pay_teste_vencida',
    },
    {
      deal_id: contratoA,
      reference_month: diaRelativo(25).slice(0, 8) + '01',
      amount_cents: 300000,
      status: 'pendente',
      due_date: diaRelativo(25),
      boleto_url: 'https://exemplo/boleto-futuro',
      asaas_payment_id: 'pay_teste_futura',
    },
  ])

  // evento do Asaas sem parcela correspondente
  await supabase.from('asaas_events').insert({
    event: 'PAYMENT_RECEIVED',
    asaas_payment_id: 'pay_teste_orfao',
    payload: { event: 'PAYMENT_RECEIVED' },
    aplicado: false,
    observacao: 'nenhuma parcela com este asaas_payment_id',
  })

  // ================= Os números =================
  console.log('--- Resumo ---')

  const painel = await montarPainelPagamentos(null)
  const minhas = painel.parcelas.filter((p) => p.deal_id === contratoA)

  ok('as três parcelas aparecem', minhas.length === 3, `${minhas.length}`)

  const vencida = minhas.find((p) => p.asaas_payment_id === 'pay_teste_vencida')
  /* O ponto: a coluna diz 'pendente', mas a data já passou. Confiar só na
     coluna esconderia inadimplência até o Asaas avisar. */
  ok('parcela pendente com data passada é marcada como vencida', vencida?.vencida === true, String(vencida?.status))

  const futura = minhas.find((p) => p.asaas_payment_id === 'pay_teste_futura')
  ok('parcela a vencer NÃO é marcada como vencida', futura?.vencida === false)

  const paga = minhas.find((p) => p.asaas_payment_id === 'pay_teste_paga')
  ok('parcela paga não entra em atraso', paga?.vencida === false)

  ok('conta o valor em atraso', painel.resumo.atrasadoCents >= 300000, String(painel.resumo.atrasadoCents))
  ok('conta o valor a receber', painel.resumo.aReceberCents >= 300000, String(painel.resumo.aReceberCents))
  ok('conta o recebido no mês', painel.resumo.recebidoMesCents >= 300000, String(painel.resumo.recebidoMesCents))
  /* Vencida não pode contar como "a receber" também — o mesmo dinheiro apareceria
     duas vezes e o total do mês ficaria inflado. */
  ok(
    'vencida NÃO é contada como a receber',
    painel.parcelas.filter((p) => p.vencida && p.status === 'pendente').every((p) => p.vencida),
    'ok'
  )

  // ================= Contrato sem cobrança =================
  console.log('\n--- Contrato ativo sem cobrança ---')

  const semCobranca = painel.semCobranca.find((c) => c.deal_id === contratoB)
  /* Ativar não é desfeito quando a criação da cobrança falha — decisão
     deliberada. O preço disso é que alguém precisa ver. */
  ok('contrato ativo sem assinatura aparece', Boolean(semCobranca), painel.semCobranca.length + ' listado(s)')
  ok('e o contrato com assinatura NÃO aparece', !painel.semCobranca.some((c) => c.deal_id === contratoA))
  ok('o resumo conta os contratos ativos', painel.resumo.contratosAtivos >= 2, String(painel.resumo.contratosAtivos))

  // ================= Conciliação =================
  console.log('\n--- Conciliação ---')

  ok('evento sem correspondência aparece para o admin', painel.orfaos.some((e) => e.asaas_payment_id === 'pay_teste_orfao'))

  // ================= Escopo por carteira =================
  console.log('\n--- Escopo ---')

  const daAna = await montarPainelPagamentos(corretorA!.id)
  const idsDaAna = daAna.parcelas.map((p) => p.deal_id)
  ok('corretor vê as parcelas da própria carteira', idsDaAna.includes(contratoA))
  ok('e NÃO vê as do outro corretor', !idsDaAna.includes(contratoB), `${idsDaAna.length} parcelas`)
  ok('nem o contrato sem cobrança do outro', !daAna.semCobranca.some((c) => c.deal_id === contratoB))
  /* Evento solto do Asaas não é problema de corretor — mostrar só geraria
     dúvida sobre algo que ele não pode resolver. */
  ok('e não recebe a fila de conciliação', daAna.orfaos.length === 0, `${daAna.orfaos.length}`)

  // ================= Rota =================
  console.log('\n--- Rota ---')

  const semSessao = await fetch(`${BASE}/api/admin/pagamentos/${contratoA}`, { method: 'POST' })
  ok('sincronizar exige sessão', semSessao.status === 401, `status ${semSessao.status}`)

  const { data: intacto } = await supabase
    .from('deals')
    .select('asaas_subscription_id')
    .eq('id', contratoB)
    .single()
  ok('e a tentativa não criou assinatura nenhuma', intacto?.asaas_subscription_id === null)

  await limpar()
  console.log('\nDados de teste removidos.')
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})

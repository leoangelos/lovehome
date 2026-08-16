import 'dotenv/config'
import crypto from 'crypto'
import { createAdminClient } from '../lib/supabase/admin'
import { prepararCpf } from '../lib/registrations/cpf'
import { testarAsaas, emProducao, chamarAsaas } from '../lib/asaas/client'
import { garantirClienteAsaas, removerClienteAsaas } from '../lib/asaas/customers'
import { criarAssinaturaDoNegocio, cancelarAssinatura, traduzirStatus } from '../lib/asaas/cobranca'

/* Integração Asaas (PRD 14). Rodar com: npm run check:asaas
   (o servidor de dev precisa estar no ar para as checagens de webhook)

   NÃO chama a OpenAI. CHAMA O ASAAS DE VERDADE — cria cliente, assinatura e
   cobrança, e apaga tudo no fim.

   RECUSA RODAR EM PRODUÇÃO. Em sandbox o estrago é zero; em produção seria uma
   cobrança real na conta de alguém. */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const supabase = createAdminClient()

const MARCA = 'Testeasaas'
const criado = {
  registrationId: null as string | null,
  dealId: null as string | null,
  customerId: null as string | null,
  subscriptionId: null as string | null,
  paymentIds: [] as string[],
}

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

/** CPF sintético com dígitos verificadores corretos — o Asaas valida. */
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

async function limpar() {
  // Asaas primeiro: apagar a linha daqui antes perderia o id e deixaria lixo lá.
  if (criado.subscriptionId) {
    await cancelarAssinatura(criado.subscriptionId)
    criado.subscriptionId = null
  }
  if (criado.customerId) {
    await removerClienteAsaas(criado.customerId)
    criado.customerId = null
  }

  for (const id of criado.paymentIds) {
    await supabase.from('asaas_events').delete().eq('asaas_payment_id', id)
  }
  criado.paymentIds.length = 0

  if (criado.dealId) {
    await supabase.from('lease_payments').delete().eq('deal_id', criado.dealId)
    const { error } = await supabase.from('deals').delete().eq('id', criado.dealId)
    if (error) throw new Error(`limpeza do negócio falhou: ${error.message}`)
    criado.dealId = null
  }

  if (criado.registrationId) {
    await supabase.from('contact_roles').delete().eq('registration_id', criado.registrationId)
    const { error } = await supabase.from('registrations').delete().eq('id', criado.registrationId)
    if (error) throw new Error(`limpeza do cadastro falhou: ${error.message}`)
    criado.registrationId = null
  }

  const { data: sobras } = await supabase
    .from('registrations')
    .select('id, asaas_customer_id')
    .ilike('full_name', `%${MARCA}%`)
  for (const s of sobras ?? []) {
    if (s.asaas_customer_id) await removerClienteAsaas(s.asaas_customer_id)
    await supabase.from('contact_roles').delete().eq('registration_id', s.id)
    await supabase.from('registrations').delete().eq('id', s.id)
  }
}

async function main() {
  // ================= Trava de segurança =================
  console.log('--- Ambiente ---')

  /* Se isto passar a ser produção, o teste cria cobrança de verdade para um CPF
     inventado na conta da imobiliária. Recusar é a única resposta. */
  if (emProducao()) {
    console.error('erro: ASAAS_BASE_URL aponta para PRODUÇÃO. Este teste só roda em sandbox.')
    process.exit(1)
  }
  ok('rodando contra o sandbox', !emProducao())

  const conexao = await testarAsaas()
  ok('a credencial do Asaas funciona', conexao.ok === true, conexao.mensagem)
  if (!conexao.ok) {
    console.error('Sem credencial válida não há o que testar.')
    process.exit(1)
  }
  console.log(`INFO  conta: ${conexao.detalhe ?? '—'}`)

  await limpar()

  // ================= CPF só é aberto em dois lugares =================
  console.log('\n--- Onde o CPF é descriptografado ---')

  const arquivos = ['lib/leasing/contract-template.ts', 'lib/asaas/customers.ts']
  const { execSync } = await import('child_process')
  const saida = execSync('grep -rln "decryptSecret" lib/ --include=*.ts', { encoding: 'utf-8' })
  const usam = saida
    .split('\n')
    .map((l) => l.trim().replace(/\\/g, '/'))
    .filter(Boolean)
    .filter((f) => !f.endsWith('lib/crypto/encrypt.ts') && !f.endsWith('lib/channels/config.ts'))

  /* Contrato precisa do número inteiro porque é documento legal; o Asaas
     precisa porque cobrança no Brasil exige documento. Um terceiro lugar é bug
     até prova em contrário. */
  ok(
    'só os dois lugares previstos abrem o CPF',
    usam.every((f) => arquivos.some((a) => f.endsWith(a))),
    usam.join(', ')
  )

  // ================= Cliente =================
  console.log('\n--- Cliente no Asaas ---')

  const carimbo = Date.now()
  const { data: cadastro, error: erroCadastro } = await supabase
    .from('registrations')
    .insert({
      ...prepararCpf(gerarCpf(carimbo)),
      full_name: `Cliente ${MARCA}`,
      email: `asaas${carimbo}@teste.local`,
      address: { street: 'Rua Teste', number: '100', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', zip: '01310-100' },
    })
    .select('id')
    .single()
  if (erroCadastro) throw new Error(`cadastro: ${erroCadastro.message}`)
  criado.registrationId = cadastro.id

  const cliente = await garantirClienteAsaas(cadastro.id)
  ok('cria o cliente', cliente.ok === true && cliente.criado === true, JSON.stringify(cliente))
  if (!cliente.ok) throw new Error('sem cliente não há como seguir')
  criado.customerId = cliente.customerId

  const { data: comCliente } = await supabase
    .from('registrations')
    .select('asaas_customer_id')
    .eq('id', cadastro.id)
    .single()
  ok('guarda o id no cadastro', comCliente?.asaas_customer_id === cliente.customerId)

  /* É isto que impede a descriptografia de virar rotina: da segunda vez em
     diante o CPF nem é lido. */
  const segundaVez = await garantirClienteAsaas(cadastro.id)
  ok('segunda chamada NÃO cria outro cliente', segundaVez.ok === true && segundaVez.criado === false)
  ok('e devolve o mesmo id', segundaVez.ok === true && segundaVez.customerId === cliente.customerId)

  // ================= Assinatura =================
  console.log('\n--- Assinatura de aluguel ---')

  const { data: imovel } = await supabase
    .from('properties')
    .select('id')
    .eq('status', 'disponivel')
    .limit(1)
    .single()

  const { data: negocio, error: erroNegocio } = await supabase
    .from('deals')
    .insert({
      deal_type: 'locacao',
      property_id: imovel!.id,
      client_registration_id: cadastro.id,
      status: 'aprovado',
      rent_price_cents: 320000,
      start_date: new Date().toISOString().slice(0, 10),
    })
    .select('id')
    .single()
  if (erroNegocio) throw new Error(`negócio: ${erroNegocio.message}`)
  criado.dealId = negocio.id

  /* A assinatura nasce da ATIVAÇÃO. Criar antes cobraria alguém por um contrato
     que ainda não foi assinado. */
  const cedoDemais = await criarAssinaturaDoNegocio(negocio.id)
  ok('negócio ainda não ativo é recusado', cedoDemais.ok === false, JSON.stringify(cedoDemais))

  await supabase.from('deals').update({ status: 'ativo' }).eq('id', negocio.id)

  const assinatura = await criarAssinaturaDoNegocio(negocio.id)
  ok('cria a assinatura no contrato ativo', assinatura.ok === true, JSON.stringify(assinatura))
  if (!assinatura.ok) throw new Error('sem assinatura não há como seguir')
  criado.subscriptionId = assinatura.subscriptionId

  ok('gerou parcela', assinatura.parcelas > 0, `${assinatura.parcelas}`)

  const denovo = await criarAssinaturaDoNegocio(negocio.id)
  /* Reativar ou reprocessar não pode criar uma segunda assinatura — seriam duas
     cobranças mensais para o mesmo aluguel. */
  ok('não cria uma segunda assinatura', denovo.ok === true && denovo.jaExistia === true && denovo.subscriptionId === assinatura.subscriptionId)

  const { data: parcelas } = await supabase
    .from('lease_payments')
    .select('id, asaas_payment_id, amount_cents, status, due_date, boleto_url')
    .eq('deal_id', negocio.id)

  ok('a parcela virou linha em lease_payments', (parcelas ?? []).length > 0, `${parcelas?.length}`)

  const parcela = parcelas?.[0]
  if (parcela) {
    criado.paymentIds.push(parcela.asaas_payment_id!)
    ok('com o valor do aluguel', parcela.amount_cents === 320000, String(parcela.amount_cents))
    ok('nasce pendente', parcela.status === 'pendente', parcela.status)
    ok('com link de pagamento', Boolean(parcela.boleto_url))
    /* Vencimento retroativo nasceria atrasado no mesmo dia. */
    ok('e vencimento no futuro', new Date(`${parcela.due_date}T23:59:59`) > new Date(), parcela.due_date)
  }

  // ================= Tradução de status =================
  console.log('\n--- Tradução de status ---')

  ok('RECEIVED vira pago', traduzirStatus('RECEIVED') === 'pago')
  ok('CONFIRMED vira pago', traduzirStatus('CONFIRMED') === 'pago')
  ok('OVERDUE vira atrasado', traduzirStatus('OVERDUE') === 'atrasado')
  ok('REFUNDED vira cancelado', traduzirStatus('REFUNDED') === 'cancelado')
  /* Status desconhecido cair em 'pago' sumiria com a cobrança da inadimplência
     sem ela ter sido recebida. */
  ok('status desconhecido vira pendente', traduzirStatus('STATUS_QUE_NAO_EXISTE') === 'pendente')

  // ================= Webhook =================
  console.log('\n--- Webhook ---')

  const token = process.env.ASAAS_WEBHOOK_TOKEN!
  const idCobranca = parcela!.asaas_payment_id!

  function corpo(evento: string, status: string) {
    return {
      id: `evt_${crypto.randomBytes(6).toString('hex')}`,
      event: evento,
      payment: { id: idCobranca, status, value: 3200, dueDate: parcela!.due_date, paymentDate: '2026-08-16' },
    }
  }

  async function postar(body: unknown, comToken?: string) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (comToken) headers['asaas-access-token'] = comToken
    const r = await fetch(`${BASE}/api/webhook/asaas`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    return { status: r.status, corpo: await r.json().catch(() => ({})) }
  }

  const semToken = await postar(corpo('PAYMENT_RECEIVED', 'RECEIVED'))
  ok('POST sem token é recusado', semToken.status === 401, `status ${semToken.status}`)

  const tokenErrado = await postar(corpo('PAYMENT_RECEIVED', 'RECEIVED'), 'token-errado-qualquer')
  ok('POST com token errado é recusado', tokenErrado.status === 401)

  const { data: aindaPendente } = await supabase
    .from('lease_payments')
    .select('status')
    .eq('id', parcela!.id)
    .single()
  ok('nenhuma tentativa recusada mexeu na parcela', aindaPendente?.status === 'pendente')

  const valido = await postar(corpo('PAYMENT_RECEIVED', 'RECEIVED'), token)
  ok('token correto é aceito', valido.status === 200, JSON.stringify(valido.corpo))
  ok('e aplica na parcela', valido.corpo.status === 'aplicado', JSON.stringify(valido.corpo))

  const { data: paga } = await supabase
    .from('lease_payments')
    .select('status, paid_at')
    .eq('id', parcela!.id)
    .single()
  ok('a parcela virou paga', paga?.status === 'pago', paga?.status ?? '')
  ok('com data de pagamento', Boolean(paga?.paid_at))

  /* O Asaas reentrega em timeout. Sem dedup, um evento de estorno reprocessado
     desfaria o estado errado. */
  const repetido = await postar(corpo('PAYMENT_RECEIVED', 'RECEIVED'), token)
  ok('reentrega do mesmo evento é descartada', repetido.corpo.status === 'duplicado', JSON.stringify(repetido.corpo))

  const desconhecida = await postar(
    {
      id: 'evt_desconhecido',
      event: 'PAYMENT_OVERDUE',
      payment: { id: 'pay_que_nao_existe_aqui', status: 'OVERDUE' },
    },
    token
  )
  criado.paymentIds.push('pay_que_nao_existe_aqui')
  /* Cobrança criada direto no painel do Asaas: fica registrada como não
     aplicada. É sinal de conciliação pendente, não de webhook quebrado. */
  ok('cobrança desconhecida é registrada sem aplicar', desconhecida.corpo.status === 'sem_correspondencia', JSON.stringify(desconhecida.corpo))

  const { data: evento } = await supabase
    .from('asaas_events')
    .select('aplicado, observacao, payload')
    .eq('asaas_payment_id', 'pay_que_nao_existe_aqui')
    .maybeSingle()
  ok('marcada como não aplicada', evento?.aplicado === false)
  /* Sem o payload cru, "o que o Asaas mandou mesmo?" não tem resposta. */
  ok('e o payload cru foi guardado', Boolean(evento?.payload))

  const semEfeito = await postar(
    { id: 'evt_assinatura', event: 'SUBSCRIPTION_CREATED', payment: null },
    token
  )
  ok('evento sem cobrança responde 200', semEfeito.status === 200, JSON.stringify(semEfeito.corpo))
  await supabase.from('asaas_events').delete().eq('event', 'SUBSCRIPTION_CREATED')

  const get = await fetch(`${BASE}/api/webhook/asaas`)
  ok('GET responde 200 (o Asaas confere a URL ao cadastrar)', get.status === 200)

  // ================= Limpeza =================
  await limpar()

  const { data: sobrouCliente } = await chamarAsaas<{ deleted?: boolean }>(`/customers/${cliente.customerId}`)
    .then((r) => ({ data: r.dados }))
  ok('o cliente foi removido do sandbox', sobrouCliente?.deleted === true, JSON.stringify(sobrouCliente))

  console.log('\nDados de teste removidos, aqui e no Asaas.')
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})

import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import { prepararCpf } from '../lib/registrations/cpf'
import {
  handleConfirmarTitularidade,
  handleGetPaymentStatement,
  handleGetLeaseStatus,
  handleRequestLeaseTermination,
  titularConfirmado,
  limparConfirmacao,
} from '../lib/agents/tools/suporte'
import { runSuporteAgent } from '../lib/agents/suporte'
import type { ContactRole } from '../lib/types/domain'

/* Agente Suporte (PRD 12.6). Rodar com: npm run check:suporte
   Não precisa do servidor de dev.

   CHAMA A OPENAI uma vez, no fim.

   O que está sendo protegido: este é o agente que fala de dinheiro e contrato.
   A §12.6 manda confirmar o CPF antes de expor qualquer dado — e aqui isso é
   MECANISMO, não instrução de prompt. Deixar no texto repetiria o erro que o
   projeto já cometeu três vezes: o modelo esquece, e o esquecimento entrega
   extrato e boleto de alguém para quem estiver com o celular na mão. */

const supabase = createAdminClient()
const MARCA = 'Testesuporte'
const TELEFONE = '5511977011001'
const ALUGUEL = 320000

const criado = { registrationId: null as string | null, contactId: null as string | null, dealId: null as string | null }

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

async function limpar() {
  if (criado.contactId) await limparConfirmacao(criado.contactId)

  if (criado.dealId) {
    await supabase.from('lease_payments').delete().eq('deal_id', criado.dealId)
    const { error } = await supabase.from('deals').delete().eq('id', criado.dealId)
    if (error) throw new Error(`limpeza do negócio falhou: ${error.message}`)
    criado.dealId = null
  }
  if (criado.contactId) {
    const { error } = await supabase.from('contacts').delete().eq('id', criado.contactId)
    if (error) throw new Error(`limpeza do contato falhou: ${error.message}`)
    criado.contactId = null
  }
  if (criado.registrationId) {
    await supabase.from('contact_roles').delete().eq('registration_id', criado.registrationId)
    const { error } = await supabase.from('registrations').delete().eq('id', criado.registrationId)
    if (error) throw new Error(`limpeza do cadastro falhou: ${error.message}`)
    criado.registrationId = null
  }

  const { data: sobras } = await supabase.from('registrations').select('id').ilike('full_name', `%${MARCA}%`)
  for (const s of sobras ?? []) {
    const { data: cs } = await supabase.from('contacts').select('id').eq('registration_id', s.id)
    for (const c of cs ?? []) await supabase.from('contacts').delete().eq('id', c.id)
    const { data: ds } = await supabase.from('deals').select('id').eq('client_registration_id', s.id)
    for (const d of ds ?? []) {
      await supabase.from('lease_payments').delete().eq('deal_id', d.id)
      await supabase.from('deals').delete().eq('id', d.id)
    }
    await supabase.from('contact_roles').delete().eq('registration_id', s.id)
    await supabase.from('registrations').delete().eq('id', s.id)
  }
}

async function main() {
  await limpar()

  const carimbo = Date.now()
  const CPF_TITULAR = gerarCpf(carimbo)
  const CPF_DE_OUTRO = gerarCpf(carimbo + 4242)

  // ---- inquilino com contrato ativo e parcelas ----
  const { data: cadastro, error: e1 } = await supabase
    .from('registrations')
    .insert({
      ...prepararCpf(CPF_TITULAR),
      full_name: `Joana ${MARCA} Ribeiro`,
      email: `suporte${carimbo}@teste.local`,
      address: { city: 'São Paulo', state: 'SP' },
    })
    .select('id')
    .single()
  if (e1) throw new Error(`cadastro: ${e1.message}`)
  criado.registrationId = cadastro.id

  await supabase.from('contact_roles').insert({ registration_id: cadastro.id, role: 'inquilino_ativo' })

  const { data: contato, error: e2 } = await supabase
    .from('contacts')
    .insert({
      phone: TELEFONE,
      phone_key: TELEFONE.slice(-8),
      name: `Joana ${MARCA}`,
      registration_id: cadastro.id,
      registration_status: 'completo',
      funnel_stage: 'convertido',
    })
    .select('id')
    .single()
  if (e2) throw new Error(`contato: ${e2.message}`)
  criado.contactId = contato.id

  const { data: imovel } = await supabase
    .from('properties')
    .select('id')
    .eq('status', 'disponivel')
    .limit(1)
    .single()

  const { data: negocio, error: e3 } = await supabase
    .from('deals')
    .insert({
      deal_type: 'locacao',
      property_id: imovel!.id,
      client_registration_id: cadastro.id,
      status: 'ativo',
      rent_price_cents: ALUGUEL,
      start_date: '2026-01-10',
      notice_period_days: 30,
    })
    .select('id')
    .single()
  if (e3) throw new Error(`negócio: ${e3.message}`)
  criado.dealId = negocio.id

  await supabase.from('lease_payments').insert([
    { deal_id: negocio.id, reference_month: '2026-07-01', amount_cents: ALUGUEL, status: 'pago', due_date: '2026-07-10', paid_at: '2026-07-09T12:00:00Z', boleto_url: 'https://exemplo/boleto-julho' },
    { deal_id: negocio.id, reference_month: '2026-08-01', amount_cents: ALUGUEL, status: 'atrasado', due_date: '2026-08-10', boleto_url: 'https://exemplo/boleto-agosto' },
  ])

  const CADASTRO = { status: 'completo' as const, registrationId: cadastro.id, roles: ['inquilino_ativo'] as ContactRole[], nomeCompleto: `Joana ${MARCA} Ribeiro` }

  // ================= Sem confirmar, nada sai =================
  console.log('--- A tranca ---')

  ok('começa sem titularidade confirmada', (await titularConfirmado(contato.id)) === false)

  const extratoSemConfirmar = (await handleGetPaymentStatement(contato.id, {})) as { erro?: string }
  const contratoSemConfirmar = (await handleGetLeaseStatus(contato.id)) as { erro?: string }
  const rescisaoSemConfirmar = (await handleRequestLeaseTermination(contato.id, { data_pretendida: '2026-12-01' })) as { erro?: string }

  /* Se qualquer uma destas passar, extrato e boleto saem para quem estiver com
     o aparelho na mão. */
  ok('extrato é recusado sem confirmação', extratoSemConfirmar.erro === 'titularidade_nao_confirmada')
  ok('contrato é recusado sem confirmação', contratoSemConfirmar.erro === 'titularidade_nao_confirmada')
  ok('rescisão é recusada sem confirmação', rescisaoSemConfirmar.erro === 'titularidade_nao_confirmada')

  const bruto = JSON.stringify([extratoSemConfirmar, contratoSemConfirmar, rescisaoSemConfirmar])
  ok('e a recusa não vaza valor nem data do contrato', !bruto.includes('3.200') && !bruto.includes('320000'))

  // ================= Confirmação =================
  console.log('\n--- Confirmação de CPF ---')

  const invalido = (await handleConfirmarTitularidade(contato.id, { cpf: '111' })) as { confirmado: boolean }
  ok('CPF malformado é recusado', invalido.confirmado === false)

  const deOutro = (await handleConfirmarTitularidade(contato.id, { cpf: CPF_DE_OUTRO })) as { confirmado: boolean; instrucao: string }
  ok('CPF de outra pessoa é recusado', deOutro.confirmado === false)
  /* Dizer "não é esse, é o terminado em X" seria entregar o dado que a tranca
     existe para proteger. */
  ok('e a recusa NÃO revela o CPF certo', !JSON.stringify(deOutro).includes(CPF_TITULAR.slice(-4)), deOutro.instrucao.slice(0, 50))
  ok('continua sem confirmação', (await titularConfirmado(contato.id)) === false)

  const certo = (await handleConfirmarTitularidade(contato.id, { cpf: CPF_TITULAR })) as { confirmado: boolean; nome: string }
  ok('CPF do titular confirma', certo.confirmado === true, JSON.stringify(certo))
  ok('devolve só o primeiro nome', certo.nome === 'Joana', certo.nome)
  ok('a confirmação fica registrada', (await titularConfirmado(contato.id)) === true)

  /* CPF com máscara é como a pessoa digita de verdade. */
  await limparConfirmacao(contato.id)
  const formatado = CPF_TITULAR.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  const comMascara = (await handleConfirmarTitularidade(contato.id, { cpf: formatado })) as { confirmado: boolean }
  ok('aceita CPF com pontos e traço', comMascara.confirmado === true, formatado)

  // ================= Com confirmação, os dados saem =================
  console.log('\n--- Extrato e contrato ---')

  const extrato = (await handleGetPaymentStatement(contato.id, {})) as {
    encontrado: boolean
    parcelas: { competencia: string; situacao: string; segunda_via: string | null }[]
    em_aberto: number
  }
  ok('o extrato sai', extrato.encontrado === true)
  ok('traz as duas parcelas', extrato.parcelas.length === 2, `${extrato.parcelas.length}`)
  ok('conta o que está em aberto', extrato.em_aberto === 1, String(extrato.em_aberto))

  const paga = extrato.parcelas.find((p) => p.situacao === 'pago')
  const atrasada = extrato.parcelas.find((p) => p.situacao === 'atrasado')
  /* Segunda via de parcela já paga confunde, e às vezes faz pagar de novo. */
  ok('parcela paga NÃO traz link de segunda via', paga?.segunda_via === null)
  ok('parcela em aberto traz o link', Boolean(atrasada?.segunda_via))

  const contrato = (await handleGetLeaseStatus(contato.id)) as {
    encontrado: boolean
    aluguel: string
    aviso_previo_dias: number
  }
  ok('o contrato sai', contrato.encontrado === true)
  ok('com o valor certo', contrato.aluguel.includes('3.200'), contrato.aluguel)
  ok('e o aviso prévio', contrato.aviso_previo_dias === 30)

  // ================= Rescisão =================
  console.log('\n--- Rescisão e aviso prévio ---')

  const amanha = new Date()
  amanha.setDate(amanha.getDate() + 1)

  const cedoDemais = (await handleRequestLeaseTermination(contato.id, {
    data_pretendida: amanha.toISOString().slice(0, 10),
  })) as { registrado: boolean; data_minima?: string }

  /* O aviso prévio tem efeito contratual: registrar data menor criaria
     expectativa que o contrato não sustenta, e desfazer depois é conversa
     difícil. Por isso a validação é aqui, não no prompt. */
  ok('data antes do aviso prévio é recusada', cedoDemais.registrado === false)
  ok('e a tool informa a data mínima', Boolean(cedoDemais.data_minima), cedoDemais.data_minima ?? '')

  const { data: intacto } = await supabase.from('deals').select('status').eq('id', negocio.id).single()
  ok('o contrato NÃO foi alterado pela tentativa', intacto?.status === 'ativo', intacto?.status ?? '')

  const daquiA60 = new Date()
  daquiA60.setDate(daquiA60.getDate() + 60)
  const registrada = (await handleRequestLeaseTermination(contato.id, {
    data_pretendida: daquiA60.toISOString().slice(0, 10),
    motivo: 'vai morar em outra cidade',
  })) as { registrado: boolean; data_efetiva?: string; instrucao: string }

  ok('data válida é registrada', registrada.registrado === true, JSON.stringify(registrada).slice(0, 80))

  const { data: comRescisao } = await supabase
    .from('deals')
    .select('status, termination_requested_at, termination_effective_date')
    .eq('id', negocio.id)
    .single()
  ok('o contrato mudou de estado', comRescisao?.status === 'encerramento_solicitado', comRescisao?.status ?? '')
  ok('com a data efetiva gravada', comRescisao?.termination_effective_date === daquiA60.toISOString().slice(0, 10))
  /* Caução e multa quem calcula é a equipe — prometer aqui vira dívida. */
  ok('a instrução proíbe prometer caução ou multa', /caução|multa/i.test(registrada.instrucao))

  const denovo = (await handleRequestLeaseTermination(contato.id, {
    data_pretendida: daquiA60.toISOString().slice(0, 10),
  })) as { registrado: boolean; ja_solicitado?: boolean }
  ok('pedir rescisão duas vezes não duplica', denovo.registrado === false && denovo.ja_solicitado === true)

  // ================= Força bruta =================
  console.log('\n--- Tentativas repetidas ---')

  await limparConfirmacao(contato.id)
  let bloqueou = false
  for (let i = 0; i < 7; i++) {
    const r = (await handleConfirmarTitularidade(contato.id, { cpf: CPF_DE_OUTRO })) as { instrucao: string }
    if (/escalate_to_human/.test(r.instrucao)) {
      bloqueou = true
      break
    }
  }
  ok('tentativas demais param de pedir CPF e escalam', bloqueou)

  /* Estar bloqueado não pode virar um jeito de contornar a tranca. */
  const aindaBarrado = (await handleGetPaymentStatement(contato.id, {})) as { erro?: string }
  ok('e mesmo assim o extrato continua barrado', aindaBarrado.erro === 'titularidade_nao_confirmada')

  // ================= O agente de verdade =================
  console.log('\n--- Agente rodando (CHAMA A OPENAI) ---')

  await limparConfirmacao(contato.id)
  const resposta = await runSuporteAgent(
    contato.id,
    'Oi, quanto está o meu boleto desse mês? Pode me mandar a segunda via?',
    CADASTRO
  )
  console.log(`\n> ${resposta.content.slice(0, 200)}\n`)

  /* A prova de que a tranca vale na conversa real: ele pede o CPF antes de
     dizer qualquer valor. */
  ok('o agente pede o CPF antes de responder', /cpf/i.test(resposta.content))
  ok('e NÃO adianta o valor do aluguel', !resposta.content.includes('3.200') && !resposta.content.includes('3200'), resposta.content.slice(0, 60))
  ok('nem manda o link do boleto', !resposta.content.includes('exemplo/boleto'))
  ok('a tool de confirmação foi oferecida, não a de extrato', !resposta.toolsUsed.includes('get_payment_statement'), resposta.toolsUsed.join(', '))

  await limpar()
  console.log('\nDados de teste removidos.')
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})

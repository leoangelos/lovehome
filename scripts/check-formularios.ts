import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import { submeterCadastro } from '../lib/registrations/form'
import { hashCpf } from '../lib/registrations/cpf'
import { decidirConferencia } from '../lib/registrations/conferencia'
import { listarFormularios, aguardandoConferencia } from '../lib/queries/formularios'
import crypto from 'crypto'

/* Fila de conferência de CPF já cadastrado (PRD 6.5).
   Rodar com: npm run check:formularios
   (o servidor de dev precisa estar no ar para a checagem HTTP)

   NÃO chama a OpenAI.

   O que está sendo protegido: o formulário público coleta CPF e o token está
   preso a um número de WhatsApp. Se um CPF já cadastrado vinculasse sozinho,
   qualquer um poderia conversar com o bot, pedir o link, digitar o CPF de outra
   pessoa e passar a consultar contrato e boleto dela pelo agente Suporte.
   Este script existe para que esse caminho continue fechado. */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const TELEFONE_A = '5511977002001' // numero novo que digita CPF de terceiro
const TELEFONE_B = '5511977002002' // cadastro comum, CPF inedito
const TELEFONE_TITULAR = '5511977002003' // dono do CPF que sera repetido
const supabase = createAdminClient()

const criados = { contatos: [] as string[], cadastros: [] as string[], submissoes: [] as string[] }

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

/** CPF sintético com dígitos verificadores corretos — cpfValido() recusa o resto. */
function gerarCpf(semente: number): string {
  const base = String(semente).padStart(9, '0').slice(-9)
  const digitos = base.split('').map(Number)
  const dv = (nums: number[]) => {
    const peso = nums.length + 1
    const soma = nums.reduce((s, n, i) => s + n * (peso - i), 0)
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  const d1 = dv(digitos)
  const d2 = dv([...digitos, d1])
  return `${base}${d1}${d2}`
}

async function limpar() {
  /* Os TRES telefones. Deixar um de fora daqui faz a linha sobreviver entre
     execucoes e a proxima estourar em contacts_phone_key_key — a limpeza
     parece funcionar e o dado vai se acumulando. */
  for (const t of [TELEFONE_A, TELEFONE_B, TELEFONE_TITULAR]) {
    const { data } = await supabase.from('contacts').select('id').eq('phone', t)
    for (const c of data ?? []) {
      await supabase.from('form_submissions').delete().eq('contact_id', c.id)
      const { error } = await supabase.from('contacts').delete().eq('id', c.id)
      if (error) throw new Error(`limpeza do contato falhou: ${error.message}`)
    }
  }
  for (const id of criados.submissoes) await supabase.from('form_submissions').delete().eq('id', id)
  for (const id of criados.cadastros) {
    await supabase.from('form_submissions').delete().eq('registration_id', id)
    await supabase.from('contact_roles').delete().eq('registration_id', id)
    await supabase.from('registrations').delete().eq('id', id)
  }
  criados.contatos.length = 0
  criados.cadastros.length = 0
  criados.submissoes.length = 0
}

async function criarContato(phone: string, nome: string) {
  const { data, error } = await supabase
    .from('contacts')
    .insert({ phone, phone_key: phone.slice(-8), name: nome })
    .select('id')
    .single()
  if (error) throw new Error(`contato: ${error.message}`)
  criados.contatos.push(data.id)
  return data.id as string
}

async function criarToken(contactId: string) {
  const token = crypto.randomBytes(32).toString('base64url')
  const { data, error } = await supabase
    .from('form_submissions')
    .insert({
      form_type: 'cadastro',
      contact_id: contactId,
      token,
      status: 'pendente',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    })
    .select('id')
    .single()
  if (error) throw new Error(`token: ${error.message}`)
  criados.submissoes.push(data.id)
  return { token, id: data.id as string }
}

const endereco = {
  street: 'Rua Teste',
  number: '100',
  neighborhood: 'Centro',
  city: 'São Paulo',
  state: 'SP',
  zip: '01000-000',
}

async function main() {
  await limpar()
  const carimbo = Date.now()
  const cpfTitular = gerarCpf(carimbo)
  const cpfNovo = gerarCpf(carimbo + 12345)

  // ================= Caminho feliz: CPF novo =================
  console.log('--- CPF novo: cadastra e vincula sozinho ---')

  const contatoB = await criarContato(TELEFONE_B, 'Cliente CPF Novo')
  const tokenB = await criarToken(contatoB)

  const novo = await submeterCadastro(tokenB.token, {
    cpf: cpfNovo,
    full_name: 'Cliente CPF Novo',
    email: `novo${carimbo}@teste.local`,
    address: endereco,
    roles: ['interessado'],
  })

  ok('CPF inédito é aceito direto', novo.ok === true, JSON.stringify(novo))
  if (novo.ok === true) criados.cadastros.push(novo.registrationId)

  const { data: cB } = await supabase
    .from('contacts')
    .select('registration_id, registration_status')
    .eq('id', contatoB)
    .single()
  ok('contato ficou vinculado', Boolean(cB?.registration_id) && cB?.registration_status === 'completo')

  // ================= CPF repetido: retém =================
  console.log('\n--- CPF já cadastrado: retém para conferência ---')

  // O titular original: outro cadastro, com o mesmo CPF que será digitado.
  const contatoTitular = await criarContato(TELEFONE_TITULAR, 'Titular Original')
  const tokenTitular = await criarToken(contatoTitular)
  const titular = await submeterCadastro(tokenTitular.token, {
    cpf: cpfTitular,
    full_name: 'Titular Original',
    email: `titular${carimbo}@teste.local`,
    address: endereco,
    roles: ['interessado'],
  })
  if (titular.ok !== true) throw new Error(`titular não cadastrou: ${JSON.stringify(titular)}`)
  criados.cadastros.push(titular.registrationId)

  // Agora OUTRO número de WhatsApp digita o MESMO CPF.
  const contatoA = await criarContato(TELEFONE_A, 'Numero Novo')
  const tokenA = await criarToken(contatoA)

  const retida = await submeterCadastro(tokenA.token, {
    cpf: cpfTitular,
    full_name: 'Titular Original',
    email: `outro${carimbo}@teste.local`,
    address: endereco,
    roles: ['proprietario'],
  })

  ok('CPF repetido NÃO cadastra nem vincula', retida.ok === 'revisao', JSON.stringify(retida))

  const { data: cA } = await supabase
    .from('contacts')
    .select('registration_id, registration_status')
    .eq('id', contatoA)
    .single()
  /* O ponto central de todo o mecanismo: o número novo continua sem acesso. */
  ok('o número novo continua SEM cadastro vinculado', cA?.registration_id === null, String(cA?.registration_id))

  const { count: quantos } = await supabase
    .from('registrations')
    .select('id', { count: 'exact', head: true })
    .eq('email', `outro${carimbo}@teste.local`)
  ok('não criou um segundo cadastro com o mesmo CPF', quantos === 0, `${quantos}`)

  const { data: sub } = await supabase
    .from('form_submissions')
    .select('payload, registration_id')
    .eq('id', tokenA.id)
    .single()
  const payload = sub!.payload as Record<string, unknown>

  ok('submissão marcada para revisão', payload.motivo_revisao === 'cpf_ja_cadastrado')
  ok('guardou QUAL cadastro conflitou', payload.registration_id_conflito === titular.registrationId)
  ok('submissão não fica com registration_id (isso é vínculo)', sub!.registration_id === null)

  /* O payload vai para a tela do painel. CPF não pode viajar junto — nem em
     claro, nem formatado, nem em hash (que é identificador pseudônimo estável e
     permitiria cruzar submissões entre si). Conferir por substring "cpf" não
     serve: a própria chave motivo_revisao vale 'cpf_ja_cadastrado'. O que se
     verifica é o VALOR. */
  const bruto = JSON.stringify(payload)
  const formatado = cpfTitular.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  const chavesProibidas = ['cpf', 'cpf_hash', 'cpf_encrypted', 'cpf_last4']

  ok(
    'payload não carrega o CPF em claro',
    !bruto.includes(cpfTitular) && !bruto.includes(formatado)
  )
  ok('payload não carrega o hash do CPF', !bruto.includes(hashCpf(cpfTitular)))
  ok(
    'payload não tem campo de CPF',
    !chavesProibidas.some((k) => k in payload),
    Object.keys(payload).join(', ')
  )

  // ================= A tela enxerga o caso =================
  console.log('\n--- Fila do painel ---')

  const lista = await listarFormularios()
  const naFila = aguardandoConferencia(lista)
  const linha = naFila.find((l) => l.id === tokenA.id)

  ok('o caso aparece na fila de conferência', Boolean(linha))
  ok('mostra o que a pessoa digitou', linha?.conflito?.informado.full_name === 'Titular Original')
  ok('mostra o cadastro que já existia', linha?.conflito?.existente?.id === titular.registrationId)
  ok(
    'CPF do cadastro existente vem só como últimos 4 dígitos',
    linha?.conflito?.existente?.cpf_last4 === cpfTitular.slice(-4),
    linha?.conflito?.existente?.cpf_last4 ?? ''
  )
  ok(
    'o cadastro comum NÃO entra na fila',
    !naFila.some((l) => l.id === tokenB.id) && lista.some((l) => l.id === tokenB.id)
  )

  // ================= Autorização da rota =================
  console.log('\n--- Rota de decisão ---')

  const semSessao = await fetch(`${BASE}/api/admin/formularios/${tokenA.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ acao: 'vincular' }),
  })
  ok('vincular exige sessão', semSessao.status === 401, `status ${semSessao.status}`)

  const { data: aindaSolto } = await supabase
    .from('contacts')
    .select('registration_id')
    .eq('id', contatoA)
    .single()
  ok('a tentativa sem sessão não vinculou nada', aindaSolto?.registration_id === null)

  // ================= Decisão: recusar =================
  console.log('\n--- Decisão humana ---')

  const semMotivo = await decidirConferencia({
    submissaoId: tokenA.id,
    acao: 'recusar',
    decididoPor: 'teste@local',
  })
  ok('recusar sem motivo é barrado', !semMotivo.ok && semMotivo.status === 400)

  const recusa = await decidirConferencia({
    submissaoId: tokenA.id,
    acao: 'recusar',
    motivo: 'Titular negou por telefone.',
    decididoPor: 'teste@local',
  })
  ok('recusa registrada', recusa.ok === true, JSON.stringify(recusa))

  const { data: depoisRecusa } = await supabase
    .from('contacts')
    .select('registration_id')
    .eq('id', contatoA)
    .single()
  ok('recusar mantém o contato sem vínculo', depoisRecusa?.registration_id === null)

  const denovo = await decidirConferencia({
    submissaoId: tokenA.id,
    acao: 'vincular',
    decididoPor: 'outro@local',
  })
  ok('não dá para decidir duas vezes', !denovo.ok && denovo.status === 409, JSON.stringify(denovo))

  // ================= Decisão: vincular =================
  const tokenA2 = await criarToken(contatoA)
  const retida2 = await submeterCadastro(tokenA2.token, {
    cpf: cpfTitular,
    full_name: 'Titular Original',
    email: `outro2${carimbo}@teste.local`,
    address: endereco,
    roles: ['proprietario'],
  })
  if (retida2.ok !== 'revisao') throw new Error('segunda submissão deveria ter sido retida')

  const vinculo = await decidirConferencia({
    submissaoId: tokenA2.id,
    acao: 'vincular',
    decididoPor: 'admin@local',
  })
  ok('vincular funciona quando o humano confirma', vinculo.ok === true, JSON.stringify(vinculo))

  const { data: final } = await supabase
    .from('contacts')
    .select('registration_id, registration_status')
    .eq('id', contatoA)
    .single()
  ok(
    'contato agora aponta para o cadastro do titular',
    final?.registration_id === titular.registrationId && final?.registration_status === 'completo'
  )

  const { data: papeis } = await supabase
    .from('contact_roles')
    .select('role')
    .eq('registration_id', titular.registrationId)
  const conjunto = new Set((papeis ?? []).map((p) => p.role))
  /* Ela se cadastrou como interessada e voltou dizendo que é proprietária:
     o vínculo precisa somar o papel novo, não substituir o antigo. */
  ok(
    'papel declarado agora foi somado ao cadastro',
    conjunto.has('interessado') && conjunto.has('proprietario'),
    [...conjunto].join(', ')
  )

  const listaFinal = await listarFormularios()
  ok('a fila esvaziou', !aguardandoConferencia(listaFinal).some((l) => l.id === tokenA2.id))

  await limpar()
  console.log('\nDados de teste removidos.')
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})

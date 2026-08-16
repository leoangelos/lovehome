import 'dotenv/config'
import crypto from 'crypto'
import { createAdminClient } from '../lib/supabase/admin'
import { listarCampos, salvarCampo, removerCampo, reordenarCampos } from '../lib/registrations/campos'
import { submeterCadastro, validarToken } from '../lib/registrations/form'
import { resolveRegistration } from '../lib/pipeline/resolve-registration'
import type { Contact } from '../lib/types/domain'

/* Formulário configurável (PRD 6.5). Rodar com: npm run check:campos
   (o servidor de dev precisa estar no ar para a checagem HTTP)

   NÃO chama a OpenAI.

   O que está sendo protegido, em uma frase: a tela de configuração NÃO pode
   mexer no que define um cadastro completo. Se um campo extra conseguisse
   participar do gate da §6.3, um admin acrescentaria uma pergunta qualquer e,
   sem perceber, ou travaria toda a operação (ninguém mais agenda visita) ou
   liberaria contrato para quem não tem endereço. Por isso a asserção central
   deste arquivo é: campo extra muda o ENVIO do formulário, nunca o veredito do
   portão. */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const supabase = createAdminClient()

const MARCA = 'Testecampo'
const TELEFONE = '5511977000441'
const criado = { campos: [] as string[], contatos: [] as string[], cadastros: [] as string[] }

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

const ENDERECO = {
  street: 'Rua das Provas',
  number: '10',
  neighborhood: 'Centro',
  city: 'São Paulo',
  state: 'SP',
  zip: '01000000',
}

async function limpar() {
  /* O CONTATO sai primeiro: `contacts.registration_id` referencia o cadastro
     sem ON DELETE, então apagar na outra ordem esbarra na FK. */
  const { data: contatos } = await supabase.from('contacts').select('id').eq('phone', TELEFONE)
  for (const c of contatos ?? []) {
    await supabase.from('form_submissions').delete().eq('contact_id', c.id)
    const { error } = await supabase.from('contacts').delete().eq('id', c.id)
    if (error) throw new Error(`limpeza do contato falhou: ${error.message}`)
  }
  criado.contatos.length = 0

  for (const id of criado.cadastros) {
    // Qualquer outro contato que tenha ficado apontando para este cadastro.
    await supabase.from('contacts').update({ registration_id: null }).eq('registration_id', id)
    await supabase.from('form_submissions').delete().eq('registration_id', id)
    await supabase.from('contact_roles').delete().eq('registration_id', id)
    const { error } = await supabase.from('registrations').delete().eq('id', id)
    if (error) throw new Error(`limpeza do cadastro falhou: ${error.message}`)
  }
  criado.cadastros.length = 0

  for (const id of criado.campos) {
    const { error } = await supabase.from('form_fields').delete().eq('id', id)
    if (error) throw new Error(`limpeza do campo falhou: ${error.message}`)
  }
  criado.campos.length = 0

  const { error: e } = await supabase.from('form_fields').delete().like('chave', 'teste_%')
  if (e) throw new Error(`limpeza dos campos por prefixo falhou: ${e.message}`)

  const { data: cadastros } = await supabase
    .from('registrations')
    .select('id')
    .ilike('full_name', `%${MARCA}%`)
  for (const c of cadastros ?? []) {
    await supabase.from('contacts').update({ registration_id: null }).eq('registration_id', c.id)
    await supabase.from('form_submissions').delete().eq('registration_id', c.id)
    await supabase.from('contact_roles').delete().eq('registration_id', c.id)
    await supabase.from('registrations').delete().eq('id', c.id)
  }
}

async function novoCampo(params: Parameters<typeof salvarCampo>[0]) {
  const r = await salvarCampo(params)
  if (!r.ok) throw new Error(`campo "${params.chave}": ${r.erro}`)
  criado.campos.push(r.id)
  return r.id
}

async function criarContato() {
  const { data, error } = await supabase
    .from('contacts')
    .insert({ phone: TELEFONE, phone_key: TELEFONE.slice(-8), name: `Pessoa ${MARCA}` })
    .select('*')
    .single()
  if (error) throw new Error(`contato: ${error.message}`)
  criado.contatos.push(data.id)
  return data as Contact
}

async function criarToken(contactId: string) {
  const token = crypto.randomBytes(32).toString('base64url')
  const { error } = await supabase.from('form_submissions').insert({
    form_type: 'cadastro',
    contact_id: contactId,
    token,
    status: 'pendente',
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  })
  if (error) throw new Error(`token: ${error.message}`)
  return token
}

async function main() {
  await limpar()

  // ================= Definição =================
  console.log('--- Definição do campo ---')

  const reservado = await salvarCampo({
    chave: 'cpf',
    rotulo: 'CPF de novo',
    tipo: 'texto',
    email: 'teste@local',
  })
  /* CPF vive em três colunas dedicadas, criptografado. Um campo extra chamado
     `cpf` guardaria o número em texto plano dentro de um jsonb. */
  ok('chave reservada é recusada', reservado.ok === false && reservado.status === 400)

  const formatoRuim = await salvarCampo({
    chave: 'Renda Mensal',
    rotulo: 'Renda',
    tipo: 'numero',
    email: 'teste@local',
  })
  ok('chave com espaço/maiúscula é recusada', formatoRuim.ok === false)

  const semRotulo = await salvarCampo({
    chave: 'teste_x',
    rotulo: '   ',
    tipo: 'texto',
    email: 'teste@local',
  })
  ok('pergunta sem texto é recusada', semRotulo.ok === false)

  const escolhaSemOpcao = await salvarCampo({
    chave: 'teste_faixa',
    rotulo: 'Faixa',
    tipo: 'escolha',
    opcoes: ['Uma só'],
    email: 'teste@local',
  })
  ok('lista com uma opção só é recusada', escolhaSemOpcao.ok === false)

  const idRenda = await novoCampo({
    chave: 'teste_renda',
    rotulo: 'Renda mensal aproximada',
    tipo: 'numero',
    obrigatorio: true,
    email: 'teste@local',
  })

  const duplicada = await salvarCampo({
    chave: 'teste_renda',
    rotulo: 'Outra renda',
    tipo: 'texto',
    email: 'teste@local',
  })
  ok('chave repetida é recusada', duplicada.ok === false && duplicada.status === 409)

  const idFaixa = await novoCampo({
    chave: 'teste_faixa',
    rotulo: 'Faixa de preço',
    tipo: 'escolha',
    opcoes: ['Até 300 mil', 'De 300 a 600 mil', 'Acima de 600 mil'],
    email: 'teste@local',
  })

  const idQuartos = await novoCampo({
    chave: 'teste_imoveis',
    rotulo: 'Quantos imóveis você tem?',
    tipo: 'texto',
    obrigatorio: true,
    /* Só para proprietário: o interessado nunca vê — e por isso não pode ser
       cobrado por ela. */
    papeis: ['proprietario'],
    email: 'teste@local',
  })

  const listados = await listarCampos('cadastro')
  ok('os campos aparecem na ordem de criação', listados.map((c) => c.id).indexOf(idRenda) === 0, listados.length + ' campo(s)')

  // ================= O formulário público enxerga =================
  console.log('\n--- Formulário público ---')

  const contato = await criarContato()
  const token = await criarToken(contato.id)

  const tk = await validarToken(token)
  ok('o token traz os campos configurados', tk.valido === true && tk.campos.length >= 3, tk.valido ? `${tk.campos.length}` : 'inválido')

  // ================= Envio =================
  console.log('\n--- Envio ---')

  const carimbo = Date.now()
  const cpf = gerarCpf(carimbo)
  const dadosBase = {
    cpf,
    full_name: `Cliente ${MARCA}`,
    email: `campo${carimbo}@teste.local`,
    address: ENDERECO,
    roles: ['interessado' as const],
  }

  const semObrigatorio = await submeterCadastro(token, { ...dadosBase, extra: {} })
  ok(
    'campo obrigatório em branco barra o envio',
    semObrigatorio.ok === false && semObrigatorio.campo === 'extra.teste_renda',
    JSON.stringify(semObrigatorio).slice(0, 70)
  )

  const opcaoInvalida = await submeterCadastro(token, {
    ...dadosBase,
    extra: { teste_renda: 8000, teste_faixa: 'Um milhão' },
  })
  /* A lista é fechada: aceitar valor fora dela deixaria o relatório com
     categorias que ninguém configurou. */
  ok('opção fora da lista é recusada', opcaoInvalida.ok === false, JSON.stringify(opcaoInvalida).slice(0, 60))

  const naoNumero = await submeterCadastro(token, {
    ...dadosBase,
    extra: { teste_renda: 'oito mil' },
  })
  ok('texto em campo numérico é recusado', naoNumero.ok === false)

  const enviado = await submeterCadastro(token, {
    ...dadosBase,
    extra: {
      teste_renda: '8000',
      teste_faixa: 'De 300 a 600 mil',
      // Chave que nenhum campo define — o que alguém inventaria no devtools.
      chave_inventada: 'lixo',
      // Campo de proprietário, e a pessoa marcou só 'interessado'.
      teste_imoveis: 'três',
    },
  })
  ok('o cadastro é aceito com as respostas válidas', enviado.ok === true, JSON.stringify(enviado).slice(0, 80))

  if (enviado.ok !== true) throw new Error('sem cadastro, o resto não faz sentido')
  criado.cadastros.push(enviado.registrationId)

  const { data: gravado } = await supabase
    .from('registrations')
    .select('extra')
    .eq('id', enviado.registrationId)
    .single()

  const extra = (gravado?.extra ?? {}) as Record<string, unknown>

  ok('número é guardado como número', extra.teste_renda === 8000, typeof extra.teste_renda)
  ok('a escolha é guardada', extra.teste_faixa === 'De 300 a 600 mil')
  /* Se isto falhar, qualquer pessoa com o formulário aberto pode escrever o que
     quiser dentro do cadastro, para sempre. */
  ok('chave inventada NÃO é guardada', !('chave_inventada' in extra), JSON.stringify(extra).slice(0, 80))
  ok('resposta de campo invisível é descartada', !('teste_imoveis' in extra))

  // ================= O gate não se move =================
  console.log('\n--- O gate da §6.3 ---')

  const { data: contatoAtualizado } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', contato.id)
    .single()

  const estado = await resolveRegistration(contatoAtualizado as Contact)
  ok('o cadastro fica completo', estado.status === 'completo', estado.status)

  /* A asserção central: acrescentar uma pergunta obrigatória DEPOIS não pode
     rebaixar quem já se cadastrou. Se rebaixasse, um campo novo travaria
     visita, reserva e contrato de toda a base de uma vez — sem ninguém pedir. */
  const idNovoObrigatorio = await novoCampo({
    chave: 'teste_depois',
    rotulo: 'Pergunta criada depois',
    tipo: 'texto',
    obrigatorio: true,
    email: 'teste@local',
  })

  const estadoDepois = await resolveRegistration(contatoAtualizado as Contact)
  ok(
    'campo obrigatório novo NÃO rebaixa quem já se cadastrou',
    estadoDepois.status === 'completo',
    estadoDepois.status
  )

  const { data: contatoDepois } = await supabase
    .from('contacts')
    .select('registration_status')
    .eq('id', contato.id)
    .single()
  ok('e a coluna do contato segue completo', contatoDepois?.registration_status === 'completo')

  // ================= Respostas já coletadas =================
  console.log('\n--- Respostas já coletadas ---')

  const apagar = await removerCampo(idRenda, 'teste@local')
  /* Apagar a definição não apaga a resposta — deixa `teste_renda: 8000` no
     painel sem ninguém saber o que a pergunta era. */
  ok('apagar campo já respondido é recusado', apagar.ok === false && apagar.status === 409, JSON.stringify(apagar).slice(0, 80))

  const trocarChave = await salvarCampo({
    id: idRenda,
    chave: 'teste_renda_nova',
    rotulo: 'Renda mensal aproximada',
    tipo: 'numero',
    obrigatorio: true,
    email: 'teste@local',
  })
  ok('trocar a chave de campo já respondido é recusado', trocarChave.ok === false && trocarChave.status === 409)

  const desativar = await salvarCampo({
    id: idRenda,
    chave: 'teste_renda',
    rotulo: 'Renda mensal aproximada',
    tipo: 'numero',
    obrigatorio: true,
    is_active: false,
    email: 'teste@local',
  })
  ok('mas desativar funciona', desativar.ok === true, JSON.stringify(desativar).slice(0, 60))

  const { data: aindaLa } = await supabase
    .from('registrations')
    .select('extra')
    .eq('id', enviado.registrationId)
    .single()
  ok(
    'e a resposta já coletada continua guardada',
    (aindaLa?.extra as Record<string, unknown>)?.teste_renda === 8000
  )

  const apagarSemUso = await removerCampo(idNovoObrigatorio, 'teste@local')
  ok('campo sem nenhuma resposta pode ser apagado', apagarSemUso.ok === true)
  if (apagarSemUso.ok) criado.campos = criado.campos.filter((c) => c !== idNovoObrigatorio)

  // ================= Ordem =================
  console.log('\n--- Ordem ---')

  await reordenarCampos([idQuartos, idFaixa, idRenda], 'teste@local')
  const reordenados = await listarCampos('cadastro')
  ok(
    'a ordem definida na tela é a ordem do formulário',
    reordenados[0]?.id === idQuartos && reordenados[2]?.id === idRenda,
    reordenados.map((c) => c.chave).join(' → ')
  )

  // ================= Rotas =================
  console.log('\n--- Rotas ---')

  const semSessao = await fetch(`${BASE}/api/admin/formularios/campos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chave: 'teste_invasor', rotulo: 'Invasor', tipo: 'texto' }),
  })
  ok('criar campo exige sessão', semSessao.status === 401, `status ${semSessao.status}`)

  const { count: nenhum } = await supabase
    .from('form_fields')
    .select('id', { count: 'exact', head: true })
    .eq('chave', 'teste_invasor')
  ok('e nada foi criado', nenhum === 0)

  const apagarSemSessao = await fetch(`${BASE}/api/admin/formularios/campos/${idFaixa}`, {
    method: 'DELETE',
  })
  ok('apagar campo exige sessão', apagarSemSessao.status === 401, `status ${apagarSemSessao.status}`)

  const { count: intacto } = await supabase
    .from('form_fields')
    .select('id', { count: 'exact', head: true })
    .eq('id', idFaixa)
  ok('e o campo continua lá', intacto === 1)

  await limpar()

  const { count: sobrou } = await supabase
    .from('form_fields')
    .select('id', { count: 'exact', head: true })
    .like('chave', 'teste_%')
  ok('a limpeza não deixou campo para trás', sobrou === 0, `${sobrou}`)

  console.log('\nDados de teste removidos.')
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})

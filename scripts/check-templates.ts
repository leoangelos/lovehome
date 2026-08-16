import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import {
  PLACEHOLDERS,
  CHAVES_VALIDAS,
  analisarTemplate,
  previewComExemplos,
} from '../lib/leasing/placeholders'
import { listarTemplates, salvarTemplate, ativarTemplate, removerTemplate } from '../lib/leasing/templates'
import { preencherContrato } from '../lib/leasing/contract-template'
import { prepararCpf } from '../lib/registrations/cpf'

/* Modelos de contrato (PRD 15.1). Rodar com: npm run check:templates
   (o servidor de dev precisa estar no ar para a checagem HTTP)

   NÃO chama a OpenAI.

   O que está sendo protegido: o texto do modelo vira o PDF que duas pessoas
   assinam. Um `{{valor_aluguel}}` digitado errado sai como `[valor_aluguel]`
   LITERAL dentro do documento — e ninguém percebe até o cliente perguntar.
   A asserção mais importante deste arquivo é que TODO campo do catálogo é de
   fato preenchido pelo gerador. */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const supabase = createAdminClient()

const MARCA = 'Testetemplate'
const criado = { templates: [] as string[], registrationId: null as string | null, dealId: null as string | null }
let ativosOriginais: { id: string; deal_type: string }[] = []

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
  for (const id of criado.templates) {
    await supabase.from('contract_templates').delete().eq('id', id)
  }
  criado.templates.length = 0

  if (criado.dealId) {
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

  await supabase.from('contract_templates').delete().ilike('name', `%${MARCA}%`)

  /* Restaura quem estava em uso: este é o modelo VIVO do sistema, e deixá-lo
     desativado quebraria a geração de contrato de verdade.
     `ativosOriginais` NÃO é zerado aqui: `limpar()` roda também no começo, e
     zerar ali deixaria a limpeza final sem o que restaurar — foi assim que uma
     execução deixou a locação sem modelo ativo. */
  for (const a of ativosOriginais) {
    await supabase.from('contract_templates').update({ is_active: false }).eq('deal_type', a.deal_type)
    await supabase.from('contract_templates').update({ is_active: true }).eq('id', a.id)
  }

  const { data: cadastros } = await supabase
    .from('registrations')
    .select('id')
    .ilike('full_name', `%${MARCA}%`)
  for (const c of cadastros ?? []) {
    const { data: ds } = await supabase.from('deals').select('id').eq('client_registration_id', c.id)
    for (const d of ds ?? []) await supabase.from('deals').delete().eq('id', d.id)
    await supabase.from('contact_roles').delete().eq('registration_id', c.id)
    await supabase.from('registrations').delete().eq('id', c.id)
  }
}

async function main() {
  const { data: ativos } = await supabase
    .from('contract_templates')
    .select('id, deal_type')
    .eq('is_active', true)
  ativosOriginais = ativos ?? []
  console.log(`INFO  guardando ${ativosOriginais.length} modelo(s) em uso para restaurar no fim\n`)

  await limpar()

  // ================= Catálogo =================
  console.log('--- Catálogo de campos ---')

  ok('o catálogo tem campos', PLACEHOLDERS.length > 10, `${PLACEHOLDERS.length}`)
  ok(
    'nenhuma chave repetida',
    new Set(PLACEHOLDERS.map((p) => p.chave)).size === PLACEHOLDERS.length
  )
  ok('todo campo tem exemplo', PLACEHOLDERS.every((p) => p.exemplo.length > 0))

  const analise = analisarTemplate('Olá {{tenant_name}}, o aluguel é {{rent_price}}.', 'locacao')
  ok('reconhece os campos usados', analise.usados.length === 2)
  ok('não acusa campo válido', analise.desconhecidos.length === 0)

  const comLixo = analisarTemplate('Valor: {{valor_aluguel}} e {{tenant_name}}', 'locacao')
  /* `valor_aluguel` não existe — sairia literal no PDF. */
  ok('acusa campo inexistente', comLixo.desconhecidos.includes('valor_aluguel'))

  const foraDeContexto = analisarTemplate('{{tenant_name}} paga {{rent_price}}', 'venda')
  ok('acusa campo de locação num contrato de venda', foraDeContexto.foraDeContexto.includes('rent_price'))

  ok('acusa campo essencial ausente', analise.faltando.includes('owner_name'))

  const previa = previewComExemplos('Cliente: {{tenant_name}} — {{rent_price}}')
  ok('a prévia troca por exemplos', previa.includes('Maria Souza Lima') && !previa.includes('{{'))

  // ================= Todo campo do catálogo é preenchido de verdade =================
  console.log('\n--- O gerador sabe preencher todos ---')

  const carimbo = Date.now()
  const { data: cadastro, error: e1 } = await supabase
    .from('registrations')
    .insert({
      ...prepararCpf(gerarCpf(carimbo)),
      full_name: `Cliente ${MARCA}`,
      email: `tpl${carimbo}@teste.local`,
      address: { street: 'Rua A', number: '1', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', zip: '01000-000' },
    })
    .select('id')
    .single()
  if (e1 || !cadastro) throw new Error(`cadastro: ${e1?.message}`)
  criado.registrationId = cadastro.id

  const { data: imovel } = await supabase
    .from('properties')
    .select('id')
    .not('address', 'is', null)
    .eq('status', 'disponivel')
    .limit(1)
    .single()

  const { data: negocio, error: e2 } = await supabase
    .from('deals')
    .insert({
      deal_type: 'locacao',
      property_id: imovel!.id,
      client_registration_id: cadastro.id,
      owner_registration_id: cadastro.id,
      status: 'aprovado',
      rent_price_cents: 320000,
      start_date: '2026-09-01',
      end_date: '2028-08-31',
      notice_period_days: 30,
    })
    .select('id')
    .single()
  if (e2 || !negocio) throw new Error(`negócio: ${e2?.message}`)
  criado.dealId = negocio.id

  /* Um modelo que usa TODOS os campos do catálogo. Se algum deles não for
     preenchido, ele aparece como `[chave]` no texto — e é exatamente isso que
     aconteceria num contrato real com um campo novo mal cadastrado. */
  const corpoCompleto =
    'MODELO DE VERIFICAÇÃO. '.repeat(10) +
    '\n\n' +
    PLACEHOLDERS.map((p) => `${p.rotulo}: {{${p.chave}}}`).join('\n')

  const { data: tplCompleto } = await supabase
    .from('contract_templates')
    .insert({
      deal_type: 'locacao',
      name: `${MARCA} — todos os campos`,
      body_template: corpoCompleto,
      is_active: true,
    })
    .select('id')
    .single()
  criado.templates.push(tplCompleto!.id)
  await supabase
    .from('contract_templates')
    .update({ is_active: false })
    .eq('deal_type', 'locacao')
    .neq('id', tplCompleto!.id)

  const gerado = await preencherContrato(negocio.id)
  ok('o contrato foi preenchido', gerado.ok === true, gerado.ok ? '' : gerado.erro)

  if (gerado.ok) {
    const naoPreenchidos = [...CHAVES_VALIDAS].filter((c) =>
      gerado.contrato.texto.includes(`[${c}]`)
    )
    /* `[chave]` no texto significa que o catálogo anuncia um campo que o
       gerador não produz — o editor deixaria alguém usá-lo e o PDF sairia com
       o nome da variável no meio do contrato. */
    ok(
      'nenhum campo do catálogo saiu como [chave]',
      naoPreenchidos.length === 0,
      naoPreenchidos.join(', ')
    )
    ok('e não sobrou nenhum {{ }} no texto', !gerado.contrato.texto.includes('{{'))
  }

  // ================= Salvar =================
  console.log('\n--- Salvar modelo ---')

  const curto = await salvarTemplate({
    deal_type: 'locacao',
    name: `${MARCA} curto`,
    body_template: 'Contrato.',
    email: 'teste@local',
  })
  ok('texto curto demais é recusado', curto.ok === false && curto.status === 400)

  const semNome = await salvarTemplate({
    deal_type: 'locacao',
    name: '  ',
    body_template: corpoCompleto,
    email: 'teste@local',
  })
  ok('modelo sem nome é recusado', semNome.ok === false)

  const comDesconhecido = await salvarTemplate({
    deal_type: 'locacao',
    name: `${MARCA} inválido`,
    body_template: corpoCompleto + '\n\nValor: {{valor_do_aluguel}}',
    email: 'teste@local',
  })
  /* Recusa, não aviso: o campo sairia literal num documento legal. */
  ok('campo inexistente é RECUSADO ao salvar', comDesconhecido.ok === false && comDesconhecido.status === 400, comDesconhecido.ok ? '' : comDesconhecido.erro)

  const { count: naoEntrou } = await supabase
    .from('contract_templates')
    .select('id', { count: 'exact', head: true })
    .ilike('name', `%${MARCA} inválido%`)
  ok('e não foi gravado', naoEntrou === 0)

  /* Campo faltando é AVISO, não recusa: cláusula omitida às vezes é escolha do
     jurídico, e barrar substituiria o julgamento de quem redige. */
  const semEssencial = await salvarTemplate({
    deal_type: 'locacao',
    name: `${MARCA} sem proprietário`,
    body_template: 'CONTRATO. '.repeat(30) + '\n{{tenant_name}} — {{rent_price}}',
    email: 'teste@local',
  })
  ok('campo essencial ausente é aviso, não recusa', semEssencial.ok === true, JSON.stringify(semEssencial).slice(0, 60))
  if (semEssencial.ok) criado.templates.push(semEssencial.id)

  // ================= Um ativo por tipo =================
  console.log('\n--- Um modelo em uso por tipo ---')

  if (semEssencial.ok) {
    await ativarTemplate(semEssencial.id, 'teste@local')
    const { data: ativosLocacao } = await supabase
      .from('contract_templates')
      .select('id')
      .eq('deal_type', 'locacao')
      .eq('is_active', true)
    /* Dois ativos deixaria a escolha ao acaso da ordenação, e dois contratos
       do mesmo dia sairiam com textos diferentes. */
    ok('ativar um desativa os outros do tipo', (ativosLocacao ?? []).length === 1, `${ativosLocacao?.length}`)
    ok('e o ativo é o escolhido', ativosLocacao?.[0]?.id === semEssencial.id)
  }

  // ================= Remoção =================
  console.log('\n--- Remoção ---')

  const { data: deVenda } = await supabase
    .from('contract_templates')
    .select('id')
    .eq('deal_type', 'venda')

  if ((deVenda ?? []).length === 1) {
    const unico = await removerTemplate(deVenda![0].id, 'teste@local')
    /* Sem modelo não há como gerar contrato, e a falha só apareceria no momento
       em que alguém precisasse. */
    ok('não remove o último modelo do tipo', unico.ok === false && unico.status === 409, JSON.stringify(unico).slice(0, 70))
  } else {
    console.log(`INFO  ${deVenda?.length} modelos de venda — pulando a trava do último`)
  }

  const listados = await listarTemplates()
  ok('a tela lista com diagnóstico', listados.every((t) => Array.isArray(t.analise.usados)))
  ok('e o modelo em uso está marcado', listados.some((t) => t.is_active))

  // ================= Rotas =================
  console.log('\n--- Rotas ---')

  const semSessao = await fetch(`${BASE}/api/admin/contratos/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deal_type: 'locacao', name: 'invasor', body_template: 'x'.repeat(300) }),
  })
  ok('criar modelo exige sessão', semSessao.status === 401, `status ${semSessao.status}`)

  const { count: semInvasor } = await supabase
    .from('contract_templates')
    .select('id', { count: 'exact', head: true })
    .eq('name', 'invasor')
  ok('e nada foi criado', semInvasor === 0)

  await limpar()

  const { data: depois } = await supabase
    .from('contract_templates')
    .select('id, deal_type')
    .eq('is_active', true)
  ok(
    'os modelos originais voltaram a ficar em uso',
    ativosOriginais.every((a) => (depois ?? []).some((d) => d.id === a.id)),
    `${depois?.length} ativo(s) de ${ativosOriginais.length} esperado(s)`
  )
  /* Cada tipo com exatamente um ativo: zero quebra a geração, dois deixam a
     escolha ao acaso da ordenação. */
  for (const tipo of ['locacao', 'venda']) {
    ok(
      `${tipo}: exatamente um modelo em uso`,
      (depois ?? []).filter((d) => d.deal_type === tipo).length === 1
    )
  }

  console.log('\nDados de teste removidos.')
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})

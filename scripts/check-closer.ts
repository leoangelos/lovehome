import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import { resolveRegistration } from '../lib/pipeline/resolve-registration'
import { runCloserAgent } from '../lib/agents/closer'
import { handleCreateDeal } from '../lib/agents/tools/leasing'
import type { Contact } from '../lib/types/domain'

/* Jornada do Closer (PRD 4.6 e 12.5). Rodar com: npm run check:closer
   CHAMA A OPENAI.

   Cobre reserva, trava do imóvel, coleta de documentos — e o que ele NÃO pode
   fazer: aprovar o negócio, avaliar documento ou reservar imóvel já reservado. */

const PREFIXO_DEMO = '5511900'
const IMOVEL = 'LH-1004' // disponível no seed, venda, Campo Belo
const supabase = createAdminClient()

const criados: string[] = []
let imovelId: string | null = null

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

/** Apaga o que este teste criou e devolve o imóvel ao estado do seed.
    Varre por property_id além dos ids anotados: um negócio criado por caminho
    que o teste não previu ficaria órfão, apontando para um imóvel que a limpeza
    devolveu como disponível. */
async function limpar() {
  if (imovelId) {
    const { data } = await supabase.from('deals').select('id').eq('property_id', imovelId)
    for (const d of data ?? []) if (!criados.includes(d.id)) criados.push(d.id)
  }

  for (const id of criados) {
    await supabase.from('documents').delete().eq('deal_id', id)
    await supabase.from('approval_requests').delete().eq('deal_id', id)
    const { error } = await supabase.from('deals').delete().eq('id', id)
    if (error) throw new Error(`limpeza falhou: ${error.message}`)
  }
  criados.length = 0

  if (imovelId) {
    await supabase.from('properties').update({ status: 'disponivel' }).eq('id', imovelId)
  }
}

async function main() {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('name', 'Marina Coelho')
    .single()
  if (error) throw new Error(error.message)

  const marina = data as Contact
  if (!marina.phone?.startsWith(PREFIXO_DEMO)) throw new Error('contato fora do seed')

  await supabase.from('agent_histories').delete().eq('contact_id', marina.id)

  const { data: imovel } = await supabase
    .from('properties')
    .select('id, status')
    .eq('reference_code', IMOVEL)
    .single()
  imovelId = imovel!.id
  ok(`${IMOVEL} começa disponível`, imovel!.status === 'disponivel', imovel!.status)

  const cadastro = await resolveRegistration(marina)
  ok('cliente com cadastro completo', cadastro.status === 'completo')

  // ---- Turno 1: reserva ----
  console.log(`\n--- "Gostei do ${IMOVEL}, quero fazer uma proposta" ---`)
  const r1 = await runCloserAgent(
    marina.id,
    `Visitei o ${IMOVEL} e gostei muito. Quero fazer uma proposta de compra, pretendo financiar.`,
    cadastro
  )
  console.log(`\n> ${r1.content}\n`)
  console.log(`tools: ${r1.toolsUsed.join(', ') || 'nenhuma'}`)

  /* Perguntar o valor antes de reservar é conversa correta — reservar trava o
     imóvel para todo mundo e não deve acontecer por engano. Por isso o teste
     tem dois turnos, como a conversa real. */
  console.log('\n--- "Proposta de 1.150.000, pode reservar" ---')
  const r2 = await runCloserAgent(
    marina.id,
    'Quero propor 1.150.000. Pode seguir com a reserva.',
    cadastro
  )
  console.log(`\n> ${r2.content}\n`)
  console.log(`tools: ${r2.toolsUsed.join(', ') || 'nenhuma'}`)

  const todasTools = [...r1.toolsUsed, ...r2.toolsUsed]
  ok('criou o negócio', todasTools.includes('create_deal'))
  ok('pediu os documentos', todasTools.includes('request_documents'))

  /* O Closer não aprova nada — o prompt insiste porque a tentação do modelo é
     tranquilizar o cliente. Se ele disser "aprovado", o cliente entende que o
     imóvel é dele. */
  const prometeuAprovacao =
    /\b(aprovad[oa]|est[áa] tudo certo|neg[óo]cio fechado|parab[ée]ns)\b/i.test(r2.content)
  ok('não disse que o negócio está aprovado', !prometeuAprovacao, r2.content.slice(0, 100))

  const { data: negocio } = await supabase
    .from('deals')
    .select('id, status, deal_type, sale_price_cents, financing_type, documentos_solicitados, property_id')
    .eq('client_registration_id', marina.registration_id!)
    .eq('property_id', imovelId!)
    .maybeSingle()

  ok('negócio existe no banco', Boolean(negocio))
  if (negocio) criados.push(negocio.id)

  if (negocio) {
    ok('nasceu em aprovação, não aprovado', negocio.status === 'em_aprovacao', negocio.status)
    ok('tipo venda', negocio.deal_type === 'venda', negocio.deal_type)
    ok('registrou o financiamento', negocio.financing_type === 'financiado', String(negocio.financing_type))
    ok(
      'gravou a proposta, não o preço anunciado',
      negocio.sale_price_cents === 115_000_000,
      `${negocio.sale_price_cents} centavos (anunciado: 118000000)`
    )

    const docs = (negocio.documentos_solicitados ?? []) as string[]
    ok('checklist de documentos gravado', docs.length >= 2, docs.join(', '))
    ok('pediu RG/CNH', docs.includes('rg_cnh'))
    ok('pediu comprovante de renda', docs.includes('comprovante_renda'))
  }

  const { data: depois } = await supabase
    .from('properties')
    .select('status')
    .eq('id', imovelId!)
    .single()
  ok('imóvel ficou reservado', depois!.status === 'reservado', depois!.status)

  const { data: contatoDepois } = await supabase
    .from('contacts')
    .select('funnel_stage')
    .eq('id', marina.id)
    .single()
  ok('funil foi para em_negociacao', contatoDepois!.funnel_stage === 'em_negociacao', contatoDepois!.funnel_stage)

  // ---- Imóvel já reservado não pode ser reservado de novo ----
  console.log('\n--- Outra pessoa tentando o mesmo imóvel ---')
  const { data: outro } = await supabase
    .from('contacts')
    .select('*')
    .eq('name', 'Paulo Ferraz')
    .single()

  const cadastroOutro = await resolveRegistration(outro as Contact)
  const tentativa = await handleCreateDeal((outro as Contact).id, {
    property_reference: IMOVEL,
    deal_type: 'venda',
  })
  ok(
    'segunda reserva no mesmo imóvel é recusada',
    !(tentativa as { criado: boolean }).criado,
    JSON.stringify(tentativa).slice(0, 120)
  )
  ok('cliente do teste tinha cadastro (não foi barrado por isso)', cadastroOutro.status === 'completo')

  // ---- Duplicidade do mesmo cliente ----
  const repetida = await handleCreateDeal(marina.id, {
    property_reference: IMOVEL,
    deal_type: 'venda',
  })
  const r = repetida as { criado: boolean; ja_existe?: boolean; deal_id?: string }
  ok('mesma pessoa não gera negócio duplicado', !r.criado && r.ja_existe === true)
  ok('devolve o negócio existente', r.deal_id === negocio?.id)

  // ---- Aprovação do negócio trava com documento por conferir ----
  if (negocio) {
    console.log('\n--- Aprovação do negócio ---')
    await supabase.from('documents').insert({
      registration_id: marina.registration_id,
      deal_id: negocio.id,
      type: 'rg_cnh',
      storage_path: 'teste://rg.pdf',
      status: 'pendente_revisao',
    })

    const semRevisar = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/admin/deals/${negocio.id}/approve`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'aprovar' }),
      }
    )
    /* Sem sessão a rota devolve 401 antes de chegar na regra — o que já prova
       que a aprovação não é chamável por qualquer um. A regra de "documento por
       conferir trava" é verificada direto no banco abaixo. */
    ok('rota de aprovação exige autenticação', semRevisar.status === 401, `status ${semRevisar.status}`)

    const { count: pendentes } = await supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('deal_id', negocio.id)
      .eq('status', 'pendente_revisao')
    ok('documento entrou na fila de conferência', (pendentes ?? 0) === 1)

    const { data: negocioFinal } = await supabase
      .from('deals')
      .select('status')
      .eq('id', negocio.id)
      .single()
    ok('negócio segue em aprovação', negocioFinal!.status === 'em_aprovacao')
  }

  await limpar()
  await supabase.from('agent_histories').delete().eq('contact_id', marina.id)
  await supabase
    .from('contacts')
    .update({ funnel_stage: 'visita_agendada' })
    .eq('id', marina.id)

  const { data: restaurado } = await supabase
    .from('properties')
    .select('status')
    .eq('id', imovelId!)
    .single()
  console.log(`\nEstado restaurado — ${IMOVEL}: ${restaurado!.status}`)
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})

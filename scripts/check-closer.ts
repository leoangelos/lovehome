import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import { resolveRegistration } from '../lib/pipeline/resolve-registration'
import { runCloserAgent } from '../lib/agents/closer'
import { handleCreateDeal, handleRequestDocuments } from '../lib/agents/tools/leasing'
import { aceitarProposta, desfazerNegocio, ordenarPropostas } from '../lib/negocios/propostas'
import type { Contact } from '../lib/types/domain'

/* Jornada do Closer (PRD 4.6 e 12.5) com o fluxo de PROPOSTA. Rodar com:
   npm run check:closer — CHAMA A OPENAI.

   O que mudou e está sendo protegido: proposta NÃO reserva o imóvel (ele
   continua na vitrine, várias pessoas podem propor); o ACEITE no painel é que
   reserva e abre a coleta de documentos; desfazer devolve o imóvel à vitrine
   com a fila preservada. E o que o Closer continua não podendo: aprovar,
   avaliar documento, pedir documento de proposta não aceita. */

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

  // ---- Turno 1: intenção de proposta ----
  console.log(`\n--- "Gostei do ${IMOVEL}, quero fazer uma proposta" ---`)
  const r1 = await runCloserAgent(
    marina.id,
    `Visitei o ${IMOVEL} e gostei muito. Quero fazer uma proposta de compra, pretendo financiar.`,
    cadastro
  )
  console.log(`\n> ${r1.content}\n`)
  console.log(`tools: ${r1.toolsUsed.join(', ') || 'nenhuma'}`)

  console.log('\n--- "Proposta de 1.150.000" ---')
  const r2 = await runCloserAgent(
    marina.id,
    'Quero propor 1.150.000. Pode registrar a proposta.',
    cadastro
  )
  console.log(`\n> ${r2.content}\n`)
  console.log(`tools: ${r2.toolsUsed.join(', ') || 'nenhuma'}`)

  const todasTools = [...r1.toolsUsed, ...r2.toolsUsed]
  ok('registrou a proposta (create_deal)', todasTools.includes('create_deal'))

  /* A proposta ainda não foi aceita: prometer aprovação, dizer "reservado" ou
     pedir documento agora é exatamente o que o fluxo novo proíbe. */
  const prometeuAprovacao =
    /\b(aprovad[oa]|est[áa] tudo certo|neg[óo]cio fechado|parab[ée]ns|reservad[oa])\b/i.test(r2.content)
  ok('não disse "aprovado" nem "reservado"', !prometeuAprovacao, r2.content.slice(0, 120))

  const pediuDocumento = /\b(RG|CNH|comprovante|documento)\b/i.test(r2.content) && /envie|enviar|mandar|preciso/i.test(r2.content)
  ok('não pediu documentos na proposta', !pediuDocumento, r2.content.slice(0, 120))

  const { data: negocio } = await supabase
    .from('deals')
    .select('id, status, deal_type, sale_price_cents, financing_type, documentos_solicitados, property_id')
    .eq('client_registration_id', marina.registration_id!)
    .eq('property_id', imovelId!)
    .maybeSingle()

  ok('negócio existe no banco', Boolean(negocio))
  if (negocio) criados.push(negocio.id)

  if (negocio) {
    ok("nasceu como 'proposta'", negocio.status === 'proposta', negocio.status)
    ok('tipo venda', negocio.deal_type === 'venda', negocio.deal_type)
    ok(
      'gravou a proposta, não o preço anunciado',
      negocio.sale_price_cents === 115_000_000,
      `${negocio.sale_price_cents} centavos (anunciado: 118000000)`
    )
    ok(
      'nenhum documento solicitado ainda',
      ((negocio.documentos_solicitados ?? []) as string[]).length === 0,
      JSON.stringify(negocio.documentos_solicitados)
    )
  }

  const { data: aposProposta } = await supabase
    .from('properties')
    .select('status')
    .eq('id', imovelId!)
    .single()
  ok('imóvel CONTINUA disponível (proposta não trava)', aposProposta!.status === 'disponivel', aposProposta!.status)

  // ---- Segunda pessoa propõe no MESMO imóvel: fila, não recusa ----
  console.log('\n--- Outra pessoa propondo no mesmo imóvel (fila) ---')
  const { data: outro } = await supabase
    .from('contacts')
    .select('*')
    .eq('name', 'Paulo Ferraz')
    .single()

  const cadastroOutro = await resolveRegistration(outro as Contact)
  ok('segundo cliente tem cadastro', cadastroOutro.status === 'completo')

  const segunda = await handleCreateDeal((outro as Contact).id, {
    property_reference: IMOVEL,
    deal_type: 'venda',
    valor_proposto_cents: 118_000_000,
  })
  const seg = segunda as { criado: boolean; deal_id?: string }
  ok('segunda proposta no mesmo imóvel É aceita na fila', seg.criado === true, JSON.stringify(segunda).slice(0, 120))
  if (seg.deal_id) criados.push(seg.deal_id)

  /* Ordem: ninguém foi avaliado ainda → a de MAIOR valor (Paulo, 1.18M) vem
     primeiro, mesmo tendo chegado depois. */
  const { data: pendentes } = await supabase
    .from('deals')
    .select('id, deal_type, rent_price_cents, sale_price_cents, created_at')
    .eq('property_id', imovelId!)
    .eq('status', 'proposta')
  const fila = ordenarPropostas(
    (pendentes ?? []).map((d) => ({
      id: d.id,
      valorCents: d.deal_type === 'locacao' ? d.rent_price_cents : d.sale_price_cents,
      createdAt: d.created_at,
    })),
    false
  )
  ok('fila tem as duas propostas', fila.length === 2, String(fila.length))
  ok('sem avaliação anterior, a de maior valor é a primeira', fila[0]?.id === seg.deal_id)

  // ---- Duplicidade do mesmo cliente ----
  const repetida = await handleCreateDeal(marina.id, {
    property_reference: IMOVEL,
    deal_type: 'venda',
  })
  const r = repetida as { criado: boolean; ja_existe?: boolean; deal_id?: string }
  ok('mesma pessoa não gera proposta duplicada', !r.criado && r.ja_existe === true)
  ok('devolve o negócio existente', r.deal_id === negocio?.id)

  // ---- Documento antes do aceite é recusado na tool ----
  if (negocio) {
    const docsAntes = await handleRequestDocuments({ deal_id: negocio.id })
    ok(
      'request_documents recusa proposta não aceita',
      (docsAntes as { erro?: string }).erro === 'proposta_ainda_nao_aceita',
      JSON.stringify(docsAntes).slice(0, 100)
    )
  }

  // ---- Aceite: reserva o imóvel e abre a coleta ----
  if (negocio) {
    console.log('\n--- Aceite da proposta da Marina (painel) ---')
    const aceite = await aceitarProposta({
      dealId: negocio.id,
      autor: { brokerId: null, recorteProprio: false },
      avisarCliente: false, // teste não manda WhatsApp
    })
    ok('aceite passou', aceite.ok === true, aceite.ok ? '' : (aceite as { erro: string }).erro)

    const { data: aposAceite } = await supabase.from('deals').select('status, documentos_solicitados, proposta_avaliada_em').eq('id', negocio.id).single()
    ok("aceite move para 'em_aprovacao'", aposAceite!.status === 'em_aprovacao', aposAceite!.status)
    ok('aceite abre a coleta de documentos', ((aposAceite!.documentos_solicitados ?? []) as string[]).includes('rg_cnh'))
    ok('aceite marca a avaliação (para a ordem da fila)', Boolean(aposAceite!.proposta_avaliada_em))

    const { data: imovelAceito } = await supabase.from('properties').select('status').eq('id', imovelId!).single()
    ok('SÓ o aceite reserva o imóvel', imovelAceito!.status === 'reservado', imovelAceito!.status)

    // Aceitar a proposta do Paulo agora deve falhar: o imóvel já está reservado.
    if (seg.deal_id) {
      const conflito = await aceitarProposta({ dealId: seg.deal_id, autor: { brokerId: null, recorteProprio: false }, avisarCliente: false })
      ok('não dá para aceitar duas propostas do mesmo imóvel', conflito.ok === false)
    }

    // Nova proposta com imóvel reservado é recusada na tool.
    const tentativa = await handleCreateDeal((outro as Contact).id, { property_reference: IMOVEL, deal_type: 'venda' })
    ok('imóvel reservado não aceita proposta nova', !(tentativa as { criado: boolean }).criado)

    // ---- Desfazer: imóvel volta à vitrine, fila continua ----
    console.log('\n--- Financiamento negado: desfazer o negócio ---')
    const desfeito = await desfazerNegocio({
      dealId: negocio.id,
      autor: { brokerId: null, recorteProprio: false },
      motivo: 'financiamento não aprovado (teste)',
      avisarCliente: false,
    })
    ok('desfazer passou', desfeito.ok === true, desfeito.ok ? '' : (desfeito as { erro: string }).erro)
    if (desfeito.ok) ok('fila reporta a proposta do Paulo aguardando', desfeito.propostasNaFila === 1, String(desfeito.propostasNaFila))

    const { data: imovelFinal } = await supabase.from('properties').select('status').eq('id', imovelId!).single()
    ok('imóvel voltou para a vitrine', imovelFinal!.status === 'disponivel', imovelFinal!.status)

    const { data: negocioFinal } = await supabase.from('deals').select('status, recusa_motivo').eq('id', negocio.id).single()
    ok("negócio desfeito ficou 'cancelado' com motivo", negocioFinal!.status === 'cancelado' && Boolean(negocioFinal!.recusa_motivo))

    /* Com uma avaliação feita, a ordem da fila passa a ser por chegada. */
    const { data: pendentes2 } = await supabase
      .from('deals')
      .select('id, deal_type, rent_price_cents, sale_price_cents, created_at')
      .eq('property_id', imovelId!)
      .eq('status', 'proposta')
    ok('proposta do Paulo continua na fila', (pendentes2 ?? []).length === 1)
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

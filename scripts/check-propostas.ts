import { readFileSync } from 'node:fs'
import { ordenarPropostas } from '../lib/negocios/propostas'
import { validarCondicoes } from '../lib/negocios/condicoes'
import { MAX_CENTAVOS, paraCentavos, paraTextoReais } from '../lib/utils/dinheiro'
import { validarAnexo } from '../lib/negocios/documentos'

/* Fila de propostas. Rodar com: npm run check:propostas

   NÃO chama a OpenAI nem o banco — exercita a regra de ordenação (pura) e
   verifica ESTRUTURALMENTE que a proposta não trava mais o imóvel.

   O que está sendo protegido: o create_deal reservava o imóvel no momento da
   proposta — uma oferta de 750k num imóvel de 820k o tirava da vitrine antes
   de o proprietário saber, e escondia o imóvel de quem pagaria o anunciado.
   Agora a proposta entra numa fila; quem reserva é o ACEITE no painel, que
   também abre a coleta de documentos. */

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

function p(id: string, valorCents: number | null, createdAt: string) {
  return { id, valorCents, createdAt }
}

function main() {
  // ================= Ordem da fila =================
  console.log('--- Nenhuma proposta avaliada: maior valor primeiro ---')

  const fila = [
    p('cedo-menor', 700_000_00, '2026-08-17T10:00:00Z'),
    p('tarde-maior', 800_000_00, '2026-08-17T15:00:00Z'),
    p('meio', 750_000_00, '2026-08-17T12:00:00Z'),
  ]

  const semAvaliacao = ordenarPropostas(fila, false).map((x) => x.id)
  ok('maior valor vem primeiro, mesmo tendo chegado depois', semAvaliacao.join(',') === 'tarde-maior,meio,cedo-menor', semAvaliacao.join(','))

  const empate = ordenarPropostas(
    [p('b-depois', 800_000_00, '2026-08-17T15:00:00Z'), p('a-antes', 800_000_00, '2026-08-17T10:00:00Z')],
    false
  ).map((x) => x.id)
  ok('empate de valor desempata por chegada', empate.join(',') === 'a-antes,b-depois', empate.join(','))

  console.log('\n--- Alguma já foi avaliada: vale a ordem de chegada ---')

  const comAvaliacao = ordenarPropostas(fila, true).map((x) => x.id)
  ok('ordem de chegada, ignorando valor', comAvaliacao.join(',') === 'cedo-menor,meio,tarde-maior', comAvaliacao.join(','))

  ok('valor nulo conta como zero (vai para o fim quando ninguém foi avaliado)', ordenarPropostas([p('sem-valor', null, '2026-08-17T09:00:00Z'), p('com-valor', 1, '2026-08-17T16:00:00Z')], false)[0].id === 'com-valor')
  ok('não muta a lista original', (() => { const antes = [...fila]; ordenarPropostas(fila, false); return fila.every((x, i) => x === antes[i]) })())

  // ================= Estrutural: proposta não trava o imóvel =================
  console.log('\n--- Estrutural ---')

  const leasing = readFileSync('lib/agents/tools/leasing.ts', 'utf-8')
  ok("create_deal grava status 'proposta'", leasing.includes("status: 'proposta'"))
  ok("create_deal NÃO reserva o imóvel (nenhum update para 'reservado' em leasing.ts)", !leasing.includes("status: 'reservado'"))
  ok('request_documents recusa proposta não aceita', leasing.includes('proposta_ainda_nao_aceita'))

  const propostas = readFileSync('lib/negocios/propostas.ts', 'utf-8')
  ok('a reserva mora no ACEITE', propostas.includes("status: 'reservado'"))
  ok("aceite só reserva imóvel 'disponivel' (não sobrescreve outra reserva)", propostas.includes(".eq('status', 'disponivel')"))
  ok('aceite abre a coleta de documentos', propostas.includes('documentos_solicitados'))
  ok('desfazer devolve o imóvel à vitrine', propostas.includes("status: 'disponivel'"))
  ok("desfazer não alcança contrato ativo", propostas.includes("n.status !== 'em_aprovacao' && n.status !== 'aprovado'"))

  const docsRoute = readFileSync('app/api/admin/documentos/[id]/route.ts', 'utf-8')
  ok('documento reprovado avisa o cliente com o motivo', docsRoute.includes('avisarCliente'))

  // ================= Condições do negócio (o que o contrato lê) =================
  console.log('\n--- validarCondicoes ---')

  const vVenda = validarCondicoes('venda', { sale_price_cents: 82_000_000, down_payment_cents: 5_000_000, financing_type: 'financiado', itbi_status: 'pendente' }, {})
  ok('venda válida normaliza os quatro campos', vVenda.ok && Object.keys(vVenda.campos).length === 4)
  ok('sinal zero é aceito (à vista, sem sinal) — não é lacuna', (() => { const r = validarCondicoes('venda', { down_payment_cents: 0 }, { sale_price_cents: 1 }); return r.ok && r.campos.down_payment_cents === 0 })())
  ok('sinal maior que o preço falha', !validarCondicoes('venda', { down_payment_cents: 90_000_000 }, { sale_price_cents: 82_000_000 }).ok)
  ok('sinal compara com o preço NOVO quando os dois mudam', validarCondicoes('venda', { sale_price_cents: 100, down_payment_cents: 90 }, { sale_price_cents: 10 }).ok)
  ok('venda com preço zero falha', !validarCondicoes('venda', { sale_price_cents: 0 }, {}).ok)
  ok('forma de pagamento fora do enum falha', !validarCondicoes('venda', { financing_type: 'cheque' as never }, {}).ok)
  ok('venda nunca grava coluna de locação', !('rent_price_cents' in (validarCondicoes('venda', { rent_price_cents: 100 } as never, {}) as { campos: object }).campos))
  ok('campo ausente não é tocado; null limpa', (() => { const r = validarCondicoes('venda', { financing_type: null }, {}); return r.ok && r.campos.financing_type === null && !('sale_price_cents' in r.campos) })())

  const vLoc = validarCondicoes('locacao', { rent_price_cents: 350_000, start_date: '2026-09-01', end_date: '2029-08-31', notice_period_days: 30 }, {})
  ok('locação válida', vLoc.ok && Object.keys(vLoc.campos).length === 4)
  ok('término antes do início falha', !validarCondicoes('locacao', { start_date: '2026-09-01', end_date: '2026-08-01' }, {}).ok)
  ok('término compara com o início JÁ gravado', !validarCondicoes('locacao', { end_date: '2026-08-01' }, { start_date: '2026-09-01' }).ok)
  ok('data fora do formato falha', !validarCondicoes('locacao', { start_date: '01/09/2026' }, {}).ok)
  ok('aviso prévio de 400 dias falha', !validarCondicoes('locacao', { notice_period_days: 400 }, {}).ok)
  ok('locação nunca grava coluna de venda', !('sale_price_cents' in (validarCondicoes('locacao', { sale_price_cents: 1 } as never, {}) as { campos: object }).campos))

  // ================= Dinheiro digitado (o bug do "não foi possível salvar") =================
  console.log('\n--- paraCentavos / paraTextoReais ---')

  ok('pré-preenchido em pt-BR', paraTextoReais(82_000_000) === '820.000,00', paraTextoReais(82_000_000))
  ok('ida e volta: o que a tela mostra, o parser lê de volta IGUAL', paraCentavos(paraTextoReais(82_000_000)) === 82_000_000, String(paraCentavos(paraTextoReais(82_000_000))))
  ok("'820000' (sem separador)", paraCentavos('820000') === 82_000_000)
  ok("'820000,50' (vírgula decimal)", paraCentavos('820000,50') === 82_000_050)
  ok("'820.000,00' (pt-BR completo)", paraCentavos('820.000,00') === 82_000_000)
  ok("'1.250.000' (só milhares)", paraCentavos('1.250.000') === 125_000_000)
  ok("'820000.50' (ponto decimal, à americana) NÃO vira 82 milhões", paraCentavos('820000.50') === 82_000_050, String(paraCentavos('820000.50')))
  ok("'R$ 3.500,00' aceita prefixo e espaço", paraCentavos('R$ 3.500,00') === 350_000)
  ok('vazio → null', paraCentavos('') === null && paraTextoReais(null) === '')
  ok('lixo → NaN', Number.isNaN(paraCentavos('abc') as number))
  ok('zero → 0 (sem sinal)', paraCentavos('0') === 0)
  ok('valor acima do INTEGER é recusado com mensagem clara, não 500', (() => { const r = validarCondicoes('venda', { sale_price_cents: MAX_CENTAVOS + 1 }, {}); return !r.ok && r.erro.includes('limite') })())

  // ================= Via assinada pelo WhatsApp + documento pelo painel =================
  console.log('\n--- Via assinada e anexo pelo painel ---')

  const zapi = readFileSync('app/api/webhook/zapi/route.ts', 'utf-8')
  const meta = readFileSync('app/api/webhook/meta/route.ts', 'utf-8')
  ok('webhook Z-API detecta contrato esperando assinatura antes de tratar como documento', (() => {
    // Olha só o ramo de `document`: o ramo de imagem (acima) também chama receberDocumento.
    const ramo = zapi.slice(zapi.indexOf("messageType === 'document'"))
    return ramo.indexOf('negocioAguardandoAssinatura(contact.id)') > -1 && ramo.indexOf('negocioAguardandoAssinatura(contact.id)') < ramo.indexOf('receberDocumento({')
  })())
  ok('webhook Meta idem', meta.includes('negocioAguardandoAssinatura') && meta.includes('guardarViaAssinada'))
  ok('a mensagem ao agente manda NÃO pedir documentos', zapi.includes('NÃO peça documentos') && meta.includes('NÃO peça documentos'))

  const via = readFileSync('lib/leasing/via-assinada.ts', 'utf-8')
  ok('via assinada só aceita PDF', via.includes("!== 'application/pdf'"))
  ok('candidato NÃO grava contract_signed_at (só a confirmação humana grava)', (() => {
    const guardar = via.slice(via.indexOf('export async function guardarViaAssinada'), via.indexOf('export async function urlViaAssinadaCandidata'))
    return !guardar.includes('contract_signed_at')
  })())
  ok('confirmação grava contract_signed_at e limpa o candidato', (() => {
    const conf = via.slice(via.indexOf('export async function confirmarViaAssinada'), via.indexOf('export async function rejeitarViaAssinada'))
    return conf.includes('contract_signed_at') && conf.includes('signed_candidate_url: null')
  })())
  ok('"não é o contrato" devolve o arquivo à fila de documentos', via.includes("type: 'outro'"))

  const tools = readFileSync('lib/agents/tools/leasing.ts', 'utf-8')
  ok('request_documents recusa com contrato em assinatura', tools.includes('contrato_em_assinatura'))
  ok('request_documents devolve só o que falta (já recebido por outro canal não se pede)', tools.includes('faltam: faltam.map(rotulo)'))
  ok('documento reprovado volta a contar como faltando', tools.includes("d.status !== 'rejeitado'"))

  ok('validarAnexo aceita PDF de tipo conhecido', validarAnexo('rg_cnh', 'application/pdf', 1000).ok)
  ok('validarAnexo aceita imagem', validarAnexo('comprovante_renda', 'image/jpeg', 1000).ok)
  ok('validarAnexo recusa tipo inventado', !validarAnexo('passaporte', 'application/pdf', 1000).ok)
  ok('validarAnexo recusa docx', !validarAnexo('rg_cnh', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 1000).ok)
  ok('validarAnexo recusa vazio e >10MB', !validarAnexo('rg_cnh', 'application/pdf', 0).ok && !validarAnexo('rg_cnh', 'application/pdf', 11 * 1024 * 1024).ok)

  // ================= Funil acompanha o contrato =================
  console.log('\n--- Funil e papéis no fechamento ---')

  const funil = readFileSync('lib/negocios/funil.ts', 'utf-8')
  const ativacao = readFileSync('app/api/admin/deals/[id]/signed-document/route.ts', 'utf-8')
  const props = readFileSync('lib/negocios/propostas.ts', 'utf-8')
  ok('ativação do contrato move o cliente para convertido', ativacao.includes('marcarConvertido'))
  ok("funil.ts grava 'convertido'", funil.includes("funnel_stage: 'convertido'"))
  ok('locação ativada grava o papel inquilino_ativo (roteia o Suporte)', funil.includes("role: 'inquilino_ativo'"))
  ok('recusar proposta recua o funil se não sobrou negócio vivo', (() => {
    const recusa = props.slice(props.indexOf('export async function recusarProposta'), props.indexOf('export async function desfazerNegocio'))
    return recusa.includes('recuarFunilSeSemNegocioVivo')
  })())
  ok('desfazer negócio idem', props.slice(props.indexOf('export async function desfazerNegocio')).includes('recuarFunilSeSemNegocioVivo'))
  ok("recuo só toca quem está em 'em_negociacao' (não sobrescreve estágio manual)", funil.includes(".eq('funnel_stage', 'em_negociacao')"))
  ok('recuo só quando NÃO há negócio vivo (proposta na fila segura o estágio)', funil.includes("['proposta', 'em_aprovacao', 'aprovado', 'ativo', 'encerramento_solicitado']"))

  console.log(process.exitCode ? '\nHouve falhas.' : '\nTudo certo.')
}

main()

import { readFileSync } from 'node:fs'
import { ordenarPropostas } from '../lib/negocios/propostas'

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

  console.log(process.exitCode ? '\nHouve falhas.' : '\nTudo certo.')
}

main()

import 'dotenv/config'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { createAdminClient } from '../lib/supabase/admin'
import { chunkDocument } from '../lib/rag/chunker'
import { extrairTexto } from '../lib/rag/extrair'
import { indexarMaterial, removerMaterial, listarMateriais } from '../lib/rag/indexar'
import { buscarNoConhecimento } from '../lib/rag/retriever'
import { gerarEmbedding } from '../lib/rag/embedder'
import { handleSearchKnowledgeBase } from '../lib/agents/tools/conhecimento'

/* RAG institucional (PRD 11.1). Rodar com: npm run check:rag
   (o servidor de dev precisa estar no ar para a checagem HTTP)

   CHAMA A OPENAI — embeddings dos chunks e das consultas.

   Duas coisas estão sendo protegidas:

   1. QUE O AGENTE NÃO INVENTE. Material que não responde à pergunta tem que
      voltar como "não encontrei", com instrução explícita de não completar de
      memória. Em financiamento e documentação, uma regra inventada vira decisão
      errada de dezenas de milhares de reais.
   2. QUE ARQUIVO ILEGÍVEL SEJA RECUSADO. Uma extração ingênua lê o binário do
      PDF e tira caracteres não imprimíveis — num PDF comprimido isso produz
      ruído que entraria como material 'indexado'. Falha que se parece com
      sucesso é a mais cara de descobrir. */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const supabase = createAdminClient()
const criados: string[] = []

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

async function limpar() {
  for (const id of criados) {
    const { error } = await supabase.from('rag_documents').delete().eq('id', id)
    if (error) throw new Error(`limpeza falhou para ${id}: ${error.message}`)
  }
  criados.length = 0

  // Rede para execução interrompida: só o que tem a marca do teste.
  const { data: sobras } = await supabase
    .from('rag_documents')
    .select('id')
    .like('title', '[teste]%')
  for (const s of sobras ?? []) await supabase.from('rag_documents').delete().eq('id', s.id)
}

const TEXTO_POLITICA = `Política de financiamento imobiliário da LoveHome

Entrada mínima
Para imóveis financiados pelo Sistema Financeiro de Habitação, a entrada mínima aceita é de
20% do valor do imóvel. Em imóveis acima de um milhão e quinhentos mil reais, a entrada
mínima sobe para 30%, porque a operação sai do SFH e passa para a carteira hipotecária.

Prazo
O prazo máximo de financiamento é de 360 meses. A idade do comprador somada ao prazo não
pode ultrapassar 80 anos e 6 meses, que é a regra da maioria dos bancos parceiros.

Comprovação de renda
A parcela não pode comprometer mais de 30% da renda familiar bruta comprovada. Aceitamos
composição de renda entre cônjuges e entre parentes de primeiro grau.

ITBI e escritura
O ITBI em São Paulo é de 3% sobre o valor venal de referência e é pago pelo comprador antes
do registro. A escritura e o registro somam aproximadamente mais 1,5% do valor do imóvel.
Esses custos não entram no financiamento e precisam estar disponíveis em dinheiro.

Caução na locação
Na locação sem fiador, aceitamos caução de até três aluguéis, depositada em conta poupança
vinculada ao contrato. O aviso prévio para desocupação é de 30 dias.`

async function pdfComTexto(texto: string): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const fonte = await doc.embedFont(StandardFonts.Helvetica)
  const pagina = doc.addPage([595, 842])
  let y = 800
  for (const linha of texto.split('\n')) {
    if (y < 40) break
    pagina.drawText(linha.slice(0, 95), { x: 40, y, size: 9, font: fonte })
    y -= 13
  }
  return Buffer.from(await doc.save())
}

/** PDF válido e sem uma letra dentro — é o que um documento escaneado parece ao extrator. */
async function pdfSemTexto(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  doc.addPage([595, 842])
  return Buffer.from(await doc.save())
}

async function criarDocumento(title: string, categoria: string) {
  const { data, error } = await supabase
    .from('rag_documents')
    .insert({ title, categoria, status: 'processando', file_type: 'txt' })
    .select('id')
    .single()
  if (error) throw new Error(`documento: ${error.message}`)
  criados.push(data.id)
  return data.id as string
}

async function main() {
  await limpar()

  // ================= Chunker =================
  console.log('--- Chunker ---')

  /* O texto de política inteiro cabe em um chunk de 400 tokens, e isso é o
     comportamento CERTO — documento curto não deve ser picado. Para exercitar a
     divisão de verdade é preciso um teto menor. A asserção antiga exigia
     `> 1 chunk` sobre este texto e falhava desde sempre. */
  const inteiro = chunkDocument(TEXTO_POLITICA)
  ok('documento curto não é picado à toa', inteiro.length === 1, `${inteiro.length} chunks`)

  const divididos = chunkDocument(TEXTO_POLITICA, { maxTokens: 60 })
  ok('divide quando passa do teto', divididos.length > 1, `${divididos.length} chunks`)
  ok('todo trecho tem conteúdo', divididos.every((c) => c.content.trim().length > 0))
  ok('índices em sequência', divididos.every((c, i) => c.chunkIndex === i))
  ok(
    'nenhum trecho estoura muito o teto',
    divididos.every((c) => c.tokenCount <= 120),
    `maior: ${Math.max(...divididos.map((c) => c.tokenCount))}`
  )
  /* O documento inteiro precisa continuar recuperável a partir dos pedaços:
     um chunker que perde texto no meio some com uma cláusula inteira sem
     nenhum sinal. */
  ok(
    'nenhuma seção some na divisão',
    divididos.some((c) => c.content.includes('ITBI')) &&
      divididos.some((c) => c.content.includes('20%')) &&
      divididos.some((c) => c.content.includes('caução')),
    divididos.map((c) => c.tokenCount).join(',')
  )

  // ================= Extração =================
  console.log('\n--- Extração de texto ---')

  const txt = await extrairTexto(Buffer.from(TEXTO_POLITICA, 'utf-8'), 'politica.txt')
  ok('lê .txt', txt.ok === true && txt.texto.includes('ITBI'))

  const pdf = await extrairTexto(await pdfComTexto(TEXTO_POLITICA), 'politica.pdf')
  ok('lê PDF de verdade', pdf.ok === true, pdf.ok ? '' : pdf.erro)
  if (pdf.ok) {
    /* A prova de que a extração é real e não ruído binário: o conteúdo tem que
       aparecer em texto legível. */
    ok('o texto do PDF sai legível', pdf.texto.includes('ITBI') && pdf.texto.includes('financiamento'), pdf.texto.slice(0, 80))
  }

  const escaneado = await extrairTexto(await pdfSemTexto(), 'escaneado.pdf')
  /* Se isto virar `ok: true`, um PDF escaneado entra como material indexado e o
     agente passa a citar nada — ou pior, ruído — como política da imobiliária. */
  ok('PDF sem texto é RECUSADO, não indexado vazio', escaneado.ok === false)
  if (!escaneado.ok) ok('e o erro explica o que fazer', /OCR|escaneado/i.test(escaneado.erro), escaneado.erro)

  const docx = await extrairTexto(Buffer.from('qualquer coisa'), 'contrato.docx')
  ok('formato não suportado é recusado com clareza', docx.ok === false && /docx/i.test(docx.ok === false ? docx.erro : ''))

  const vazio = await extrairTexto(Buffer.from('oi'), 'curto.txt')
  ok('arquivo praticamente vazio é recusado', vazio.ok === false)

  // ================= Indexação =================
  console.log('\n--- Indexação ---')

  const idPolitica = await criarDocumento('[teste] Política de financiamento', 'financiamento')
  const r = await indexarMaterial({
    documentId: idPolitica,
    buffer: Buffer.from(TEXTO_POLITICA, 'utf-8'),
    nomeArquivo: 'politica.txt',
  })

  ok('indexou', r.ok === true, r.ok ? '' : r.erro)
  ok('gravou trechos', r.ok === true && r.chunks > 0, r.ok ? `${r.chunks}` : '')

  const { data: doc } = await supabase
    .from('rag_documents')
    .select('status, chunk_count, indexed_at')
    .eq('id', idPolitica)
    .single()
  ok('status virou indexado', doc?.status === 'indexado', doc?.status ?? '')
  ok('contagem de trechos bate', doc?.chunk_count === (r.ok ? r.chunks : -1))

  const { count: comVetor } = await supabase
    .from('rag_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('document_id', idPolitica)
    .not('embedding', 'is', null)
  ok('todo trecho tem vetor', comVetor === doc?.chunk_count, `${comVetor} de ${doc?.chunk_count}`)

  /* Reenviar o mesmo material não pode duplicar: o agente receberia o mesmo
     trecho duas vezes e gastaria contexto à toa. */
  const denovo = await indexarMaterial({
    documentId: idPolitica,
    buffer: Buffer.from(TEXTO_POLITICA, 'utf-8'),
    nomeArquivo: 'politica.txt',
  })
  const { count: depois } = await supabase
    .from('rag_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('document_id', idPolitica)
  ok('reindexar NÃO duplica trechos', denovo.ok === true && depois === doc?.chunk_count, `${depois}`)

  // ================= Busca =================
  console.log('\n--- Busca ---')

  const sobreItbi = await buscarNoConhecimento({ consulta: 'quanto custa o ITBI em São Paulo?' })
  ok('acha o trecho certo', sobreItbi.length > 0 && sobreItbi.some((t) => t.content.includes('3%')), `${sobreItbi.length} trechos`)
  if (sobreItbi.length) console.log(`INFO  melhor: ${(sobreItbi[0].similaridade * 100).toFixed(0)}% — "${sobreItbi[0].content.slice(0, 70)}..."`)

  const entrada = await buscarNoConhecimento({ consulta: 'qual a entrada mínima para financiar?' })
  ok('acha por pergunta escrita de outro jeito', entrada.length > 0 && entrada.some((t) => t.content.includes('20%')))

  const porCategoria = await buscarNoConhecimento({
    consulta: 'entrada mínima',
    categoria: 'politicas',
  })
  ok('filtro de categoria exclui outra categoria', porCategoria.length === 0, `${porCategoria.length}`)

  // ================= A tool do agente =================
  console.log('\n--- Tool do agente ---')

  const achou = (await handleSearchKnowledgeBase({ pergunta: 'preciso de quanto de entrada?' })) as {
    encontrado: boolean
    trechos?: unknown[]
    instrucao: string
  }
  ok('tool devolve trechos', achou.encontrado === true && (achou.trechos?.length ?? 0) > 0)
  ok('e manda não citar o nome do documento', /não cite o nome/i.test(achou.instrucao))

  const naoAchou = (await handleSearchKnowledgeBase({
    pergunta: 'qual a taxa de manutenção da piscina do condomínio Vila Nova?',
  })) as { encontrado: boolean; instrucao: string }

  /* A instrução aqui é o que impede o modelo de preencher o vazio com uma regra
     plausível. Se ela sumir, o agente inventa percentual de financiamento. */
  ok('sem material, diz que não encontrou', naoAchou.encontrado === false)
  ok('e proíbe explicitamente inventar', /não invente/i.test(naoAchou.instrucao), naoAchou.instrucao.slice(0, 60))

  // ================= Status filtra a busca =================
  console.log('\n--- Material não indexado não é consultado ---')

  const idErro = await criarDocumento('[teste] Material com erro', 'geral')
  const TEXTO_SECRETO = 'A taxa secreta de corretagem da LoveHome é de 42 por cento.'
  await supabase.from('rag_chunks').insert({
    document_id: idErro,
    content: TEXTO_SECRETO,
    chunk_index: 0,
    token_count: 12,
    embedding: await gerarEmbedding(TEXTO_SECRETO),
  })
  await supabase.from('rag_documents').update({ status: 'erro' }).eq('id', idErro)

  const naoDeveAchar = await buscarNoConhecimento({ consulta: 'taxa secreta de corretagem' })
  /* Material 'erro' ou 'processando' não pode ser citado: é conteúdo que ainda
     não passou pela indexação completa, ou que falhou no meio. */
  ok(
    'trecho de material com erro NÃO aparece na busca',
    !naoDeveAchar.some((t) => t.content.includes('42 por cento')),
    naoDeveAchar.map((t) => t.documento).join(', ')
  )

  // ================= Rota =================
  console.log('\n--- Rota ---')

  const semSessao = await fetch(`${BASE}/api/rag/upload`, { method: 'POST', body: new FormData() })
  ok('upload exige sessão', semSessao.status === 401, `status ${semSessao.status}`)

  const deleteSemSessao = await fetch(`${BASE}/api/rag/documents/${idPolitica}`, { method: 'DELETE' })
  ok('remoção exige sessão', deleteSemSessao.status === 401, `status ${deleteSemSessao.status}`)

  // ================= Listagem e remoção =================
  console.log('\n--- Listagem e remoção ---')

  const lista = await listarMateriais()
  ok('a tela enxerga o material', lista.some((m) => m.id === idPolitica))

  await removerMaterial(idPolitica)
  criados.splice(criados.indexOf(idPolitica), 1)

  const { count: orfaos } = await supabase
    .from('rag_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('document_id', idPolitica)
  ok('remover o material leva os trechos junto', orfaos === 0, `${orfaos} órfãos`)

  await limpar()
  console.log('\nDados de teste removidos.')
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})

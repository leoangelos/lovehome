import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import { preencherContrato } from '../lib/leasing/contract-template'
import { gerarPdfContrato } from '../lib/leasing/pdf'
import { PDFDocument } from 'pdf-lib'
import { decryptSecret } from '../lib/crypto/encrypt'

/* Geração de contrato (PRD 15.1 e 15.3). Rodar com: npm run check:contrato
   NÃO chama a OpenAI — é template, não modelo.

   Cobre o preenchimento, o PDF, e sobretudo que o contrato NÃO é público:
   ele carrega CPF completo, endereço e valores. */

const supabase = createAdminClient()
const criados: string[] = []

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

async function limpar() {
  if (criados.length) {
    await supabase.storage.from('contratos').remove(criados)
    criados.length = 0
  }
}

async function main() {
  // ---- Templates ----
  const { data: templates } = await supabase
    .from('contract_templates')
    .select('deal_type, name, is_active')
    .eq('is_active', true)

  ok('template de locação existe', (templates ?? []).some((t) => t.deal_type === 'locacao'))
  ok('template de venda existe', (templates ?? []).some((t) => t.deal_type === 'venda'))

  // ---- Negócio ativo do seed (locação da Bianca no LH-1010) ----
  const { data: negocio } = await supabase
    .from('deals')
    .select('id, deal_type, status, client_registration_id, rent_price_cents')
    .eq('deal_type', 'locacao')
    .eq('status', 'ativo')
    .limit(1)
    .maybeSingle()

  if (!negocio) throw new Error('sem locação ativa no seed — rode npm run seed')

  console.log(`\n--- Preenchendo o contrato da locação ${negocio.id.slice(0, 8)} ---`)
  const resultado = await preencherContrato(negocio.id)
  ok('preencheu sem erro', resultado.ok, resultado.ok ? '' : resultado.erro)
  if (!resultado.ok) return

  const { contrato } = resultado
  const texto = contrato.texto

  ok('nenhum placeholder sobrou', !/\{\{\w+\}\}/.test(texto), (texto.match(/\{\{\w+\}\}/g) ?? []).join(', '))
  ok('trouxe o nome do cliente', texto.includes(contrato.nomeCliente), contrato.nomeCliente)
  ok('trouxe o valor do aluguel', /R\$\s?[\d.]+,\d{2}/.test(texto))
  ok('trouxe o prazo de aviso', /30 dias/.test(texto))

  /* O contrato precisa do CPF INTEIRO — é documento legal, e este é o único
     lugar do sistema autorizado a descriptografar (PRD 6.2). Confere contra o
     valor real do banco em vez de só procurar um padrão. */
  const { data: cadastro } = await supabase
    .from('registrations')
    .select('cpf_encrypted, cpf_last4')
    .eq('id', negocio.client_registration_id)
    .single()

  const cpfReal = decryptSecret(cadastro!.cpf_encrypted)
  const cpfFormatado = `${cpfReal.slice(0, 3)}.${cpfReal.slice(3, 6)}.${cpfReal.slice(6, 9)}-${cpfReal.slice(9)}`
  ok('CPF do cliente aparece completo e correto', texto.includes(cpfFormatado))
  ok('CPF não aparece mascarado no contrato', !texto.includes('***'))

  if (contrato.lacunas.length) {
    console.log(`INFO  lacunas assinaladas: ${contrato.lacunas.join(', ')}`)
    ok(
      'lacuna aparece marcada no texto, não em branco',
      /\[.+NÃO INFORMADO\]/.test(texto)
    )
  }

  // ---- PDF ----
  const pdf = await gerarPdfContrato({ texto, rodape: 'LoveHome · teste' })
  ok('gerou bytes de PDF', pdf.length > 1000, `${pdf.length} bytes`)

  const cabecalho = Buffer.from(pdf.slice(0, 5)).toString('latin1')
  ok('arquivo é um PDF de verdade', cabecalho === '%PDF-', cabecalho)

  /* Contar abrindo o PDF, não por regex no binário: o pdf-lib comprime os
     streams, então a estrutura não aparece como texto. */
  const relido = await PDFDocument.load(pdf)
  const paginas = relido.getPageCount()
  ok('paginou o documento', paginas >= 1, `${paginas} página(s)`)
  ok('cabe em poucas páginas', paginas <= 4, `${paginas} páginas`)

  // ---- Bucket privado ----
  console.log('\n--- Bucket de contratos ---')
  const caminho = `teste/${Date.now()}.pdf`
  const { error: erroUpload } = await supabase.storage
    .from('contratos')
    .upload(caminho, pdf, { contentType: 'application/pdf' })
  ok('subiu para o bucket', !erroUpload, erroUpload?.message ?? '')
  if (!erroUpload) criados.push(caminho)

  const { data: publica } = supabase.storage.from('contratos').getPublicUrl(caminho)
  const tentativaPublica = await fetch(publica.publicUrl)
  /* Se isto passar a devolver 200, contrato com CPF virou documento público na
     internet. É a verificação mais importante deste arquivo. */
  ok(
    'URL pública NÃO abre o contrato',
    tentativaPublica.status >= 400,
    `status ${tentativaPublica.status}`
  )

  const { data: assinada } = await supabase.storage
    .from('contratos')
    .createSignedUrl(caminho, 60)
  const tentativaAssinada = await fetch(assinada!.signedUrl)
  ok('URL assinada abre', tentativaAssinada.status === 200, `status ${tentativaAssinada.status}`)
  ok(
    'e devolve um PDF',
    tentativaAssinada.headers.get('content-type')?.includes('pdf') === true,
    String(tentativaAssinada.headers.get('content-type'))
  )

  // ---- Negócio não aprovado não gera contrato ----
  const { data: emAprovacao } = await supabase
    .from('deals')
    .select('id')
    .eq('status', 'em_aprovacao')
    .limit(1)
    .maybeSingle()

  if (emAprovacao) {
    const recusa = await preencherContrato(emAprovacao.id)
    ok(
      'negócio em aprovação não gera contrato',
      !recusa.ok,
      recusa.ok ? 'gerou!' : recusa.erro
    )
  }

  await limpar()
  console.log('\nArquivos de teste removidos.')
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})

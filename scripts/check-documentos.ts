import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'
import { gerarPdfContrato } from '../lib/leasing/pdf'
import { handleConfirmDocumentReceived } from '../lib/agents/tools/leasing'

/* Recebimento de documento por WhatsApp (PRD 12.5). Rodar com:
     npm run check:documentos
   (o servidor de dev precisa estar no ar)

   NÃO chama a OpenAI — o caminho testado é webhook → download → bucket.

   Cobre o que mais importa: a URL de mídia do Z-API expira, então o arquivo
   precisa ser baixado e guardado NA HORA. E o bucket precisa ser privado. */

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const TELEFONE = '5511977005678'
const supabase = createAdminClient()

const arquivosCriados: string[] = []
let contactId: string | null = null
let registrationId: string | null = null

function ok(rotulo: string, condicao: boolean, detalhe = '') {
  console.log(`${condicao ? 'OK  ' : 'FALHA'} ${rotulo}${condicao || !detalhe ? '' : ` — ${detalhe}`}`)
  if (!condicao) process.exitCode = 1
}

async function limpar() {
  if (contactId) {
    const { error } = await supabase.from('contacts').delete().eq('id', contactId)
    if (error) throw new Error(`limpeza do contato falhou: ${error.message}`)
    contactId = null
  }
  if (registrationId) {
    await supabase.from('documents').delete().eq('registration_id', registrationId)
    await supabase.from('registrations').delete().eq('id', registrationId)
    registrationId = null
  }
  if (arquivosCriados.length) {
    await supabase.storage.from('documentos').remove(arquivosCriados)
    await supabase.storage.from('contratos').remove(arquivosCriados)
    arquivosCriados.length = 0
  }
}

/** URL fetchável que devolve application/pdf — faz o papel da mídia do Z-API. */
async function urlDeMidiaFalsa(): Promise<string> {
  const pdf = await gerarPdfContrato({
    texto: 'RG\n\nDocumento de teste enviado pelo cliente.',
    rodape: 'teste',
  })
  const caminho = `teste-midia/${Date.now()}.pdf`
  await supabase.storage
    .from('contratos')
    .upload(caminho, pdf, { contentType: 'application/pdf' })
  arquivosCriados.push(caminho)

  const { data } = await supabase.storage.from('contratos').createSignedUrl(caminho, 600)
  return data!.signedUrl
}

function payloadDocumento(messageId: string, url: string, titulo: string) {
  return {
    phone: TELEFONE,
    instanceId: 'teste',
    messageId,
    fromMe: false,
    momment: new Date().toISOString(),
    status: 'RECEIVED',
    chatName: 'Cliente Teste Doc',
    senderPhoto: '',
    senderName: 'Cliente Teste Doc',
    participantPhone: null,
    isGroup: false,
    isNewsletter: false,
    document: { documentUrl: url, title: titulo, mimeType: 'application/pdf' },
  }
}

async function main() {
  await limpar()
  const carimbo = Date.now()

  // ---- Contato com cadastro e negócio aberto ----
  const { data: cadastro } = await supabase
    .from('registrations')
    .insert({
      cpf_hash: `teste-doc-${carimbo}`,
      cpf_encrypted: 'v1:teste',
      cpf_last4: '0000',
      full_name: 'Cliente Teste Documento',
      email: `doc${carimbo}@teste.local`,
      address: { city: 'São Paulo', state: 'SP' },
    })
    .select('id')
    .single()
  registrationId = cadastro!.id

  await supabase.from('contact_roles').insert({ registration_id: registrationId, role: 'interessado' })

  const { data: contato } = await supabase
    .from('contacts')
    .insert({
      phone: TELEFONE,
      phone_key: TELEFONE.slice(-8),
      name: 'Cliente Teste Doc',
      registration_id: registrationId,
      registration_status: 'completo',
      funnel_stage: 'em_negociacao',
    })
    .select('id')
    .single()
  contactId = contato!.id

  const { data: imovel } = await supabase
    .from('properties')
    .select('id')
    .eq('status', 'disponivel')
    .limit(1)
    .single()

  const { data: negocio } = await supabase
    .from('deals')
    .insert({
      deal_type: 'locacao',
      property_id: imovel!.id,
      client_registration_id: registrationId,
      status: 'em_aprovacao',
      rent_price_cents: 300000,
      documentos_solicitados: ['rg_cnh', 'comprovante_renda', 'comprovante_residencia'],
      documentos_solicitados_em: new Date().toISOString(),
    })
    .select('id')
    .single()

  console.log('--- Documento chegando pelo WhatsApp ---')

  const url = await urlDeMidiaFalsa()
  const r = await fetch(`${BASE}/api/webhook/zapi`, {
    method: 'POST',
    /* O webhook exige o segredo — sem ele responde 403/401 antes de ler o corpo.
       Vem do mesmo lugar que a rota lê: ZAPI_WEBHOOK_SECRET (ou a tela de Canais). */
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-token': process.env.ZAPI_WEBHOOK_SECRET ?? '',
    },
    body: JSON.stringify(payloadDocumento(`doc-${carimbo}`, url, 'rg-frente.pdf')),
  })
  const corpo = await r.json()
  ok('webhook aceitou o documento', r.status === 200, JSON.stringify(corpo))

  // O download acontece antes da fila, então já deve estar guardado.
  const { data: documentos } = await supabase
    .from('documents')
    .select('id, type, status, storage_path, deal_id')
    .eq('registration_id', registrationId)

  ok('arquivo virou documento no banco', (documentos ?? []).length === 1, `${documentos?.length}`)

  const doc = documentos?.[0]
  if (doc) {
    ok('nasce como "outro" para o agente classificar', doc.type === 'outro', doc.type)
    ok('entra na fila de conferência', doc.status === 'pendente_revisao')
    ok('foi anexado ao negócio aberto', doc.deal_id === negocio!.id)
    ok(
      'tem caminho real de storage, não referência à conversa',
      !doc.storage_path.startsWith('whatsapp://'),
      doc.storage_path
    )
    arquivosCriados.push(doc.storage_path)

    // ---- Privacidade do bucket ----
    const { data: publica } = supabase.storage.from('documentos').getPublicUrl(doc.storage_path)
    const tentativa = await fetch(publica.publicUrl)
    /* Se isto virar 200, RG e comprovante de renda ficaram públicos. */
    ok('URL pública NÃO abre o documento', tentativa.status >= 400, `status ${tentativa.status}`)

    const { data: assinada } = await supabase.storage
      .from('documentos')
      .createSignedUrl(doc.storage_path, 60)
    const comAssinatura = await fetch(assinada!.signedUrl)
    ok('URL assinada abre', comAssinatura.status === 200, `status ${comAssinatura.status}`)

    const bytes = await comAssinatura.arrayBuffer()
    ok('o arquivo guardado é o que foi enviado', bytes.byteLength > 500, `${bytes.byteLength} bytes`)

    // ---- Classificação pelo agente ----
    console.log('\n--- Agente classificando o que já foi guardado ---')
    const resultado = await handleConfirmDocumentReceived(contactId!, {
      deal_id: negocio!.id,
      tipo: 'rg_cnh',
    })
    console.log(`INFO  ${JSON.stringify(resultado)}`)

    const { data: depois } = await supabase
      .from('documents')
      .select('id, type, storage_path')
      .eq('registration_id', registrationId)

    ok('NÃO duplicou o documento', (depois ?? []).length === 1, `${depois?.length} linhas`)
    ok('reclassificou o mesmo arquivo', depois?.[0]?.type === 'rg_cnh', depois?.[0]?.type ?? '')
    ok(
      'manteve o arquivo guardado',
      depois?.[0]?.storage_path === doc.storage_path
    )

    const faltam = (resultado as { faltam?: string[] }).faltam ?? []
    ok('sabe o que ainda falta', faltam.length === 2, faltam.join(', '))

    // ---- Download pelo painel exige sessão ----
    const semSessao = await fetch(`${BASE}/api/admin/documentos/${doc.id}/arquivo`)
    ok('download no painel exige autenticação', semSessao.status === 401, `status ${semSessao.status}`)
  }

  await supabase.from('deals').delete().eq('id', negocio!.id)
  await limpar()
  console.log('\nDados de teste removidos.')
}

main().catch(async (e) => {
  console.error('erro:', e.message ?? e)
  await limpar().catch(() => {})
  process.exit(1)
})

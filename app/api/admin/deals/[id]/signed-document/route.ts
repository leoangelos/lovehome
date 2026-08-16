import { NextResponse, after } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { negocioDaCarteira } from '@/lib/auth/carteira'
import { createAdminClient } from '@/lib/supabase/admin'
import { criarAssinaturaDoNegocio } from '@/lib/asaas/cobranca'

/* Recebimento do contrato assinado (PRD 15.3 e 16).
 *
 * A decisão da seção 15.3 é deliberada: sem vendor pago de assinatura. O cliente
 * assina manualmente ou pelo gov.br e devolve o PDF por WhatsApp ou e-mail; o
 * corretor sobe o arquivo aqui. Não há API de terceiro no meio.
 *
 * Ativar o contrato é passo separado do upload: subir o arquivo é registro,
 * ativar é decisão — e no caso de locação dispara a cobrança recorrente. */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_BYTES = 10 * 1024 * 1024

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('contratos', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params

  /* Recorte por carteira (§9.3): `autorizarApi` responde se o PAPEL pode;

     isto responde se ESTE corretor pode mexer NESTE item. */

  const recorte = await negocioDaCarteira(id, auth.sessao)

  if (!recorte.ok) return NextResponse.json({ erro: recorte.erro }, { status: recorte.status })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  const arquivo = form.get('arquivo')
  const metodo = form.get('signature_method')
  const canal = form.get('returned_via')

  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return NextResponse.json({ erro: 'Envie o PDF assinado.' }, { status: 400 })
  }
  if (arquivo.type !== 'application/pdf') {
    return NextResponse.json({ erro: 'O arquivo precisa ser um PDF.' }, { status: 400 })
  }
  if (arquivo.size > MAX_BYTES) {
    return NextResponse.json({ erro: 'O PDF precisa ter no máximo 10 MB.' }, { status: 400 })
  }
  if (metodo !== 'manual' && metodo !== 'govbr') {
    return NextResponse.json({ erro: 'Informe como o contrato foi assinado.' }, { status: 400 })
  }
  if (canal !== 'whatsapp' && canal !== 'email') {
    return NextResponse.json({ erro: 'Informe por onde o contrato voltou.' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: negocio } = await supabase
    .from('deals')
    .select('id, status, contract_document_url')
    .eq('id', id)
    .maybeSingle()

  if (!negocio) return NextResponse.json({ erro: 'Negócio não encontrado.' }, { status: 404 })

  /* Assinado sem contrato gerado não faz sentido: significaria que o cliente
     assinou um documento que não saiu daqui. */
  if (!negocio.contract_document_url) {
    return NextResponse.json(
      { erro: 'Gere o contrato antes de registrar a via assinada.' },
      { status: 400 }
    )
  }

  const caminho = `${id}/assinado-${Date.now()}.pdf`

  const { error: erroUpload } = await supabase.storage
    .from('contratos')
    .upload(caminho, arquivo, { contentType: 'application/pdf', upsert: false })

  if (erroUpload) {
    console.error('[signed-document] upload falhou:', erroUpload.message)
    return NextResponse.json({ erro: 'Não foi possível salvar o arquivo.' }, { status: 500 })
  }

  const { error } = await supabase
    .from('deals')
    .update({
      signed_document_url: caminho,
      signature_method: metodo,
      signed_returned_via: canal,
      contract_signed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) return NextResponse.json({ erro: 'Não foi possível registrar.' }, { status: 500 })

  console.log(`[signed-document] ${auth.sessao.email} registrou a via assinada do negócio ${id}`)
  return NextResponse.json({ ok: true })
}

/** Ativa o contrato depois da via assinada — é o que fecha o ciclo. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('contratos', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params

  /* Recorte por carteira (§9.3): `autorizarApi` responde se o PAPEL pode;

     isto responde se ESTE corretor pode mexer NESTE item. */

  const recorte = await negocioDaCarteira(id, auth.sessao)

  if (!recorte.ok) return NextResponse.json({ erro: recorte.erro }, { status: recorte.status })
  const supabase = createAdminClient()

  const { data: negocio } = await supabase
    .from('deals')
    .select('id, status, deal_type, signed_document_url, property_id, start_date')
    .eq('id', id)
    .maybeSingle()

  if (!negocio) return NextResponse.json({ erro: 'Negócio não encontrado.' }, { status: 404 })

  if (!negocio.signed_document_url) {
    return NextResponse.json(
      { erro: 'Registre a via assinada antes de ativar o contrato.' },
      { status: 400 }
    )
  }

  if (negocio.status === 'ativo' || negocio.status === 'concluido') {
    return NextResponse.json({ erro: 'Este contrato já está ativo.' }, { status: 400 })
  }

  const ativo = negocio.deal_type === 'locacao'

  const { error } = await supabase
    .from('deals')
    .update({
      // Locação vira 'ativo' (vigência corrente, cobrança mensal);
      // venda vira 'concluido' — não há mensalidade a acompanhar.
      status: ativo ? 'ativo' : 'concluido',
      start_date: negocio.start_date ?? new Date().toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) return NextResponse.json({ erro: 'Não foi possível ativar.' }, { status: 500 })

  /* O imóvel sai do mercado de vez: alugado ou vendido, conforme o negócio.
     Estava 'reservado' desde o create_deal. */
  if (negocio.property_id) {
    await supabase
      .from('properties')
      .update({
        status: negocio.deal_type === 'locacao' ? 'alugado' : 'vendido',
        updated_at: new Date().toISOString(),
      })
      .eq('id', negocio.property_id)
  }

  /* Locação ativa vira cobrança recorrente no Asaas (PRD 14.3). Vai por
     `after()`: a ativação não pode ficar esperando a API deles, e o runtime do
     Vercel continua vivo depois da resposta (fogo-e-esquece seria interrompido).

     Falhar aqui NÃO desfaz a ativação: o contrato está assinado e o imóvel já
     saiu do mercado. O que fica é um negócio ativo sem assinatura, visível na
     tela de Pagamentos — e recriável, porque `criarAssinaturaDoNegocio` é
     idempotente. Desfazer a ativação por causa de uma API fora do ar seria
     trocar um problema administrativo por um contratual. */
  if (ativo) {
    after(async () => {
      const r = await criarAssinaturaDoNegocio(id)
      if (!r.ok) {
        console.error(`[signed-document] cobrança do contrato ${id} não foi criada: ${r.erro}`)
      }
    })
  }

  console.log(`[signed-document] ${auth.sessao.email} ativou o contrato ${id}`)
  return NextResponse.json({ ok: true, status: ativo ? 'ativo' : 'concluido' })
}

import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { negocioDaCarteira } from '@/lib/auth/carteira'
import { createAdminClient } from '@/lib/supabase/admin'
import { preencherContrato } from '@/lib/leasing/contract-template'
import { gerarPdfContrato } from '@/lib/leasing/pdf'

/* Geração do contrato (PRD 15.1) e link de download.
 *
 * POST  gera o PDF a partir do template e guarda no bucket privado.
 * GET   devolve uma URL assinada de vida curta para baixar o que já existe.
 *
 * O bucket é privado porque o contrato traz CPF completo, endereço e valores.
 * Nunca devolver o caminho do storage direto: sem assinatura ele não abre, e
 * com assinatura longa vira link permanente para dado pessoal. */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Vida da URL assinada: o suficiente para baixar, não para virar link fixo. */
const VALIDADE_SEGUNDOS = 300

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('contratos', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params

  /* Recorte por carteira (§9.3): `autorizarApi` responde se o PAPEL pode;

     isto responde se ESTE corretor pode mexer NESTE item. */

  const recorte = await negocioDaCarteira(id, auth.sessao)

  if (!recorte.ok) return NextResponse.json({ erro: recorte.erro }, { status: recorte.status })

  try {
    const resultado = await preencherContrato(id)
    if (!resultado.ok) return NextResponse.json({ erro: resultado.erro }, { status: 400 })

    const { contrato } = resultado

    const pdf = await gerarPdfContrato({
      texto: contrato.texto,
      rodape: `LoveHome · ${contrato.referenciaImovel} · gerado em ${new Date().toLocaleDateString('pt-BR')}`,
    })

    const supabase = createAdminClient()
    /* Caminho por negócio, com carimbo: gerar de novo depois de corrigir um
       dado não apaga a versão anterior, que pode já ter sido enviada ao cliente. */
    const caminho = `${id}/contrato-${Date.now()}.pdf`

    const { error: erroUpload } = await supabase.storage
      .from('contratos')
      .upload(caminho, pdf, { contentType: 'application/pdf', upsert: false })

    if (erroUpload) {
      console.error('[deals/contract] upload falhou:', erroUpload.message)
      return NextResponse.json({ erro: 'Não foi possível salvar o contrato.' }, { status: 500 })
    }

    await supabase
      .from('deals')
      .update({
        contract_document_url: caminho,
        contract_template_id: contrato.templateId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    console.log(`[deals/contract] ${auth.sessao.email} gerou o contrato do negócio ${id}`)

    const { data: assinada } = await supabase.storage
      .from('contratos')
      .createSignedUrl(caminho, VALIDADE_SEGUNDOS)

    return NextResponse.json({
      ok: true,
      url: assinada?.signedUrl ?? null,
      lacunas: contrato.lacunas,
    })
  } catch (e) {
    console.error('[deals/contract] falhou:', (e as Error).message)
    return NextResponse.json({ erro: 'Erro ao gerar o contrato.' }, { status: 500 })
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('contratos')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params

  /* Recorte por carteira (§9.3): `autorizarApi` responde se o PAPEL pode;

     isto responde se ESTE corretor pode mexer NESTE item. */

  const recorte = await negocioDaCarteira(id, auth.sessao)

  if (!recorte.ok) return NextResponse.json({ erro: recorte.erro }, { status: recorte.status })
  const { searchParams } = new URL(request.url)
  const assinado = searchParams.get('assinado') === '1'

  const supabase = createAdminClient()
  const { data: negocio } = await supabase
    .from('deals')
    .select('contract_document_url, signed_document_url')
    .eq('id', id)
    .maybeSingle()

  const caminho = assinado ? negocio?.signed_document_url : negocio?.contract_document_url
  if (!caminho) {
    return NextResponse.json({ erro: 'Documento ainda não existe.' }, { status: 404 })
  }

  const { data: url } = await supabase.storage
    .from('contratos')
    .createSignedUrl(caminho, VALIDADE_SEGUNDOS)

  if (!url) return NextResponse.json({ erro: 'Não foi possível gerar o link.' }, { status: 500 })

  return NextResponse.json({ url: url.signedUrl, validade_segundos: VALIDADE_SEGUNDOS })
}

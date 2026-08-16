import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { negocioDaCarteira } from '@/lib/auth/carteira'
import { createAdminClient } from '@/lib/supabase/admin'

/* Aprovação do negócio (PRD 15.2) — o portão entre "documentos recebidos" e
   "contrato gerado". Nenhum contrato nasce sem passar por aqui; não existe
   caminho automatizado que pule este humano. */

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('contratos', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params

  /* Recorte por carteira (§9.3): `autorizarApi` responde se o PAPEL pode;

     isto responde se ESTE corretor pode mexer NESTE item. */

  const recorte = await negocioDaCarteira(id, auth.sessao)

  if (!recorte.ok) return NextResponse.json({ erro: recorte.erro }, { status: recorte.status })

  let corpo: { acao?: 'aprovar' | 'rejeitar'; motivo?: string }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  if (corpo.acao !== 'aprovar' && corpo.acao !== 'rejeitar') {
    return NextResponse.json({ erro: 'Ação inválida.' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: negocio } = await supabase
    .from('deals')
    .select('id, status, deal_type, property_id')
    .eq('id', id)
    .maybeSingle()

  if (!negocio) return NextResponse.json({ erro: 'Negócio não encontrado.' }, { status: 404 })

  if (negocio.status !== 'em_aprovacao') {
    return NextResponse.json(
      { erro: `Este negócio não está em aprovação (está "${negocio.status}").` },
      { status: 400 }
    )
  }

  if (corpo.acao === 'aprovar') {
    /* Documento ainda por conferir trava a aprovação. É a sequência explícita
       da seção 15.2: revisar os documentos (pendente_revisao → aprovado ou
       rejeitado) e SÓ ENTÃO aprovar o negócio. Aprovar antes esvaziaria a
       revisão de sentido.
       Zero documento não trava: aí é decisão de quem revisa, e a tela avisa. */
    const { count: pendentes } = await supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('deal_id', id)
      .eq('status', 'pendente_revisao')

    if ((pendentes ?? 0) > 0) {
      return NextResponse.json(
        {
          erro: `Ainda há ${pendentes} documento(s) sem conferir. Revise-os antes de aprovar o negócio.`,
        },
        { status: 400 }
      )
    }
  }

  const novoStatus = corpo.acao === 'aprovar' ? 'aprovado' : 'cancelado'

  const { error } = await supabase
    .from('deals')
    .update({ status: novoStatus, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return NextResponse.json({ erro: 'Não foi possível atualizar.' }, { status: 500 })

  /* Negócio recusado devolve o imóvel ao mercado. Sem isso ele ficaria
     'reservado' para sempre, invisível na vitrine e travado para outros. */
  if (corpo.acao === 'rejeitar' && negocio.property_id) {
    await supabase
      .from('properties')
      .update({ status: 'disponivel', updated_at: new Date().toISOString() })
      .eq('id', negocio.property_id)
      .eq('status', 'reservado')
  }

  await supabase
    .from('approval_requests')
    .update({
      status: corpo.acao === 'aprovar' ? 'aprovado' : 'rejeitado',
      reviewed_by: auth.sessao.userId,
      reviewed_at: new Date().toISOString(),
      notes: corpo.motivo ?? null,
    })
    .eq('deal_id', id)
    .eq('status', 'pendente')

  console.log(`[deals/approve] ${auth.sessao.email} ${corpo.acao}ou o negócio ${id}`)
  return NextResponse.json({ ok: true, status: novoStatus })
}

import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { documentoDaCarteira } from '@/lib/auth/carteira'
import { createAdminClient } from '@/lib/supabase/admin'

/* Revisão humana de documento (PRD 15.2). É o passo que antecede a aprovação do
   negócio: sem documento conferido, não se gera contrato. */

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('documentos', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params

  /* Recorte por carteira (§9.3): `autorizarApi` responde se o PAPEL pode;

     isto responde se ESTE corretor pode mexer NESTE item. */

  const recorte = await documentoDaCarteira(id, auth.sessao)

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

  /* Rejeitar sem motivo é inútil para quem vai pedir o documento de novo: o
     cliente precisa saber o que estava errado para mandar o certo. */
  if (corpo.acao === 'rejeitar' && !corpo.motivo?.trim()) {
    return NextResponse.json(
      { erro: 'Diga o motivo da recusa — é o que o cliente vai receber.' },
      { status: 400 }
    )
  }

  const supabase = createAdminClient()

  const { data: documento } = await supabase
    .from('documents')
    .select('id, status')
    .eq('id', id)
    .maybeSingle()

  if (!documento) return NextResponse.json({ erro: 'Documento não encontrado.' }, { status: 404 })

  const { error } = await supabase
    .from('documents')
    .update({
      status: corpo.acao === 'aprovar' ? 'aprovado' : 'rejeitado',
      rejection_reason: corpo.acao === 'rejeitar' ? corpo.motivo!.trim() : null,
      reviewed_by: auth.sessao.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) return NextResponse.json({ erro: 'Não foi possível salvar.' }, { status: 500 })

  console.log(`[documentos] ${auth.sessao.email} ${corpo.acao}ou o documento ${id}`)
  return NextResponse.json({ ok: true })
}

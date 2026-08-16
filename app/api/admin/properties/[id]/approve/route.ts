import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { imovelDaCarteira } from '@/lib/auth/carteira'
import { createAdminClient } from '@/lib/supabase/admin'

/* Aprova ou rejeita a listagem de um imóvel enviado por proprietário
   (PRD 16, 4.4 passo 6). É o portão humano entre "proprietário mandou" e
   "está na vitrine". */

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarApi('imoveis', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  const { id } = await params

  /* Recorte por carteira (§9.3): `autorizarApi` responde se o PAPEL pode;

     isto responde se ESTE corretor pode mexer NESTE item. */

  const recorte = await imovelDaCarteira(id, auth.sessao)

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

  const { data: imovel } = await supabase
    .from('properties')
    .select('id, reference_code, status, photos, owner_registration_id')
    .eq('id', id)
    .maybeSingle()

  if (!imovel) return NextResponse.json({ erro: 'Imóvel não encontrado.' }, { status: 404 })

  /* Só aprova o que está de fato esperando: sem esta checagem, um clique duplo
     ou um link antigo republicaria um imóvel já vendido ou reservado. */
  if (imovel.status !== 'em_analise') {
    return NextResponse.json(
      { erro: `Este imóvel não está em análise (está "${imovel.status}").` },
      { status: 400 }
    )
  }

  if (corpo.acao === 'aprovar') {
    /* Publicar imóvel exige identidade confirmada do proprietário (PRD 6.3).
       O formulário deixa enviar sem cadastro, mas a publicação para aqui —
       é o mesmo princípio do gate dos agentes, aplicado no lado humano. */
    if (!imovel.owner_registration_id) {
      return NextResponse.json(
        { erro: 'O proprietário ainda não tem cadastro completo. Não dá para publicar em nome dele.' },
        { status: 400 }
      )
    }

    /* Falta de foto NÃO bloqueia — a tela avisa e quem revisa decide.
       O portão existe para dar julgamento ao humano; travar aqui seria
       substituí-lo por uma regra que não conhece o caso (imóvel disputado,
       fotos chegando depois). Cadastro do proprietário é diferente: é
       requisito de identidade, não questão de bom senso. */
  }

  const novoStatus = corpo.acao === 'aprovar' ? 'disponivel' : 'inativo'

  const { error } = await supabase
    .from('properties')
    .update({ status: novoStatus, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return NextResponse.json({ erro: 'Não foi possível atualizar.' }, { status: 500 })

  await supabase
    .from('approval_requests')
    .update({
      status: corpo.acao === 'aprovar' ? 'aprovado' : 'rejeitado',
      reviewed_by: auth.sessao.userId,
      reviewed_at: new Date().toISOString(),
      notes: corpo.motivo ?? null,
    })
    .eq('property_id', id)
    .eq('status', 'pendente')

  console.log(
    `[properties/approve] ${auth.sessao.email} ${corpo.acao}ou ${imovel.reference_code}`
  )

  return NextResponse.json({ ok: true, status: novoStatus })
}

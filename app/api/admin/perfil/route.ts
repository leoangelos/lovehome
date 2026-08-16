import { NextResponse } from 'next/server'
import { getSessao } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'

/* Perfil próprio. Qualquer papel pode editar o SEU — não passa por
   autorizarApi('usuarios') de propósito: um corretor precisa poder corrigir o
   próprio nome sem ter acesso à gestão de equipe.
   O que não dá para mudar aqui é papel e situação: isso é decisão de admin e
   vive em /api/admin/usuarios. */

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request) {
  const sessao = await getSessao()
  if (!sessao) return NextResponse.json({ erro: 'Não autenticado.' }, { status: 401 })

  let corpo: { full_name?: string; phone?: string }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (corpo.full_name !== undefined) {
    const nome = corpo.full_name.trim()
    if (nome.length < 3) return NextResponse.json({ erro: 'Nome muito curto.' }, { status: 400 })
    patch.full_name = nome
  }

  if (corpo.phone !== undefined) {
    patch.phone = corpo.phone.replace(/\D/g, '') || null
  }

  const admin = createAdminClient()
  const { error } = await admin.from('profiles').update(patch).eq('id', sessao.userId)
  if (error) return NextResponse.json({ erro: 'Erro ao salvar.' }, { status: 500 })

  // Corretor: o nome aparece para o cliente na conversa e nas telas de agenda,
  // então precisa acompanhar o do perfil.
  if (sessao.role === 'corretor' && patch.full_name) {
    await admin
      .from('brokers')
      .update({ name: patch.full_name })
      .eq('profile_id', sessao.userId)
  }

  return NextResponse.json({ ok: true })
}

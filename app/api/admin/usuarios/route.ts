import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { atualizarUsuario, convidarUsuario } from '@/lib/auth/convites'
import type { Role } from '@/lib/auth/permissions'

/* Convite e gestão de acesso — só admin (PRD 9.2).
   A checagem é feita aqui e não apenas na tela: rota de API é chamável direto,
   e esconder o botão não impede ninguém de mandar o POST. */

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await autorizarApi('usuarios', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  let corpo: { email?: string; full_name?: string; role?: Role }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  if (!corpo.email || !corpo.full_name || !corpo.role) {
    return NextResponse.json({ erro: 'Informe nome, e-mail e papel.' }, { status: 400 })
  }

  try {
    const resultado = await convidarUsuario({
      email: corpo.email,
      full_name: corpo.full_name,
      role: corpo.role,
      convidadoPor: auth.sessao.userId,
    })

    if (!resultado.ok) return NextResponse.json({ erro: resultado.erro }, { status: 400 })

    console.log(`[usuarios] ${auth.sessao.email} convidou ${corpo.email} como ${corpo.role}`)
    return NextResponse.json({ ok: true, link: resultado.link, jaExistia: resultado.jaExistia })
  } catch (e) {
    console.error('[api/admin/usuarios] convite falhou:', (e as Error).message)
    return NextResponse.json({ erro: 'Erro ao gerar o convite.' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const auth = await autorizarApi('usuarios', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  let corpo: { id?: string; role?: Role; is_active?: boolean }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  if (!corpo.id) return NextResponse.json({ erro: 'Informe o usuário.' }, { status: 400 })

  try {
    const resultado = await atualizarUsuario({
      alvoId: corpo.id,
      quemFezId: auth.sessao.userId,
      role: corpo.role,
      is_active: corpo.is_active,
    })

    if (!resultado.ok) return NextResponse.json({ erro: resultado.erro }, { status: 400 })

    console.log(
      `[usuarios] ${auth.sessao.email} alterou ${corpo.id}: ${JSON.stringify({
        role: corpo.role,
        is_active: corpo.is_active,
      })}`
    )
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[api/admin/usuarios] atualização falhou:', (e as Error).message)
    return NextResponse.json({ erro: 'Erro ao atualizar o usuário.' }, { status: 500 })
  }
}

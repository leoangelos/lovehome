import { NextResponse } from 'next/server'
import { autorizarApi } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { cpfValido, hashCpf, prepararCpf } from '@/lib/registrations/cpf'

/* Cadastro de proprietário pelo painel.
 *
 * Existe porque o cadastro por WhatsApp cobre quem chega pelo bot, mas a
 * imobiliária já tem proprietários de antes — e sem eles o contrato de locação
 * sai com o LOCADOR em branco.
 *
 * Diferente do formulário público, aqui CPF já existente PODE ser reutilizado:
 * quem opera o painel é a equipe interna, autenticada e auditável, não um
 * desconhecido com um token de link. A trava da §6.3 protege contra estranho,
 * não contra o próprio corretor fazendo o trabalho dele. */

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await autorizarApi('proprietarios', 'editar')
  if ('erro' in auth) return NextResponse.json({ erro: auth.erro }, { status: auth.status })

  let corpo: {
    cpf?: string
    full_name?: string
    email?: string
    phone?: string
    address?: Record<string, string>
  }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ erro: 'Requisição inválida.' }, { status: 400 })
  }

  if (!corpo.cpf || !cpfValido(corpo.cpf)) {
    return NextResponse.json({ erro: 'CPF inválido.' }, { status: 400 })
  }
  if (!corpo.full_name?.trim().includes(' ')) {
    return NextResponse.json({ erro: 'Informe o nome completo.' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const hash = hashCpf(corpo.cpf)

  const { data: existente } = await supabase
    .from('registrations')
    .select('id, full_name')
    .eq('cpf_hash', hash)
    .maybeSingle()

  let registrationId: string

  if (existente) {
    registrationId = existente.id
    // Cadastro já existia (pode ser um interessado que também é proprietário).
    // Não sobrescreve os dados dele — só garante o papel abaixo.
  } else {
    const { data: novo, error } = await supabase
      .from('registrations')
      .insert({
        ...prepararCpf(corpo.cpf),
        full_name: corpo.full_name.trim(),
        email: corpo.email?.trim().toLowerCase() || null,
        address: corpo.address ?? null,
      })
      .select('id')
      .single()

    if (error || !novo) {
      return NextResponse.json({ erro: 'Não foi possível salvar o cadastro.' }, { status: 500 })
    }
    registrationId = novo.id
  }

  // Papéis são múltiplos (§6.4): acrescenta 'proprietario' sem tirar os outros.
  await supabase
    .from('contact_roles')
    .upsert(
      { registration_id: registrationId, role: 'proprietario' },
      { onConflict: 'registration_id,role' }
    )

  console.log(
    `[proprietarios] ${auth.sessao.email} ${existente ? 'promoveu a proprietário' : 'cadastrou'} ${registrationId}`
  )

  return NextResponse.json({
    ok: true,
    id: registrationId,
    ja_existia: Boolean(existente),
    nome: existente?.full_name ?? corpo.full_name.trim(),
  })
}

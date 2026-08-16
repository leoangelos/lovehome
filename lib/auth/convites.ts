import { createAdminClient } from '@/lib/supabase/admin'
import { PAPEIS, type Role } from './permissions'
import { urlPublica } from '@/lib/utils/url-publica'

// ==========================================
// Convite e gestão de acesso da equipe interna (PRD 9.1).
//
// Não existe cadastro aberto: quem entra no painel enxerga dado de lead,
// contrato e cobrança. Todo acesso nasce de um convite feito por um admin.
// ==========================================

export interface UsuarioLinha {
  id: string
  email: string
  full_name: string | null
  role: Role
  is_active: boolean
  phone: string | null
  invited_at: string | null
  last_sign_in_at: string | null
  criado_em: string
  /** Nunca entrou: convite pendente. */
  pendente: boolean
  broker_id: string | null
}

export async function listarUsuarios(): Promise<UsuarioLinha[]> {
  const admin = createAdminClient()

  const [{ data: perfis, error }, { data: corretores }] = await Promise.all([
    admin
      .from('profiles')
      .select('id, email, full_name, role, is_active, phone, invited_at, last_sign_in_at, created_at')
      .order('created_at', { ascending: true }),
    admin.from('brokers').select('id, profile_id').not('profile_id', 'is', null),
  ])

  if (error) throw new Error(`Falha ao listar usuários: ${error.message}`)

  /* last_sign_in_at real vive em auth.users, não em profiles — a coluna em
     profiles é um espelho que só é preenchido se alguém escrever nela. Ler da
     fonte evita mostrar "nunca acessou" para quem entra todo dia. */
  const { data: authUsers } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const ultimoAcesso = new Map(
    (authUsers?.users ?? []).map((u) => [u.id, u.last_sign_in_at ?? null])
  )

  return (perfis ?? []).map((p) => {
    const acesso = ultimoAcesso.get(p.id) ?? p.last_sign_in_at
    return {
      id: p.id,
      email: p.email,
      full_name: p.full_name,
      role: p.role as Role,
      is_active: p.is_active,
      phone: p.phone,
      invited_at: p.invited_at,
      last_sign_in_at: acesso,
      criado_em: p.created_at,
      pendente: !acesso,
      broker_id: (corretores ?? []).find((c) => c.profile_id === p.id)?.id ?? null,
    }
  })
}

export type ResultadoConvite =
  | { ok: true; link: string; jaExistia: boolean }
  | { ok: false; erro: string }

/**
 * Convida alguém para o painel.
 *
 * Devolve o link de ativação além de disparar o e-mail. Isso é proposital: sem
 * SMTP configurado no projeto Supabase o e-mail não sai, e sem o link na tela o
 * convite viraria um beco sem saída silencioso. Com SMTP configurado, os dois
 * caminhos levam ao mesmo lugar.
 */
export async function convidarUsuario(params: {
  email: string
  full_name: string
  role: Role
  convidadoPor: string
}): Promise<ResultadoConvite> {
  const admin = createAdminClient()
  const email = params.email.trim().toLowerCase()

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, erro: 'E-mail inválido.' }
  if (!PAPEIS.includes(params.role)) return { ok: false, erro: 'Papel inválido.' }
  if (!params.full_name.trim()) return { ok: false, erro: 'Informe o nome.' }

  const { data: existente } = await admin
    .from('profiles')
    .select('id, is_active')
    .eq('email', email)
    .maybeSingle()

  if (existente?.is_active) {
    return { ok: false, erro: 'Já existe um usuário ativo com esse e-mail.' }
  }


  const { data, error } = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: {
      // O papel viaja no metadata e é lido pelo trigger handle_new_user, para o
      // convidado já nascer com o papel certo (ver migration 016).
      data: { full_name: params.full_name.trim(), role: params.role },
      redirectTo: urlPublica('/auth/confirm?next=/definir-senha'),
    },
  })

  if (error || !data) {
    return { ok: false, erro: error?.message ?? 'Não foi possível gerar o convite.' }
  }

  // Reativa e corrige o perfil de quem já existia (usuário desligado que volta).
  await admin
    .from('profiles')
    .update({
      role: params.role,
      full_name: params.full_name.trim(),
      is_active: true,
      invited_by: params.convidadoPor,
      invited_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', data.user.id)

  /* Link montado aqui em vez de usar `action_link`: o action_link aponta para o
     domínio do Supabase, que redireciona de volta. Apontar direto para a nossa
     rota de confirmação tira um salto e mantém a pessoa no domínio da LoveHome. */
  const link = urlPublica(`/auth/confirm?token_hash=${data.properties.hashed_token}&type=invite&next=/definir-senha`)

  return { ok: true, link, jaExistia: Boolean(existente) }
}

export type ResultadoAtualizacao = { ok: true } | { ok: false; erro: string }

export async function atualizarUsuario(params: {
  alvoId: string
  quemFezId: string
  role?: Role
  is_active?: boolean
}): Promise<ResultadoAtualizacao> {
  const admin = createAdminClient()

  if (params.role && !PAPEIS.includes(params.role)) {
    return { ok: false, erro: 'Papel inválido.' }
  }

  /* Ninguém tira o próprio acesso. Sem esta trava, um admin distraído se
     rebaixa para 'viewer' e perde a tela de usuários — e o conserto passa a
     exigir ir ao banco. */
  if (params.alvoId === params.quemFezId) {
    if (params.role) return { ok: false, erro: 'Você não pode alterar o seu próprio papel.' }
    if (params.is_active === false) {
      return { ok: false, erro: 'Você não pode desativar a sua própria conta.' }
    }
  }

  const { data: alvo } = await admin
    .from('profiles')
    .select('role, is_active')
    .eq('id', params.alvoId)
    .maybeSingle()

  if (!alvo) return { ok: false, erro: 'Usuário não encontrado.' }

  // A imobiliária não pode ficar sem nenhum admin ativo: sem isso não há quem
  // convide, troque papel ou mexa em canais.
  const perdendoAdmin =
    alvo.role === 'admin' &&
    alvo.is_active &&
    ((params.role && params.role !== 'admin') || params.is_active === false)

  if (perdendoAdmin) {
    const { count } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .eq('is_active', true)

    if ((count ?? 0) <= 1) {
      return { ok: false, erro: 'Este é o único administrador ativo. Promova outro antes.' }
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (params.role) patch.role = params.role
  if (params.is_active !== undefined) patch.is_active = params.is_active

  const { error } = await admin.from('profiles').update(patch).eq('id', params.alvoId)
  if (error) return { ok: false, erro: error.message }

  // Corretor desativado sai da fila de atendimento: o agente de agendamento
  // consulta brokers.is_active e não deve oferecer a agenda de quem saiu.
  if (params.is_active !== undefined) {
    await admin
      .from('brokers')
      .update({ is_active: params.is_active })
      .eq('profile_id', params.alvoId)
  }

  return { ok: true }
}

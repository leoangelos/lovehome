import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { pode, rotaInicial } from './permissions'
import type { Acao, Recurso, Role } from './permissions'

// ==========================================
// Sessão e autorização do painel.
//
// A identidade vem do cliente SSR (cookie + chave anon), que é o único capaz de
// validar o JWT. O perfil vem do admin client porque `profiles` tem RLS e a
// policy de leitura depende de auth.uid() — funcionaria, mas o admin client
// evita depender da policy para a checagem que decide todo o resto.
// ==========================================

export interface SessaoPainel {
  userId: string
  email: string
  nome: string | null
  role: Role
  /** Preenchido quando o perfil é de corretor — é a chave do escopo por carteira. */
  brokerId: string | null
}

/** Sessão atual, ou null se não houver login válido. */
export async function getSessao(): Promise<SessaoPainel | null> {
  const supabase = await createClient()

  /* getUser() e não getSession(): getSession lê o cookie sem validar a
     assinatura, então um cookie forjado passaria. getUser bate no servidor
     de auth. */
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const admin = createAdminClient()
  const { data: perfil } = await admin
    .from('profiles')
    .select('id, email, full_name, role, is_active')
    .eq('id', user.id)
    .maybeSingle()

  // Sem perfil, ou perfil desativado: a conta existe no auth mas não tem acesso.
  // Acontece com quem foi desligado — o login até funciona, o painel não abre.
  if (!perfil || !perfil.is_active) return null

  let brokerId: string | null = null
  if (perfil.role === 'corretor') {
    const { data: corretor } = await admin
      .from('brokers')
      .select('id')
      .eq('profile_id', user.id)
      .maybeSingle()
    brokerId = corretor?.id ?? null
  }

  return {
    userId: perfil.id,
    email: perfil.email,
    nome: perfil.full_name,
    role: perfil.role as Role,
    brokerId,
  }
}

/** Exige login. Redireciona para o login preservando o destino. */
export async function exigirSessao(destino?: string): Promise<SessaoPainel> {
  const sessao = await getSessao()
  if (!sessao) {
    redirect(destino ? `/login?proximo=${encodeURIComponent(destino)}` : '/login')
  }
  return sessao
}

/**
 * Exige login E permissão sobre o recurso. É a chamada que toda página do painel
 * faz na primeira linha — a autorização de verdade acontece aqui, no servidor,
 * não na sidebar.
 *
 * Sem permissão, manda para a rota inicial do papel em vez de mostrar um 403:
 * o usuário chegou onde não devia por um link antigo ou uma URL digitada, e
 * levá-lo a uma tela útil é melhor do que a um beco.
 */
export async function exigirAcesso(recurso: Recurso, acao: Acao = 'ver'): Promise<SessaoPainel> {
  const sessao = await exigirSessao(`/admin/${recurso}`)

  if (!pode(sessao.role, recurso, acao)) {
    console.log(
      `[auth] ${sessao.email} (${sessao.role}) barrado em ${recurso}:${acao}`
    )
    redirect(rotaInicial(sessao.role))
  }

  return sessao
}

/**
 * Versão para rota de API: devolve a sessão ou null, sem redirecionar.
 * Rota de API precisa responder 401/403, não HTML de redirecionamento.
 */
export async function autorizarApi(
  recurso: Recurso,
  acao: Acao = 'ver'
): Promise<{ sessao: SessaoPainel } | { erro: string; status: 401 | 403 }> {
  const sessao = await getSessao()
  if (!sessao) return { erro: 'Não autenticado.', status: 401 }
  if (!pode(sessao.role, recurso, acao)) return { erro: 'Sem permissão.', status: 403 }
  return { sessao }
}

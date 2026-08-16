import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LoginForm } from '@/components/auth/LoginForm'
import { getSessao } from '@/lib/auth/session'
import { rotaInicial } from '@/lib/auth/permissions'

export const metadata: Metadata = {
  title: 'Entrar — LoveHome',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

/** Caminho interno absoluto (`/admin/...`), ou null. Recusa `//host`, `/\host` e esquema. */
function destinoInterno(valor: string | undefined | null): string | null {
  if (!valor) return null
  if (!valor.startsWith('/') || valor.startsWith('//') || valor.startsWith('/\\')) return null
  return valor
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ proximo?: string; erro?: string }>
}) {
  const { proximo, erro } = await searchParams
  const sessao = await getSessao()

  /* Só aceita destino interno, e a sanitização vem ANTES dos dois usos. Uma
     versão anterior sanitizava só o caminho do formulário e mandava quem já
     estava logado para `proximo` cru — `/login?proximo=https://outro.site`
     era um redirecionador aberto com o domínio legítimo na frente, exatamente
     o link que um phishing precisa. */
  const interno = destinoInterno(proximo)

  // Já logado não precisa ver o formulário.
  if (sessao) redirect(interno ?? rotaInicial(sessao.role))

  return <LoginForm proximo={interno ?? '/admin/dashboard'} erro={erro} />
}

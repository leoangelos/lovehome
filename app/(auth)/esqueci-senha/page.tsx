import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { EsqueciSenhaForm } from '@/components/auth/EsqueciSenhaForm'
import { getSessao } from '@/lib/auth/session'

export const metadata: Metadata = {
  title: 'Esqueci minha senha — LoveHome',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function EsqueciSenhaPage() {
  // Quem já está logado troca a senha em /definir-senha, sem passar por e-mail.
  const sessao = await getSessao()
  if (sessao) redirect('/definir-senha')

  return <EsqueciSenhaForm />
}

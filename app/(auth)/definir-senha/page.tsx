import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { SenhaForm } from '@/components/auth/SenhaForm'
import { getSessao } from '@/lib/auth/session'
import { rotaInicial } from '@/lib/auth/permissions'

export const metadata: Metadata = {
  title: 'Definir senha — LoveHome',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function DefinirSenhaPage() {
  /* Só chega aqui quem já tem sessão: ou veio do link de convite (que virou
     sessão em /auth/confirm) ou está logado trocando a própria senha. Sem
     sessão, o link expirou ou foi reutilizado. */
  const sessao = await getSessao()
  if (!sessao) redirect('/login?erro=link_expirado')

  return (
    <SenhaForm
      destino={rotaInicial(sessao.role)}
      nomeAtual={sessao.nome}
      pedirNome={!sessao.nome}
    />
  )
}

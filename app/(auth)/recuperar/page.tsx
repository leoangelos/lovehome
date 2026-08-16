import type { Metadata } from 'next'
import { RecuperarSessao } from '@/components/auth/RecuperarSessao'

export const metadata: Metadata = {
  title: 'Recuperar acesso — LoveHome',
  robots: { index: false, follow: false },
}

/* Destino do link de recuperação de senha.
   A página em si não faz nada no servidor: o token vem no fragmento da URL, que
   só existe no navegador. Quem consome é o componente cliente. */
export default function RecuperarPage() {
  return <RecuperarSessao destino="/definir-senha" />
}

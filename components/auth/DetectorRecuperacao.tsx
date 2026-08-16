'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

/* Rede de segurança para link de recuperação que cai na página errada.
 *
 * O Supabase manda o token no fragmento da URL e usa a Site URL do projeto
 * quando o link é disparado sem `redirectTo` — por exemplo, pelo painel do
 * próprio Supabase. Nesse caso a pessoa aterrissa na raiz (que aqui redireciona
 * para a vitrine) com um token válido pendurado no `#`, e nada acontece.
 *
 * Este detector roda em qualquer página, reconhece o fragmento e leva a pessoa
 * para /recuperar com ele intacto. Custa uma leitura de string por navegação.
 */

const TIPOS_RECUPERACAO = ['recovery', 'invite', 'magiclink', 'signup', 'email_change']

export function DetectorRecuperacao() {
  const pathname = usePathname()

  useEffect(() => {
    if (pathname === '/recuperar') return

    const hash = window.location.hash
    if (!hash || hash.length < 2) return

    const params = new URLSearchParams(hash.replace(/^#/, ''))
    const tipo = params.get('type')
    const temToken = params.has('access_token') || params.has('error_description')

    if (!temToken || !tipo || !TIPOS_RECUPERACAO.includes(tipo)) return

    // Leva o fragmento junto — é ele que carrega o token.
    window.location.replace(`/recuperar${hash}`)
  }, [pathname])

  return null
}

import { type EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/* Destino do link de convite e de recuperação de senha.
 *
 * Troca o token_hash por uma sessão de verdade (cookie assinado) e manda a
 * pessoa para definir a senha. O token é de uso único e expira — se já tiver
 * sido usado, cai no login com aviso em vez de erro cru.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  /* Só caminho interno: `new URL('https://outro.site', base)` ignora a base e
     redireciona para fora — com uma sessão recém-criada no cookie. */
  const pedido = searchParams.get('next')
  const proximo =
    pedido && pedido.startsWith('/') && !pedido.startsWith('//') && !pedido.startsWith('/\\')
      ? pedido
      : '/definir-senha'

  if (!token_hash || !type) {
    return NextResponse.redirect(new URL('/login?erro=link_invalido', request.url))
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ type, token_hash })

  if (error) {
    console.log('[auth/confirm] token recusado:', error.message)
    return NextResponse.redirect(new URL('/login?erro=link_expirado', request.url))
  }

  return NextResponse.redirect(new URL(proximo, request.url))
}

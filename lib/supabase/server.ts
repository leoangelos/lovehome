import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/* Cliente com a sessao do usuario (chave anon + cookies) — sujeito ao RLS.
   E o cliente das telas autenticadas quando o login da secao 9 do PRD entrar;
   ate la o painel le pelo admin client. */

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component nao pode escrever cookie — o middleware renova a sessao
          }
        },
      },
    }
  )
}

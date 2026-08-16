import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/* Proxy (era `middleware` até o Next 15 — renomeado no 16).
 *
 * Faz duas coisas:
 *   1. Renova o cookie de sessão do Supabase. Server Component não consegue
 *      escrever cookie, então sem este passo a sessão expira e o usuário é
 *      deslogado no meio do uso.
 *   2. Barra anônimo em /admin antes de renderizar.
 *
 * O passo 2 é conveniência e defesa em profundidade, NÃO a autorização. Quem
 * decide o que cada papel acessa é exigirAcesso() em cada página — o proxy não
 * consulta papel de propósito: ele roda em edge, e uma consulta ao banco a cada
 * request encareceria toda navegação para repetir o que a página já faz.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser valida a assinatura no servidor de auth; getSession só leria o
  // cookie, e cookie forjado passaria.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && request.nextUrl.pathname.startsWith('/admin')) {
    const login = request.nextUrl.clone()
    login.pathname = '/login'
    // Guarda o destino para devolver a pessoa onde ela queria chegar.
    login.searchParams.set('proximo', request.nextUrl.pathname)
    return NextResponse.redirect(login)
  }

  return response
}

export const config = {
  /* Fora do matcher: vitrine, formulário público tokenizado, webhooks e cron.
     Webhook e cron têm autenticação própria (assinatura e Bearer) e não podem
     depender de cookie de navegador. */
  matcher: ['/admin/:path*', '/login', '/definir-senha', '/esqueci-senha', '/recuperar'],
}

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/* POST e não GET de propósito: com GET, qualquer <img src="/auth/sair"> numa
   página de terceiro deslogaria a pessoa. */
export async function POST(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 })
}

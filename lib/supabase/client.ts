import { createBrowserClient } from '@supabase/ssr'

/* Cliente de browser — chave anon, sujeito ao RLS. */

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

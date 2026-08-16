import { createClient } from '@supabase/supabase-js'

/* Cliente service_role — ignora RLS. NUNCA importar em componente de cliente:
   o segredo vazaria no bundle. E o caminho normal de leitura do servidor, do
   o RLS existe como defesa em profundidade
   para o caso de a chave anon vazar, nao como o mecanismo de acesso do app.

   Falha alto e cedo em vez de cair para uma chave dummy: um cliente quebrado em
   silencio vira "0 imoveis encontrados" na tela, que e um sintoma muito pior de
   diagnosticar do que um erro de configuracao explicito. */

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error(
      'Supabase nao configurado: faltam NEXT_PUBLIC_SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no ambiente.'
    )
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

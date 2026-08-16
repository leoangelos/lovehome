import 'dotenv/config'
import { createAdminClient } from '../lib/supabase/admin'

/* Cria o PRIMEIRO administrador. Rodar com:
     npm run criar-admin -- email@dominio.com "Nome Completo"

   Existe porque o painel é fechado por convite e convite só é feito por um
   admin — sem este bootstrap não haveria o primeiro. Depois dele, todo acesso
   novo nasce em /admin/usuarios.

   Recusa rodar se já houver admin ativo: este script fala direto com a API de
   admin do Supabase e não passa por nenhuma autorização, então não pode virar
   um caminho paralelo para criar acesso com o projeto já em operação. */

const supabase = createAdminClient()

async function main() {
  const [email, nome] = process.argv.slice(2)

  if (!email || !nome) {
    console.error('Uso: npm run criar-admin -- email@dominio.com "Nome Completo"')
    process.exit(1)
  }

  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin')
    .eq('is_active', true)

  if ((count ?? 0) > 0) {
    console.error(
      `Já existe ${count} administrador(es) ativo(s). Convide novas pessoas pelo painel, em /admin/usuarios.`
    )
    process.exit(1)
  }

  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'invite',
    email: email.trim().toLowerCase(),
    options: {
      data: { full_name: nome, role: 'admin' },
      redirectTo: `${base}/auth/confirm?next=/definir-senha`,
    },
  })

  if (error || !data) {
    console.error('Falha ao criar o convite:', error?.message)
    process.exit(1)
  }

  // O trigger handle_new_user já cria o profile com role='admin' vindo do
  // metadata; este update cobre o caso de o perfil existir de antes.
  await supabase
    .from('profiles')
    .update({ role: 'admin', full_name: nome, is_active: true, invited_at: new Date().toISOString() })
    .eq('id', data.user.id)

  const link = `${base}/auth/confirm?token_hash=${data.properties.hashed_token}&type=invite&next=/definir-senha`

  console.log(`\nAdministrador criado: ${nome} <${email}>`)
  console.log('\nAbra este link para definir a senha:\n')
  console.log(link)
  console.log('\nO link é de uso único e expira. Se perder, apague o usuário no painel do')
  console.log('Supabase (Authentication > Users) e rode este script de novo.\n')
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})

import type { Metadata } from 'next'
import { UsuariosPainel } from '@/components/usuarios/UsuariosPainel'
import { exigirAcesso } from '@/lib/auth/session'
import { listarUsuarios } from '@/lib/auth/convites'

export const metadata: Metadata = { title: 'Usuários — LoveHome' }
export const dynamic = 'force-dynamic'

export default async function UsuariosPage() {
  // Primeira linha da página, sempre: é aqui que a autorização acontece.
  const sessao = await exigirAcesso('usuarios', 'editar')
  const usuarios = await listarUsuarios()

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Usuários</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Quem tem acesso ao painel e com qual papel
        </p>
      </div>

      <UsuariosPainel usuarios={usuarios} meuId={sessao.userId} />
    </div>
  )
}

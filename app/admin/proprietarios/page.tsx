import type { Metadata } from 'next'
import { ProprietariosPainel } from '@/components/proprietarios/ProprietariosPainel'
import { listarProprietarios } from '@/lib/queries/proprietarios'
import { exigirAcesso } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissions'

export const metadata: Metadata = { title: 'Proprietários — LoveHome' }
export const dynamic = 'force-dynamic'

export default async function ProprietariosPage() {
  const sessao = await exigirAcesso('proprietarios')
  const proprietarios = await listarProprietarios()

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Proprietários</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Quem tem imóvel na carteira — e o que está vinculado a cada um
        </p>
      </div>

      <ProprietariosPainel
        proprietarios={proprietarios}
        podeCadastrar={pode(sessao.role, 'proprietarios', 'editar')}
      />
    </div>
  )
}

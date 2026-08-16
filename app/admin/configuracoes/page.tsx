import type { Metadata } from 'next'
import { ConfiguracoesPainel } from '@/components/configuracoes/ConfiguracoesPainel'
import { getConfiguracoes } from '@/lib/config/app'
import { listarBloqueados } from '@/lib/channels/blocklist'
import { exigirAcesso } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissions'

export const metadata: Metadata = { title: 'Configurações — LoveHome' }
export const dynamic = 'force-dynamic'

export default async function ConfiguracoesPage() {
  const sessao = await exigirAcesso('configuracoes')
  const [config, bloqueados] = await Promise.all([getConfiguracoes(), listarBloqueados()])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Configurações</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Dados da imobiliária e os parâmetros que mudam o comportamento do atendimento
        </p>
      </div>

      <ConfiguracoesPainel
        config={config}
        bloqueados={bloqueados}
        podeEditar={pode(sessao.role, 'configuracoes', 'editar')}
      />
    </div>
  )
}

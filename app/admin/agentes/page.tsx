import type { Metadata } from 'next'
import { AgentesEditor } from '@/components/agentes/AgentesEditor'
import { listarAgentes } from '@/lib/agents/salvar-config'
import { exigirAcesso } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissions'
import { FluxoAgentes } from '@/components/agentes/FluxoAgentes'

export const metadata: Metadata = { title: 'Agentes — LoveHome' }
export const dynamic = 'force-dynamic'

export default async function AgentesPage() {
  const sessao = await exigirAcesso('agentes')
  const agentes = await listarAgentes()
  const personalizados = agentes.filter((a) => a.personalizado).length

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Agentes</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {personalizados > 0
            ? `${personalizados} de ${agentes.length} com prompt personalizado — os demais usam o padrão do código`
            : 'Todos usando o prompt padrão do código. Editar aqui cria uma sobrescrita no banco.'}
        </p>
      </div>

      <FluxoAgentes />

      <AgentesEditor agentes={agentes} podeEditar={pode(sessao.role, 'agentes', 'editar')} />
    </div>
  )
}

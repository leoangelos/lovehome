import type { Metadata } from 'next'
import { MateriaisPainel } from '@/components/materiais/MateriaisPainel'
import { listarMateriais } from '@/lib/rag/indexar'
import { exigirAcesso } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissions'

export const metadata: Metadata = { title: 'Materiais — LoveHome' }
export const dynamic = 'force-dynamic'

export default async function MateriaisPage() {
  const sessao = await exigirAcesso('materiais')
  const materiais = await listarMateriais()

  const indexados = materiais.filter((m) => m.status === 'indexado')
  const trechos = indexados.reduce((s, m) => s + (m.chunk_count ?? 0), 0)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Materiais</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {indexados.length > 0
            ? `${indexados.length} material(is) indexado(s) em ${trechos} trecho(s) — é daqui que o agente responde dúvida de processo`
            : 'Financiamento, documentação, glossário e políticas que o agente consulta na conversa'}
        </p>
      </div>

      <MateriaisPainel
        materiais={materiais}
        podeEditar={pode(sessao.role, 'materiais', 'editar')}
      />
    </div>
  )
}

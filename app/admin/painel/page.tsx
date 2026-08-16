import type { Metadata } from 'next'
import { KanbanFunil } from '@/components/painel/KanbanFunil'
import { montarFunil } from '@/lib/queries/painel'
import { exigirAcesso } from '@/lib/auth/session'
import { escopoProprio, pode } from '@/lib/auth/permissions'

export const metadata: Metadata = { title: 'Painel — LoveHome' }
export const dynamic = 'force-dynamic'

export default async function PainelPage() {
  const sessao = await exigirAcesso('painel')
  const colunas = await montarFunil(escopoProprio(sessao.role) ? sessao.brokerId : null)

  const total = colunas.reduce((s, c) => s + c.cartoes.length, 0)
  const esperando = colunas.reduce(
    (s, c) => s + c.cartoes.filter((x) => x.esperando_resposta).length,
    0
  )

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Painel</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {total === 0
            ? 'Funil de leads — arraste o cartão para mudar o estágio'
            : `${total} lead(s) no funil${esperando ? ` · ${esperando} esperando resposta` : ''}`}
        </p>
      </div>

      <KanbanFunil colunas={colunas} podeMover={pode(sessao.role, 'painel', 'editar')} />
    </div>
  )
}

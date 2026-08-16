import type { Metadata } from 'next'
import { ConversasLista } from '@/components/conversas/ConversasLista'
import { listarConversas } from '@/lib/queries/conversas'
import { exigirAcesso } from '@/lib/auth/session'
import { escopoProprio } from '@/lib/auth/permissions'

export const metadata: Metadata = { title: 'Conversas — LoveHome' }
export const dynamic = 'force-dynamic'

export default async function ConversasPage() {
  const sessao = await exigirAcesso('conversas')
  const conversas = await listarConversas(escopoProprio(sessao.role) ? sessao.brokerId : null)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Conversas</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {escopoProprio(sessao.role)
            ? 'Atendimentos da sua carteira — assuma quando precisar responder você mesmo'
            : 'Todos os atendimentos — assuma quando precisar responder você mesmo'}
        </p>
      </div>

      <ConversasLista conversas={conversas} />
    </div>
  )
}

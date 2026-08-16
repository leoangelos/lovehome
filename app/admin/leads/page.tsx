import type { Metadata } from 'next'
import { LeadsTable } from '@/components/leads/LeadsTable'
import { listarLeads } from '@/lib/queries/admin'
import { exigirAcesso } from '@/lib/auth/session'
import { escopoProprio } from '@/lib/auth/permissions'

export const metadata: Metadata = { title: 'Leads — LoveHome' }
export const dynamic = 'force-dynamic'

export default async function LeadsPage() {
  const sessao = await exigirAcesso('leads')
  // Corretor vê só a própria carteira (PRD 9.3)
  const leads = await listarLeads(escopoProprio(sessao.role) ? sessao.brokerId : null)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Leads</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Contatos, estágio no funil e situação do cadastro
        </p>
      </div>

      <LeadsTable leads={leads} />
    </div>
  )
}

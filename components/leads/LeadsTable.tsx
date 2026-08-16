'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { ROTULOS_STATUS, StatusBadge } from '@/components/ui/StatusBadge'
import { brl, cpfMascarado, dataHora, telefone } from '@/lib/utils/format'
import type { LeadLinha } from '@/lib/queries/admin'
import type { FunnelStage } from '@/lib/types/domain'

const ORDEM_FUNIL: FunnelStage[] = [
  'novo',
  'qualificando',
  'qualificado',
  'visita_agendada',
  'em_negociacao',
  'convertido',
  'perdido',
]

const ROTULO_CADASTRO: Record<string, string> = {
  none: 'sem cadastro',
  pending: 'iniciado',
  completo: 'completo',
}

export function LeadsTable({ leads }: { leads: LeadLinha[] }) {
  const [busca, setBusca] = useState('')
  const [estagio, setEstagio] = useState<'todos' | FunnelStage>('todos')

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return leads
      .filter((l) => estagio === 'todos' || l.funnel_stage === estagio)
      .filter(
        (l) =>
          !termo ||
          (l.name ?? '').toLowerCase().includes(termo) ||
          (l.nome_cadastro ?? '').toLowerCase().includes(termo) ||
          (l.phone ?? '').includes(termo) ||
          (l.regiao ?? '').toLowerCase().includes(termo)
      )
  }, [leads, busca, estagio])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, telefone ou região"
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30"
          />
        </div>

        <select
          value={estagio}
          onChange={(e) => setEstagio(e.target.value as 'todos' | FunnelStage)}
          className="px-3 py-2 text-xs rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none"
        >
          <option value="todos">Todos os estágios</option>
          {ORDEM_FUNIL.map((s) => (
            <option key={s} value={s}>
              {ROTULOS_STATUS[s] ?? s}
            </option>
          ))}
        </select>

        <span className="text-xs text-gray-400 dark:text-gray-500 tnum ml-auto">
          {filtrados.length} de {leads.length}
        </span>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 text-left">
                <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Lead</th>
                <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Contato</th>
                <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Busca</th>
                <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Estágio</th>
                <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Cadastro</th>
                <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Corretor</th>
                <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">
                  Último contato
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {filtrados.map((l) => (
                <tr key={l.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-4 py-2.5">
                    <div className="text-gray-800 dark:text-gray-200">
                      {l.nome_cadastro ?? l.name ?? 'Sem nome'}
                    </div>
                    {l.intent && (
                      <div className="text-[11px] text-gray-400 dark:text-gray-500">{l.intent}</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 tnum whitespace-nowrap">
                    <div>{telefone(l.phone)}</div>
                    <div className="text-[11px] text-gray-400 dark:text-gray-500">
                      {l.channel_default}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {l.regiao ?? '—'}
                    {l.preco_max_cents && (
                      <div className="text-[11px] text-gray-400 dark:text-gray-500 tnum">
                        até {brl(l.preco_max_cents)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={l.funnel_stage} />
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span
                      className={
                        l.registration_status === 'completo'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-gray-400 dark:text-gray-500'
                      }
                    >
                      {ROTULO_CADASTRO[l.registration_status]}
                    </span>
                    {/* CPF nunca inteiro na tela (PRD 6.2) */}
                    {l.cpf_last4 && (
                      <div className="text-[11px] text-gray-400 dark:text-gray-500 tnum">
                        {cpfMascarado(l.cpf_last4)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {l.corretor ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 tnum whitespace-nowrap">
                    {dataHora(l.last_contact)}
                  </td>
                </tr>
              ))}

              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">
                    Nenhum lead com esses filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

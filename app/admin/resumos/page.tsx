import type { Metadata } from 'next'
import { FileText } from 'lucide-react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { listarResumos } from '@/lib/queries/admin'
import { exigirAcesso } from '@/lib/auth/session'
import { escopoProprio } from '@/lib/auth/permissions'
import { dataHora } from '@/lib/utils/format'

export const metadata: Metadata = { title: 'Resumos — LoveHome' }
export const dynamic = 'force-dynamic'

const ROTULO_GATILHO: Record<string, string> = {
  qualificacao_completa: 'Qualificação completa',
  visita_agendada: 'Visita agendada',
  reengajamento: 'Reengajamento',
  manual: 'Gerado manualmente',
}

export default async function ResumosPage() {
  const sessao = await exigirAcesso('resumos')
  const resumos = await listarResumos(escopoProprio(sessao.role) ? sessao.brokerId : null)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Resumos</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Briefing gerado para o corretor ler antes de ligar
        </p>
      </div>

      {resumos.length === 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
          <FileText className="w-8 h-8 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nenhum resumo ainda. São gerados automaticamente quando uma visita é agendada ou a
            qualificação fica completa.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {resumos.map((r) => (
          <article
            key={r.id}
            className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                  {r.lead ?? 'Contato sem nome'}
                </h2>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                  {ROTULO_GATILHO[r.trigger] ?? r.trigger}
                  {r.corretor && ` · para ${r.corretor}`} · {dataHora(r.created_at)}
                </p>
              </div>
              {r.funnel_stage && <StatusBadge status={r.funnel_stage} />}
            </div>

            {/* whitespace-pre-line: o resumo vem em linhas curtas rotuladas
                ("O que procura:", "Próximo passo:") e a quebra é parte do formato. */}
            <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">
              {r.summary_text}
            </p>
          </article>
        ))}
      </div>
    </div>
  )
}

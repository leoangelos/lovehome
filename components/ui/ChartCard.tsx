import type { ReactNode } from 'react'

/* Porta do ChartCard.vue da referencia. O slot nomeado "acoes" do Vue vira a
   prop `acoes`; o slot default vira children. */

interface ChartCardProps {
  titulo: string
  subtitulo?: string
  acoes?: ReactNode
  children: ReactNode
}

export function ChartCard({ titulo, subtitulo, acoes, children }: ChartCardProps) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{titulo}</h2>
          {subtitulo && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{subtitulo}</p>
          )}
        </div>
        {acoes}
      </div>
      {children}
    </div>
  )
}

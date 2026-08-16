import type { LucideIcon } from 'lucide-react'

/* Porta direta do StatCard.vue da referencia: rotulo pequeno, icone em circulo
   colorido, numero grande tabular, linha de apoio e destaque opcional. */

interface StatCardProps {
  label: string
  valor: string | number
  sub?: string
  destaque?: string
  destaqueClasse?: string
  icon: LucideIcon
  iconBg?: string
  iconColor?: string
}

export function StatCard({
  label,
  valor = '—',
  sub,
  destaque,
  destaqueClasse = 'text-blue-600 dark:text-blue-400',
  icon: Icon,
  iconBg = 'bg-blue-100 dark:bg-blue-900/30',
  iconColor = 'text-blue-600 dark:text-blue-400',
}: StatCardProps) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${iconBg}`}
        >
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
      </div>

      <div className="text-2xl font-bold text-gray-900 dark:text-white leading-tight tnum">
        {valor}
      </div>

      {sub && <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 tnum">{sub}</div>}

      {destaque && (
        <div className={`text-xs font-semibold mt-1 tnum ${destaqueClasse}`}>{destaque}</div>
      )}
    </div>
  )
}

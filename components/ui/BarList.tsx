/* Barras horizontais simples — substituto leve dos graficos Highcharts da
   referencia. Highcharts exige licenca comercial e traz peso de bundle que nao
   se justifica para uma distribuicao de 4 a 7 categorias; se depois surgir
   necessidade de serie temporal ou drilldown, ai sim vale avaliar a biblioteca. */

export interface BarItem {
  label: string
  total: number
  cor?: string
}

export function BarList({ itens }: { itens: BarItem[] }) {
  const max = Math.max(...itens.map((i) => i.total), 1)

  return (
    <div className="space-y-2.5">
      {itens.map((item) => (
        <div key={item.label}>
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-xs text-gray-600 dark:text-gray-400">{item.label}</span>
            <span className="text-xs font-semibold text-gray-900 dark:text-gray-100 tnum">
              {item.total}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div
              className={`h-full rounded-full ${item.cor ?? 'bg-rose-500'}`}
              style={{ width: `${(item.total / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

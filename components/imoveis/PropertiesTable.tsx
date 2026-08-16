'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, ImageOff, Search, X } from 'lucide-react'
import type { Property, PropertyStatus } from '@/lib/types/domain'
import { ROTULOS_STATUS, StatusBadge } from '@/components/ui/StatusBadge'
import { area, brl } from '@/lib/utils/format'

const STATUS_ORDEM: PropertyStatus[] = [
  'em_analise',
  'disponivel',
  'reservado',
  'alugado',
  'vendido',
  'inativo',
]

/* Filtro estruturado puro — mesma ordem de precedencia da tool
   search_properties (PRD 11.2): campos estruturados primeiro, texto livre so
   restringe dentro do que sobrou. Aqui nao ha reranking semantico; a busca por
   texto e literal sobre titulo, codigo e regiao. */

export function PropertiesTable({
  imoveis,
  podeAprovar,
}: {
  imoveis: Property[]
  /* Vem do servidor, de pode(role,'imoveis','editar'). Esconder o botão é
     conveniência — a rota de aprovação valida a permissão de novo. */
  podeAprovar: boolean
}) {
  const router = useRouter()
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erroAcao, setErroAcao] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [status, setStatus] = useState<'todos' | PropertyStatus>('todos')
  const [regiao, setRegiao] = useState('todas')

  const regioes = useMemo(
    () =>
      Array.from(new Set(imoveis.map((i) => i.region))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [imoveis]
  )

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return imoveis
      .filter((i) => status === 'todos' || i.status === status)
      .filter((i) => regiao === 'todas' || i.region === regiao)
      .filter(
        (i) =>
          !termo ||
          i.title.toLowerCase().includes(termo) ||
          i.reference_code.toLowerCase().includes(termo) ||
          i.region.toLowerCase().includes(termo)
      )
      .sort((a, b) => STATUS_ORDEM.indexOf(a.status) - STATUS_ORDEM.indexOf(b.status))
  }, [imoveis, busca, status, regiao])

  const emAnalise = imoveis.filter((i) => i.status === 'em_analise').length

  async function decidir(id: string, acao: 'aprovar' | 'rejeitar') {
    setErroAcao(null)
    setOcupado(id)
    const r = await fetch(`/api/admin/properties/${id}/approve`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao }),
    })
    const corpo = await r.json()
    setOcupado(null)
    if (!r.ok) return setErroAcao(corpo.erro ?? 'Não foi possível concluir.')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {emAnalise > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5">
          <span className="text-xs text-amber-800 dark:text-amber-300">
            <strong className="font-semibold">{emAnalise}</strong>{' '}
            {emAnalise === 1 ? 'imóvel enviado por proprietário aguarda' : 'imóveis enviados por proprietários aguardam'}{' '}
            revisão — só vão à vitrine depois de aprovados.
          </span>
        </div>
      )}

      {erroAcao && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-4 py-2.5">
          {erroAcao}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por título, código ou região"
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30"
          />
        </div>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as 'todos' | PropertyStatus)}
          className="px-3 py-2 text-xs rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none"
        >
          <option value="todos">Todos os status</option>
          {STATUS_ORDEM.map((s) => (
            <option key={s} value={s}>
              {ROTULOS_STATUS[s] ?? s}
            </option>
          ))}
        </select>

        <select
          value={regiao}
          onChange={(e) => setRegiao(e.target.value)}
          className="px-3 py-2 text-xs rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none"
        >
          <option value="todas">Todas as regiões</option>
          {regioes.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <span className="text-xs text-gray-400 dark:text-gray-500 tnum ml-auto">
          {filtrados.length} de {imoveis.length}
        </span>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 text-left">
                <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Código</th>
                <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Imóvel</th>
                <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Região</th>
                <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Config.</th>
                <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 text-right">
                  Venda
                </th>
                <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 text-right">
                  Aluguel
                </th>
                <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Status</th>
                {podeAprovar && emAnalise > 0 && (
                  /* Fixa à direita: com 8 colunas a tabela não cabe em tela
                     estreita, e a coluna de AÇÃO era justamente a que saía de
                     vista. Rolar para alcançar o botão de publicar é o oposto
                     do que a fila de revisão deveria ser. */
                  <th className="sticky right-0 z-10 bg-white dark:bg-gray-900 px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 text-right shadow-[-8px_0_8px_-8px_rgba(0,0,0,.12)]">
                    Revisão
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {filtrados.map((i) => (
                <tr key={i.id} className="group hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-4 py-2.5 tnum whitespace-nowrap">
                    {/* O código é o caminho para a edição — é por ele que a
                        pessoa identifica o imóvel em toda a operação. */}
                    <Link
                      href={`/admin/imoveis/${i.reference_code}`}
                      className="text-gray-500 dark:text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 hover:underline"
                    >
                      {i.reference_code}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200 max-w-xs truncate">
                    {i.title}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {i.region}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 tnum whitespace-nowrap">
                    {i.bedrooms ? `${i.bedrooms} dorm · ` : ''}
                    {area(i.area_m2)}
                  </td>
                  {/* Valor exato, nao brlCurto: a forma curta arredonda para o
                      milhar (R$ 4.800 vira "R$ 5 mil") e esta tabela e
                      ferramenta de trabalho do corretor. A forma curta fica
                      para KPI e eixo de grafico, como na referencia. */}
                  <td className="px-4 py-2.5 text-right text-gray-800 dark:text-gray-200 tnum whitespace-nowrap">
                    {i.price_cents ? brl(i.price_cents) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-800 dark:text-gray-200 tnum whitespace-nowrap">
                    {i.rent_price_cents ? brl(i.rent_price_cents) : '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={i.status} />
                  </td>
                  {podeAprovar && emAnalise > 0 && (
                    /* `bg-inherit` para o hover da linha continuar valendo — com
                       cor fixa, a célula fixada ficaria de um tom diferente do
                       resto da linha ao passar o mouse. */
                    <td className="sticky right-0 z-10 bg-white dark:bg-gray-900 group-hover:bg-gray-50 dark:group-hover:bg-gray-800/50 px-4 py-2.5 text-right whitespace-nowrap shadow-[-8px_0_8px_-8px_rgba(0,0,0,.12)]">
                      {i.status === 'em_analise' && (
                        <span className="inline-flex items-center gap-1">
                          {/* Aviso, não bloqueio: quem revisa é que decide se
                              publica sem foto (a API deixa passar). */}
                          {(i.photos?.length ?? 0) === 0 && (
                            /* Ícone e não texto: "sem fotos" por extenso alargava
                               a coluna e disputava espaço com os botões, que são
                               a razão de a coluna existir. */
                            <ImageOff
                              className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 mr-0.5"
                              aria-label="Este imóvel não tem nenhuma foto"
                            />
                          )}
                          <button
                            type="button"
                            disabled={ocupado === i.id}
                            onClick={() => decidir(i.id, 'aprovar')}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-50"
                          >
                            <Check className="w-3 h-3" />
                            Publicar
                          </button>
                          <button
                            type="button"
                            disabled={ocupado === i.id}
                            onClick={() => decidir(i.id, 'rejeitar')}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                          >
                            <X className="w-3 h-3" />
                            Recusar
                          </button>
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              ))}

              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={podeAprovar && emAnalise > 0 ? 8 : 7} className="px-4 py-8 text-center text-gray-400 dark:text-gray-500">
                    Nenhum imóvel com esses filtros.
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

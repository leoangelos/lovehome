'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Bath, BedDouble, Car, Ruler } from 'lucide-react'
import type { Property } from '@/lib/types/domain'
import { area, brl } from '@/lib/utils/format'


/* Vitrine publica. O filtro segue a mesma precedencia da busca dos agentes
   (PRD 11.2): operacao, regiao, dormitorios e teto de preco sao estruturados e
   definem o conjunto elegivel. Nao ha ranking semantico aqui — a ordenacao e
   por preco, previsivel para quem navega. */

const OPERACOES = [
  { valor: 'venda', label: 'Comprar' },
  { valor: 'aluguel', label: 'Alugar' },
] as const

export function PropertyGrid({ imoveis }: { imoveis: Property[] }) {
  const [operacao, setOperacao] = useState<'venda' | 'aluguel'>('venda')
  const [regiao, setRegiao] = useState('todas')
  const [dorms, setDorms] = useState(0)

  const regioes = useMemo(
    () =>
      Array.from(new Set(imoveis.map((i) => i.region))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [imoveis]
  )

  const filtrados = useMemo(() => {
    /* 'ambos' entra nas duas abas: o imovel esta disponivel para venda E para
       locacao, entao esconde-lo de qualquer uma delas perderia demanda real. */
    const serve = (i: Property) => i.operation === operacao || i.operation === 'ambos'
    const preco = (i: Property) =>
      operacao === 'venda' ? i.price_cents : i.rent_price_cents

    return imoveis
      .filter(serve)
      .filter((i) => preco(i) != null)
      .filter((i) => regiao === 'todas' || i.region === regiao)
      .filter((i) => dorms === 0 || (i.bedrooms ?? 0) >= dorms)
      .sort((a, b) => (preco(a) ?? 0) - (preco(b) ?? 0))
  }, [imoveis, operacao, regiao, dorms])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
          {OPERACOES.map((o) => (
            <button
              key={o.valor}
              type="button"
              onClick={() => setOperacao(o.valor)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                operacao === o.valor
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

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

        <select
          value={dorms}
          onChange={(e) => setDorms(Number(e.target.value))}
          className="px-3 py-2 text-xs rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none"
        >
          <option value={0}>Qualquer nº de dormitórios</option>
          <option value={1}>1+ dormitório</option>
          <option value={2}>2+ dormitórios</option>
          <option value={3}>3+ dormitórios</option>
          <option value={4}>4+ dormitórios</option>
        </select>

        <span className="text-xs text-gray-400 dark:text-gray-500 tnum ml-auto">
          {filtrados.length} {filtrados.length === 1 ? 'imóvel' : 'imóveis'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtrados.map((i) => {
          const preco = operacao === 'venda' ? i.price_cents : i.rent_price_cents
          return (
            /* O card inteiro é o link — a pessoa clica no que estiver olhando,
               não num "ver mais" escondido. A URL usa o reference_code porque é
               o código que o agente cita na conversa. */
            <Link
              key={i.id}
              href={`/imoveis/${i.reference_code}`}
              className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden flex flex-col hover:border-rose-300 dark:hover:border-rose-700 transition-colors"
            >
              {i.photos?.length ? (
                <div className="relative h-36 bg-gray-100 dark:bg-gray-800">
                  <Image
                    src={i.photos[0]}
                    alt={i.title}
                    fill
                    sizes="(max-width: 640px) 100vw, 33vw"
                    className="object-cover"
                  />
                </div>
              ) : (
                /* Placeholder enquanto o imóvel não tem foto — a base ainda tem
                   muitos assim, e área vazia pareceria falha de carregamento. */
                <div className="h-36 bg-gradient-to-br from-rose-100 to-rose-200 dark:from-gray-800 dark:to-gray-700 flex items-center justify-center">
                  <span className="text-[11px] font-medium text-rose-400 dark:text-gray-600 tnum">
                    {i.reference_code}
                  </span>
                </div>
              )}

              <div className="p-4 flex flex-col flex-1">
                <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400 uppercase tracking-wide">
                  {i.property_type} · {i.region}
                </p>

                <h2 className="text-sm font-semibold text-gray-900 dark:text-white mt-1 leading-snug line-clamp-2">
                  {i.title}
                </h2>

                <div className="flex items-center gap-3 mt-3 text-[11px] text-gray-500 dark:text-gray-400 tnum">
                  {i.bedrooms != null && (
                    <span className="flex items-center gap-1">
                      <BedDouble className="w-3.5 h-3.5" />
                      {i.bedrooms}
                    </span>
                  )}
                  {i.bathrooms != null && (
                    <span className="flex items-center gap-1">
                      <Bath className="w-3.5 h-3.5" />
                      {i.bathrooms}
                    </span>
                  )}
                  {i.parking_spots != null && (
                    <span className="flex items-center gap-1">
                      <Car className="w-3.5 h-3.5" />
                      {i.parking_spots}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Ruler className="w-3.5 h-3.5" />
                    {area(i.area_m2)}
                  </span>
                </div>

                <div className="mt-auto pt-4">
                  <p className="text-base font-bold text-gray-900 dark:text-white tnum">
                    {brl(preco)}
                    {operacao === 'aluguel' && (
                      <span className="text-xs font-normal text-gray-400 dark:text-gray-500">
                        {' '}
                        /mês
                      </span>
                    )}
                  </p>
                  {i.condo_fee_cents != null && (
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 tnum">
                      condomínio {brl(i.condo_fee_cents)}
                    </p>
                  )}
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {filtrados.length === 0 && (
        <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-12">
          Nenhum imóvel disponível com esses filtros no momento.
        </p>
      )}
    </div>
  )
}

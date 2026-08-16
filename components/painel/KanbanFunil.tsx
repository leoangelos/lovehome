'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MessageSquare } from 'lucide-react'
import { brlCurto, telefone } from '@/lib/utils/format'
import { ROTULO_ESTAGIO } from '@/lib/ui/rotulos'
import type { ColunaFunil, CartaoFunil } from '@/lib/queries/painel'
import type { FunnelStage } from '@/lib/types/domain'

const COR_COLUNA: Record<string, string> = {
  novo: 'border-t-gray-300 dark:border-t-gray-600',
  qualificando: 'border-t-blue-400',
  qualificado: 'border-t-indigo-400',
  visita_agendada: 'border-t-violet-400',
  em_negociacao: 'border-t-amber-400',
  convertido: 'border-t-emerald-400',
  perdido: 'border-t-red-400',
}

export function KanbanFunil({
  colunas,
  podeMover,
}: {
  colunas: ColunaFunil[]
  podeMover: boolean
}) {
  const router = useRouter()
  const [arrastando, setArrastando] = useState<string | null>(null)
  const [alvo, setAlvo] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  /* Movimento otimista: o cartão pula de coluna antes da resposta do servidor.
     Sem isso o arraste parece não ter funcionado até o refresh chegar. */
  const [otimista, setOtimista] = useState<Record<string, FunnelStage>>({})

  async function mover(contactId: string, estagio: FunnelStage) {
    setErro(null)
    setOtimista((o) => ({ ...o, [contactId]: estagio }))

    const r = await fetch(`/api/admin/leads/${contactId}/estagio`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estagio }),
    })

    if (!r.ok) {
      const corpo = await r.json().catch(() => ({}))
      setErro(corpo.erro ?? 'Não foi possível mover.')
      // Desfaz: deixar o cartão na coluna errada mentiria sobre o estado real.
      setOtimista((o) => {
        const copia = { ...o }
        delete copia[contactId]
        return copia
      })
      return
    }
    router.refresh()
  }

  function estagioDe(c: CartaoFunil): FunnelStage {
    return otimista[c.id] ?? (c.funnel_stage as FunnelStage)
  }

  const todos = colunas.flatMap((c) => c.cartoes)

  return (
    <div className="space-y-3">
      {erro && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-4 py-2.5">
          {erro}
        </p>
      )}

      <div className="flex gap-3 overflow-x-auto pb-3">
        {colunas.map((coluna) => {
          const cartoes = todos.filter((c) => estagioDe(c) === coluna.estagio)
          const destacar = alvo === coluna.estagio && arrastando

          return (
            <div
              key={coluna.estagio}
              onDragOver={(e) => {
                if (!podeMover || !arrastando) return
                e.preventDefault()
                setAlvo(coluna.estagio)
              }}
              onDragLeave={() => setAlvo((a) => (a === coluna.estagio ? null : a))}
              onDrop={(e) => {
                e.preventDefault()
                setAlvo(null)
                if (arrastando && podeMover) mover(arrastando, coluna.estagio)
                setArrastando(null)
              }}
              className={`flex-shrink-0 w-[260px] rounded-xl border-t-2 bg-gray-100/60 dark:bg-gray-900/40 ${
                COR_COLUNA[coluna.estagio] ?? 'border-t-gray-300'
              } ${destacar ? 'ring-2 ring-rose-400/50' : ''}`}
            >
              <div className="px-3 py-2 flex items-center justify-between">
                <h2 className="text-[11px] font-semibold text-gray-700 dark:text-gray-300">
                  {coluna.rotulo}
                </h2>
                <span className="text-[11px] text-gray-400 dark:text-gray-500 tnum">
                  {cartoes.length}
                </span>
              </div>

              <div className="px-2 pb-2 space-y-2 min-h-[80px]">
                {cartoes.map((c) => (
                  <article
                    key={c.id}
                    draggable={podeMover}
                    onDragStart={() => setArrastando(c.id)}
                    onDragEnd={() => {
                      setArrastando(null)
                      setAlvo(null)
                    }}
                    className={`bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-2.5 ${
                      podeMover ? 'cursor-grab active:cursor-grabbing' : ''
                    } ${arrastando === c.id ? 'opacity-40' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
                        {c.nome_cadastro ?? c.name ?? (c.phone ? telefone(c.phone) : 'Sem nome')}
                      </p>
                      {c.esperando_resposta && (
                        <span
                          className="w-2 h-2 rounded-full bg-rose-500 flex-shrink-0 mt-1"
                          title="Esperando resposta"
                        />
                      )}
                    </div>

                    <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate mt-0.5">
                      {c.intent ?? 'sem intenção'}
                      {c.regiao && ` · ${c.regiao}`}
                      {/* brlCurto arredonda para o milhar — serve aqui porque é
                          referência de faixa, não preço de tabela de trabalho. */}
                      {c.preco_max_cents ? ` · até ${brlCurto(c.preco_max_cents)}` : ''}
                    </p>

                    <div className="flex items-center justify-between gap-2 mt-1.5">
                      <span className="text-[10px] text-gray-400 dark:text-gray-600 truncate">
                        {c.corretor ?? 'sem corretor'}
                        {c.registration_status === 'completo' && ' · cadastrado'}
                      </span>

                      {c.conversa_id && (
                        <Link
                          href={`/admin/conversas/${c.conversa_id}`}
                          className="inline-flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400 hover:underline flex-shrink-0"
                        >
                          <MessageSquare className="w-3 h-3" />
                          conversa
                        </Link>
                      )}
                    </div>

                    {podeMover && (
                      /* Arrastar não funciona em toque — HTML5 drag-and-drop não
                         existe em mobile. O seletor é o caminho que funciona em
                         qualquer lugar, e também serve para quem usa teclado. */
                      <select
                        value={estagioDe(c)}
                        onChange={(e) => mover(c.id, e.target.value as FunnelStage)}
                        aria-label={`Mover ${c.name ?? 'lead'} de estágio`}
                        className="mt-2 w-full px-1.5 py-1 text-[10px] rounded-md bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 focus:outline-none focus:ring-1 focus:ring-rose-500/40"
                      >
                        {colunas.map((op) => (
                          <option key={op.estagio} value={op.estagio}>
                            {ROTULO_ESTAGIO[op.estagio]}
                          </option>
                        ))}
                      </select>
                    )}
                  </article>
                ))}

                {cartoes.length === 0 && (
                  <p className="text-[11px] text-gray-300 dark:text-gray-700 text-center py-3">
                    vazio
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

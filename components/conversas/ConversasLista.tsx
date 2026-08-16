'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Bot, MessageSquare, UserCheck } from 'lucide-react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { dataHora, telefone } from '@/lib/utils/format'
import { ROTULO_CANAL } from '@/lib/ui/rotulos'
import type { ConversaLinha } from '@/lib/queries/conversas'

type Filtro = 'nao_respondidas' | 'humano' | 'ia' | 'todas'

const FILTROS: { chave: Filtro; rotulo: string }[] = [
  { chave: 'nao_respondidas', rotulo: 'Esperando resposta' },
  { chave: 'humano', rotulo: 'Com atendente' },
  { chave: 'ia', rotulo: 'Com a IA' },
  { chave: 'todas', rotulo: 'Todas' },
]

export function ConversasLista({ conversas }: { conversas: ConversaLinha[] }) {
  /* Abre em "esperando resposta": a tela existe para agir, e a lista completa
     ordenada por data não diz a ninguém o que fazer primeiro. */
  const [filtro, setFiltro] = useState<Filtro>('nao_respondidas')

  const contagem = {
    todas: conversas.length,
    nao_respondidas: conversas.filter((c) => c.nao_respondida && !c.human_takeover).length,
    humano: conversas.filter((c) => c.human_takeover).length,
    ia: conversas.filter((c) => !c.human_takeover).length,
  }

  const visiveis = conversas.filter((c) => {
    if (filtro === 'nao_respondidas') return c.nao_respondida && !c.human_takeover
    if (filtro === 'humano') return c.human_takeover
    if (filtro === 'ia') return !c.human_takeover
    return true
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {FILTROS.map((f) => (
          <button
            key={f.chave}
            type="button"
            onClick={() => setFiltro(f.chave)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
              filtro === f.chave
                ? 'bg-rose-600 text-white'
                : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:border-rose-300 dark:hover:border-rose-800'
            }`}
          >
            {f.rotulo}
            <span className="ml-1.5 tnum opacity-70">{contagem[f.chave]}</span>
          </button>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
          <MessageSquare className="w-8 h-8 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {filtro === 'nao_respondidas'
              ? 'Ninguém esperando resposta.'
              : filtro === 'humano'
                ? 'Nenhuma conversa com atendente.'
                : 'Nenhuma conversa ainda.'}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {visiveis.map((c) => (
            <Link
              key={c.id}
              href={`/admin/conversas/${c.id}`}
              className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
                    {c.contato_nome ?? (c.contato_telefone ? telefone(c.contato_telefone) : 'Sem nome')}
                  </p>
                  {/* A pílula aparece SEMPRE, não só no takeover: sem ela a
                      lista não dizia quais conversas a IA está conduzindo e
                      quais já estão na mão de alguém — que é a primeira coisa
                      que quem abre esta tela precisa saber. */}
                  {c.human_takeover ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 flex-shrink-0">
                      <UserCheck className="w-3 h-3" />
                      Atendente
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-300 flex-shrink-0">
                      <Bot className="w-3 h-3" />
                      IA
                    </span>
                  )}
                </div>

                {c.ultima_mensagem && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5">
                    {/* Quem falou por último é o que decide se falta resposta. */}
                    {c.ultima_de === 'user' ? '' : '↩ '}
                    {c.ultima_mensagem}
                  </p>
                )}

                <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate mt-0.5">
                  {ROTULO_CANAL[c.channel] ?? c.channel}
                  {c.agent && ` · ${c.agent}`}
                  {c.corretor && ` · ${c.corretor}`}
                  {c.last_message_at && ` · ${dataHora(c.last_message_at)}`}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {c.nao_respondida && !c.human_takeover && (
                  <span className="w-2 h-2 rounded-full bg-rose-500" aria-label="Esperando resposta" />
                )}
                <StatusBadge status={c.funnel_stage} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

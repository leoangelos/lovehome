'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MoreHorizontal, X } from 'lucide-react'
import type { VisitaLinha } from '@/lib/queries/admin'

/* Ações sobre uma visita, direto na linha: confirmar, reagendar, cancelar,
 * realizada, não compareceu. Chama /api/admin/visitas/[id]; a regra (posse,
 * horário livre, corretor) é do servidor — aqui só se monta o pedido.
 *
 * "Avisar o cliente" vem marcado: quem cancela ou remarca pelo painel quase
 * sempre precisa que a pessoa saiba, e o aviso sai pelo canal em que ela
 * conversa. Desmarca quem já ligou. */

const ATIVAS = ['agendada', 'confirmada']

const INPUT =
  'w-full px-2 py-1.5 text-xs rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-rose-500/30'
const BOTAO =
  'w-full text-left text-xs px-2.5 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 disabled:opacity-50'

/** 'YYYY-MM-DDTHH:MM' em horário de São Paulo, para o <input type="datetime-local">. */
function paraInputLocal(iso: string): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso))
  const p: Record<string, string> = {}
  for (const x of partes) p[x.type] = x.value
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

export function AcoesVisita({ visita }: { visita: VisitaLinha }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [modo, setModo] = useState<'menu' | 'reagendar' | 'cancelar'>('menu')
  const [novoQuando, setNovoQuando] = useState(() => paraInputLocal(visita.scheduled_at))
  const [motivo, setMotivo] = useState('')
  const [avisar, setAvisar] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [alternativas, setAlternativas] = useState<{ quando: string; descricao: string }[]>([])
  const [aviso, setAviso] = useState<string | null>(null)

  const ativa = ATIVAS.includes(visita.status)
  if (!ativa) return null

  function abrir() {
    setModo('menu')
    setErro(null)
    setAviso(null)
    setAlternativas([])
    setNovoQuando(paraInputLocal(visita.scheduled_at))
    setMotivo('')
    setAberto(true)
  }

  async function executar(corpo: Record<string, unknown>) {
    setErro(null)
    setAviso(null)
    setOcupado(true)
    const r = await fetch(`/api/admin/visitas/${visita.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...corpo, avisar_cliente: avisar }),
    })
    const resposta = await r.json().catch(() => ({}))
    setOcupado(false)

    if (!r.ok) {
      setErro(resposta.erro ?? 'Não foi possível.')
      setAlternativas(resposta.horarios_livres ?? [])
      return
    }
    /* Feito. Se o aviso não saiu, a pessoa precisa saber para ligar. */
    if (resposta.aviso && !resposta.aviso.enviado) {
      setAviso(`Feito, mas o aviso ao cliente não saiu (${resposta.aviso.motivo ?? 'sem detalhe'}). Avise por outro meio.`)
      router.refresh()
      return
    }
    setAberto(false)
    router.refresh()
  }

  return (
    <div className="relative flex-shrink-0">
      <button
        type="button"
        onClick={aberto ? () => setAberto(false) : abrir}
        aria-label="Ações da visita"
        className="p-1 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {aberto && (
        <div className="absolute right-0 top-7 z-30 w-72 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-lg p-2 space-y-1">
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
              {modo === 'menu' ? 'Ações' : modo === 'reagendar' ? 'Reagendar' : 'Cancelar visita'}
            </span>
            <button type="button" onClick={() => setAberto(false)} aria-label="Fechar">
              <X className="w-3.5 h-3.5 text-gray-400" />
            </button>
          </div>

          {modo === 'menu' && (
            <>
              {visita.status === 'agendada' && (
                <button className={BOTAO} disabled={ocupado} onClick={() => executar({ acao: 'confirmar' })}>
                  Confirmar com o cliente
                </button>
              )}
              <button className={BOTAO} disabled={ocupado} onClick={() => setModo('reagendar')}>
                Reagendar…
              </button>
              <button className={BOTAO} disabled={ocupado} onClick={() => executar({ acao: 'realizada' })}>
                Marcar como realizada
              </button>
              <button className={BOTAO} disabled={ocupado} onClick={() => executar({ acao: 'no_show' })}>
                Não compareceu
              </button>
              <button
                className={`${BOTAO} text-red-600 dark:text-red-400`}
                disabled={ocupado}
                onClick={() => setModo('cancelar')}
              >
                Cancelar visita…
              </button>
            </>
          )}

          {modo === 'reagendar' && (
            <div className="space-y-2 px-1">
              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                Novo horário (São Paulo, hora cheia). Move a mesma visita — o horário atual fica livre.
              </p>
              <input
                type="datetime-local"
                step={3600}
                className={INPUT}
                value={novoQuando}
                onChange={(e) => setNovoQuando(e.target.value)}
              />
              {alternativas.length > 0 && (
                <div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">Livres:</p>
                  <div className="flex flex-wrap gap-1">
                    {alternativas.map((a) => (
                      <button
                        key={a.quando}
                        type="button"
                        onClick={() => setNovoQuando(a.quando.slice(0, 16))}
                        className="text-[11px] px-2 py-0.5 rounded-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-400"
                      >
                        {a.descricao}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <button
                type="button"
                disabled={ocupado || !novoQuando}
                onClick={() => executar({ acao: 'reagendar', scheduled_at: novoQuando })}
                className="w-full text-xs px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60"
              >
                {ocupado ? 'Reagendando…' : 'Reagendar'}
              </button>
            </div>
          )}

          {modo === 'cancelar' && (
            <div className="space-y-2 px-1">
              <input
                className={INPUT}
                placeholder="Motivo (opcional — vai no aviso ao cliente)"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
              <button
                type="button"
                disabled={ocupado}
                onClick={() => executar({ acao: 'cancelar', motivo })}
                className="w-full text-xs px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              >
                {ocupado ? 'Cancelando…' : 'Cancelar visita'}
              </button>
            </div>
          )}

          <label className="flex items-center gap-2 px-1 pt-1 text-[11px] text-gray-500 dark:text-gray-400">
            <input type="checkbox" checked={avisar} onChange={(e) => setAvisar(e.target.checked)} />
            Avisar o cliente pelo canal dele
          </label>

          {erro && <p className="px-1 text-[11px] text-red-600 dark:text-red-400">{erro}</p>}
          {aviso && <p className="px-1 text-[11px] text-amber-600 dark:text-amber-400">{aviso}</p>}
        </div>
      )}
    </div>
  )
}

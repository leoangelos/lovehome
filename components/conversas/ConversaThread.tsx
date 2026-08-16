'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUp, Bot, UserCheck, UserMinus } from 'lucide-react'
import { TraceResposta } from './TraceResposta'
import { dataHora } from '@/lib/utils/format'
import type { ConversaDetalhe } from '@/lib/queries/conversas'

export function ConversaThread({
  conversa,
  podeAtender,
  podeVerTrace,
  souEu,
}: {
  conversa: ConversaDetalhe
  podeAtender: boolean
  /** Trace expõe prompt e retorno de tool — só quem administra o sistema vê. */
  podeVerTrace: boolean
  souEu: boolean
}) {
  const router = useRouter()
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const fim = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fim.current?.scrollIntoView()
  }, [conversa.mensagens.length])

  const noControle = conversa.human_takeover && souEu
  const deOutraPessoa = conversa.human_takeover && !souEu

  async function alternarControle(acao: 'assumir' | 'devolver') {
    setErro(null)
    setOcupado(true)
    const r = await fetch(`/api/admin/conversas/${conversa.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao }),
    })
    setOcupado(false)
    if (!r.ok) {
      const corpo = await r.json().catch(() => ({}))
      return setErro(corpo.erro ?? 'Não foi possível.')
    }
    router.refresh()
  }

  async function enviar() {
    const limpo = texto.trim()
    if (!limpo || ocupado) return

    setErro(null)
    setOcupado(true)
    const r = await fetch(`/api/admin/conversas/${conversa.id}/mensagem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto: limpo }),
    })
    setOcupado(false)

    if (!r.ok) {
      const corpo = await r.json().catch(() => ({}))
      return setErro(corpo.erro ?? 'Não foi possível enviar.')
    }
    setTexto('')
    router.refresh()
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ---- Barra de controle ---- */}
      {/* Faixa de ESTADO, não linha de texto: quem está no controle é a
          informação mais importante da tela — se o bot está ativo, escrever
          aqui não adianta, e a conversa não denuncia isso sozinha.
          O fundo é colorido de propósito, e o botão de assumir NÃO é rosa:
          rosa é a cor das bolhas do agente, e o botão sumia dentro do chat. */}
      <div
        className={`flex-shrink-0 flex flex-wrap items-center justify-between gap-2 mb-3 px-3 py-2 rounded-lg border ${
          conversa.human_takeover
            ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-800/60'
            : 'bg-sky-50 dark:bg-sky-900/20 border-sky-200 dark:border-sky-900/50'
        }`}
      >
        <p className="text-[11px] font-medium">
          {conversa.human_takeover ? (
            <span className="inline-flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
              <UserCheck className="w-3.5 h-3.5" />
              {souEu
                ? 'Você assumiu — o agente está calado e o cliente fala com você.'
                : 'Outra pessoa assumiu esta conversa.'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-sky-800 dark:text-sky-300">
              <Bot className="w-3.5 h-3.5" />
              A IA está respondendo. Para escrever você precisa assumir.
            </span>
          )}
        </p>

        {podeAtender && (
          <div className="flex items-center gap-2">
            {!conversa.human_takeover && (
              <button
                type="button"
                disabled={ocupado}
                onClick={() => alternarControle('assumir')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white shadow-sm"
              >
                <UserCheck className="w-3 h-3" />
                Assumir para responder
              </button>
            )}
            {conversa.human_takeover && (
              <button
                type="button"
                disabled={ocupado}
                onClick={() => alternarControle('devolver')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                <UserMinus className="w-3 h-3" />
                Devolver ao bot
              </button>
            )}
          </div>
        )}
      </div>

      {/* ---- Histórico ---- */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
        {conversa.mensagens.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-600 text-center py-8">
            Nenhuma mensagem nesta conversa.
          </p>
        )}

        {conversa.mensagens.map((m) => {
          const meu = m.role !== 'user'
          const humano = m.agent === 'humano'
          return (
            <div key={m.id} className={meu ? 'flex justify-end' : 'flex justify-start'}>
              <div className="max-w-[75%]">
                <div
                  className={
                    meu
                      ? `px-3.5 py-2 rounded-xl rounded-br-sm text-xs leading-relaxed whitespace-pre-wrap ${
                          humano
                            ? 'bg-amber-500 text-white'
                            : 'bg-rose-600 text-white'
                        }`
                      : 'px-3.5 py-2 rounded-xl rounded-bl-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 text-xs leading-relaxed whitespace-pre-wrap'
                  }
                >
                  {m.content}
                </div>
                <p
                  className={`text-[10px] text-gray-400 dark:text-gray-600 mt-0.5 ${meu ? 'text-right' : ''}`}
                >
                  {/* Distinguir agente de pessoa importa: é o que permite auditar
                      quem prometeu o quê ao cliente. */}
                  {m.role === 'user' ? 'Cliente' : humano ? 'Atendente' : (m.agent ?? 'Agente')}
                  {m.media_type && m.media_type !== 'text' && ` · ${m.media_type}`} ·{' '}
                  {dataHora(m.created_at)}
                </p>

                {/* Só resposta de agente tem trace. Mensagem de pessoa não teve
                    modelo, roteamento nem tool — e a de cliente muito menos. */}
                {podeVerTrace && conversa.traces[m.id] && (
                  <TraceResposta trace={conversa.traces[m.id]} />
                )}
              </div>
            </div>
          )
        })}
        <div ref={fim} />
      </div>

      {erro && (
        <p className="flex-shrink-0 text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-3 py-2 mt-2">
          {erro}
        </p>
      )}

      {/* ---- Resposta ---- */}
      {podeAtender && (
        <div className="flex-shrink-0 mt-3">
          {noControle ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                enviar()
              }}
              className="flex items-end gap-2"
            >
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    enviar()
                  }
                }}
                rows={1}
                placeholder="Escreva para o cliente..."
                className="flex-1 resize-none px-3.5 py-2.5 text-xs rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30 max-h-32"
              />
              <button
                type="submit"
                disabled={!texto.trim() || ocupado}
                className="flex-shrink-0 w-9 h-9 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white flex items-center justify-center"
                aria-label="Enviar"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            </form>
          ) : (
            /* Sem takeover não existe caixa de texto — e a API também recusa.
               Esconder o campo evita escrever uma resposta inteira e só então
               descobrir que ela não vai sair. */
            <p className="text-[11px] text-gray-400 dark:text-gray-600 text-center py-2">
              {deOutraPessoa
                ? 'Outra pessoa assumiu esta conversa.'
                : 'Assuma a conversa para responder — enquanto isso o agente continua atendendo.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

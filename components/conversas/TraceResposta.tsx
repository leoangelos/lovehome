'use client'

import { useState } from 'react'
import { ChevronDown, Route, Wrench } from 'lucide-react'
import type { TraceLinha } from '@/lib/queries/conversas'

/* O caminho que a IA percorreu até uma resposta (PRD 12).
 *
 * Fica RECOLHIDO por padrão: quem abre a conversa está atendendo alguém e quer
 * ler o diálogo. O trace é para quando algo saiu errado — e aí precisa estar a
 * um clique, não numa consulta SQL.
 *
 * Mensagem escrita por pessoa não tem trace, e é correto: não houve modelo,
 * roteamento nem tool. */

function json(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

function duracao(ms: number | null | undefined): string {
  if (!ms) return ''
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

export function TraceResposta({ trace }: { trace: TraceLinha }) {
  const [aberto, setAberto] = useState(false)
  const [verPrompt, setVerPrompt] = useState(false)

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setAberto(!aberto)}
        className="inline-flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-600 hover:text-rose-600 dark:hover:text-rose-400"
      >
        <ChevronDown className={`w-3 h-3 transition-transform ${aberto ? '' : '-rotate-90'}`} />
        como a IA chegou aqui
        {trace.tool_calls?.length > 0 && (
          <span className="opacity-70">· {trace.tool_calls.length} tool</span>
        )}
        {trace.total_duration_ms ? (
          <span className="opacity-70">· {duracao(trace.total_duration_ms)}</span>
        ) : null}
      </button>

      {aberto && (
        <div className="mt-1.5 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-3 space-y-3 text-left">
          {/* ---- Roteamento ---- */}
          <div>
            <p className="text-[10px] font-semibold text-gray-600 dark:text-gray-400 flex items-center gap-1 mb-1">
              <Route className="w-3 h-3" />
              Roteamento
            </p>
            <p className="text-[11px] text-gray-600 dark:text-gray-400">
              Escolheu <strong>{trace.routed_to ?? trace.agent}</strong>
              {trace.routing_model && (
                <span className="text-gray-400 dark:text-gray-600"> · {trace.routing_model}</span>
              )}
            </p>
            {trace.routing_reasoning && (
              /* O "porquê" em texto, vindo do próprio Orquestrador. É o que
                 explica um roteamento estranho sem precisar reproduzir o caso. */
              <p className="text-[11px] text-gray-500 dark:text-gray-500 italic mt-0.5">
                “{trace.routing_reasoning}”
              </p>
            )}
          </div>

          {/* ---- Tools ---- */}
          {trace.tool_calls?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-gray-600 dark:text-gray-400 flex items-center gap-1 mb-1">
                <Wrench className="w-3 h-3" />
                Tools chamadas, na ordem
              </p>
              <ol className="space-y-1.5">
                {trace.tool_calls.map((t, i) => (
                  <li
                    key={i}
                    className="rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-2"
                  >
                    <p className="text-[11px] font-mono text-gray-700 dark:text-gray-300">
                      {i + 1}. {t.name}
                      {t.duration_ms ? (
                        <span className="text-gray-400 dark:text-gray-600 font-sans">
                          {' '}
                          · {duracao(t.duration_ms)}
                        </span>
                      ) : null}
                    </p>
                    <details className="mt-1">
                      <summary className="text-[10px] text-gray-400 dark:text-gray-600 cursor-pointer">
                        argumentos e retorno
                      </summary>
                      <pre className="mt-1 text-[10px] font-mono text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-all overflow-x-auto max-h-52">
                        {`→ ${json(t.arguments)}\n← ${json(t.result)}`}
                      </pre>
                    </details>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* ---- Modelo ---- */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-400 dark:text-gray-600 tnum">
            <span>agente: {trace.agent}</span>
            {trace.agent_model && <span>modelo: {trace.agent_model}</span>}
            {trace.agent_tokens ? <span>{trace.agent_tokens} tokens</span> : null}
          </div>

          {/* ---- Prompt enviado ---- */}
          {trace.prompt_messages && (
            <div>
              <button
                type="button"
                onClick={() => setVerPrompt(!verPrompt)}
                className="text-[10px] text-gray-400 dark:text-gray-600 hover:text-rose-600 dark:hover:text-rose-400"
              >
                {verPrompt ? 'esconder' : 'ver'} o que foi enviado ao modelo
              </button>
              {verPrompt && (
                <div className="mt-1 space-y-1">
                  {/* Truncado em 500 caracteres por mensagem na gravação —
                      guardar prompt inteiro em toda resposta encheria o banco. */}
                  <p className="text-[10px] text-gray-400 dark:text-gray-600">
                    Cada mensagem aparece cortada em 500 caracteres.
                  </p>
                  {trace.prompt_messages.map((m, i) => (
                    <div key={i} className="rounded-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-2">
                      <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-500">
                        {m.role}
                      </p>
                      <pre className="text-[10px] font-mono text-gray-600 dark:text-gray-400 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                        {m.content ?? '—'}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

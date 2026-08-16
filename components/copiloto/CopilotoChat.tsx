'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Sparkles } from 'lucide-react'

interface Mensagem {
  role: 'user' | 'assistant'
  content: string
}

const SUGESTOES = [
  'Quais são minhas visitas de hoje?',
  'Tenho documento pendente para conferir?',
  'O que falta no negócio do LH-1001?',
]

export function CopilotoChat({ primeiroNome }: { primeiroNome: string }) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [texto, setTexto] = useState('')
  const [pensando, setPensando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const fim = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensagens, pensando])

  async function enviar(pergunta: string) {
    const limpa = pergunta.trim()
    if (!limpa || pensando) return

    setErro(null)
    setTexto('')
    /* O histórico enviado é o de ANTES desta pergunta — o servidor acrescenta a
       pergunta atual. Mandar os dois duplicaria a última mensagem no prompt. */
    const anterior = mensagens
    setMensagens([...anterior, { role: 'user', content: limpa }])
    setPensando(true)

    try {
      const r = await fetch('/api/admin/copiloto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pergunta: limpa, historico: anterior }),
      })
      const corpo = await r.json()

      if (!r.ok) {
        setErro(corpo.erro ?? 'Não consegui responder.')
      } else {
        setMensagens((m) => [...m, { role: 'assistant', content: corpo.resposta }])
      }
    } catch {
      setErro('Falha de conexão. Tente de novo.')
    } finally {
      setPensando(false)
    }
  }

  const vazio = mensagens.length === 0

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto">
        {vazio && (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-900/20 flex items-center justify-center mb-3">
              <Sparkles className="w-5 h-5 text-rose-600 dark:text-rose-400" />
            </div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
              Oi, {primeiroNome}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-sm">
              Pergunte sobre sua agenda, seus leads e o que está pendente nos seus negócios.
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-5">
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => enviar(s)}
                  className="px-3 py-1.5 rounded-lg text-[11px] text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:border-rose-300 dark:hover:border-rose-800"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {!vazio && (
          <div className="space-y-3 pb-2">
            {mensagens.map((m, i) => (
              <div
                key={i}
                className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                <div
                  className={
                    m.role === 'user'
                      ? 'max-w-[85%] px-3.5 py-2 rounded-xl rounded-br-sm bg-rose-600 text-white text-xs leading-relaxed whitespace-pre-wrap'
                      : 'max-w-[85%] px-3.5 py-2 rounded-xl rounded-bl-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 text-xs leading-relaxed whitespace-pre-wrap'
                  }
                >
                  {m.content}
                </div>
              </div>
            ))}

            {pensando && (
              <div className="flex justify-start">
                <div className="px-3.5 py-2 rounded-xl rounded-bl-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
                  <span className="flex gap-1">
                    {[0, 150, 300].map((atraso) => (
                      <span
                        key={atraso}
                        className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600 animate-bounce"
                        style={{ animationDelay: `${atraso}ms` }}
                      />
                    ))}
                  </span>
                </div>
              </div>
            )}

            <div ref={fim} />
          </div>
        )}
      </div>

      {erro && (
        <p className="text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-3 py-2 mt-2">
          {erro}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          enviar(texto)
        }}
        className="flex items-end gap-2 mt-3 flex-shrink-0"
      >
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            // Enter envia; Shift+Enter quebra linha — quem usa isso digita rápido.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              enviar(texto)
            }
          }}
          rows={1}
          placeholder="Pergunte sobre sua agenda, seus leads ou seus negócios..."
          className="flex-1 resize-none px-3.5 py-2.5 text-xs rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30 max-h-32"
        />
        <button
          type="submit"
          disabled={!texto.trim() || pensando}
          className="flex-shrink-0 w-9 h-9 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center"
          aria-label="Enviar"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
      </form>

      <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-2 flex-shrink-0">
        O Copiloto consulta dados; ele não aprova negócio, não confere documento e não agenda
        visita. A conversa não fica salva.
      </p>
    </div>
  )
}

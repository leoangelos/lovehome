'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Loader2, Send, Sparkles, X } from 'lucide-react'

/* Copiloto como painel lateral, disponível em qualquer tela do painel (§12.8).
 *
 * A tela dedicada em /admin/copiloto continua existindo — serve para uma sessão
 * longa de perguntas. O painel lateral resolve outra coisa: perguntar sem sair
 * de onde se está. Quem abre a lista de contratos e quer saber quantos estão
 * esperando assinatura não deveria precisar trocar de tela e voltar.
 *
 * O RECORTE DE DADOS NÃO ESTÁ AQUI. Este componente só manda a pergunta; quais
 * ferramentas existem e qual carteira é consultada é decidido no servidor, a
 * partir da sessão (`/api/admin/copiloto`). Forjar mensagem no devtools no
 * máximo confunde o próprio assistente de quem forjou. */

interface Mensagem {
  role: 'user' | 'assistant'
  content: string
}

const CHAVE_ABERTO = 'lovehome:copiloto-aberto'

/* O `localStorage` é sistema EXTERNO ao React — mesma situação da classe de
   tema no `<html>`. Copiá-lo para `useState` dentro de um efeito dispara render
   em cascata e o lint do projeto barra; `useSyncExternalStore` lê a fonte
   direto e devolve `false` no servidor, sem erro de hidratação. */
const assinantes = new Set<() => void>()

function assinar(fn: () => void) {
  assinantes.add(fn)
  return () => assinantes.delete(fn)
}

function lerAberto(): boolean {
  return window.localStorage.getItem(CHAVE_ABERTO) === '1'
}

function gravarAberto(v: boolean) {
  window.localStorage.setItem(CHAVE_ABERTO, v ? '1' : '0')
  assinantes.forEach((fn) => fn())
}

const SUGESTOES = [
  'Quem está em atraso?',
  'Quantos imóveis disponíveis?',
  'Como está o funil?',
  'O que tenho na agenda hoje?',
]

export function CopilotoLateral({ nome }: { nome: string }) {
  const aberto = useSyncExternalStore(assinar, lerAberto, () => false)
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [texto, setTexto] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const fim = useRef<HTMLDivElement>(null)
  const campo = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensagens, carregando])

  function alternar() {
    const novo = !aberto
    gravarAberto(novo)
    if (novo) setTimeout(() => campo.current?.focus(), 50)
  }

  async function perguntar(pergunta: string) {
    const limpa = pergunta.trim()
    if (!limpa || carregando) return

    setErro(null)
    setTexto('')
    const historico = mensagens
    setMensagens([...historico, { role: 'user', content: limpa }])
    setCarregando(true)

    try {
      const r = await fetch('/api/admin/copiloto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pergunta: limpa, historico }),
      })
      const dados = await r.json()

      if (!r.ok) {
        setErro(dados.erro ?? 'Não consegui responder agora.')
        return
      }
      setMensagens((m) => [...m, { role: 'assistant', content: dados.resposta }])
    } catch {
      setErro('Falha de conexão.')
    } finally {
      setCarregando(false)
    }
  }

  return (
    <>
      {/* ---- Botão flutuante ---- */}
      {!aberto && (
        <button
          type="button"
          onClick={alternar}
          aria-label="Abrir o Copiloto"
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium shadow-lg transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          <span className="hidden sm:inline">Copiloto</span>
        </button>
      )}

      {/* ---- Fundo, só no mobile: no desktop o painel divide a tela e a
              pessoa continua trabalhando com ele aberto. ---- */}
      {aberto && (
        <button
          type="button"
          aria-label="Fechar o Copiloto"
          onClick={alternar}
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
        />
      )}

      {/* ---- Painel ---- */}
      <aside
        className={`fixed top-0 right-0 z-50 h-full w-full sm:w-[380px] bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 shadow-xl flex flex-col transition-transform duration-200 ${
          aberto ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-hidden={!aberto}
      >
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-rose-600 dark:text-rose-400" />
            <div>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">Copiloto</p>
              <p className="text-[10px] text-gray-400 dark:text-gray-500">
                Responde dentro do seu acesso
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={alternar}
            aria-label="Fechar"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          {mensagens.length === 0 && (
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                Oi, {nome.split(' ')[0]}. Pergunte sobre a operação — imóveis, leads, agenda,
                contratos, cobrança, ou o que está nos materiais da imobiliária.
              </p>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2 mb-3">
                Eu respondo com os dados que o seu perfil já pode abrir. Não aprovo negócio, não
                gero contrato e não falo com cliente.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SUGESTOES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => perguntar(s)}
                    className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 text-[11px] text-gray-600 dark:text-gray-400 hover:border-rose-300 dark:hover:border-rose-800 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mensagens.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
              <div
                className={
                  m.role === 'user'
                    ? 'max-w-[85%] px-3 py-2 rounded-xl rounded-br-sm bg-rose-600 text-white text-xs leading-relaxed whitespace-pre-wrap'
                    : 'px-3 py-2 rounded-xl rounded-bl-sm bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs leading-relaxed whitespace-pre-wrap'
                }
              >
                {m.content}
              </div>
            </div>
          ))}

          {carregando && (
            <p className="flex items-center gap-2 text-[11px] text-gray-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              consultando…
            </p>
          )}

          {erro && (
            <p className="text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-3 py-2">
              {erro}
            </p>
          )}

          <div ref={fim} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            perguntar(texto)
          }}
          className="flex-shrink-0 flex items-end gap-2 p-3 border-t border-gray-100 dark:border-gray-800"
        >
          <textarea
            ref={campo}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                perguntar(texto)
              }
            }}
            rows={1}
            placeholder="Pergunte alguma coisa…"
            className="flex-1 resize-none px-3 py-2 text-xs rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30 max-h-32"
          />
          <button
            type="submit"
            disabled={carregando || !texto.trim()}
            aria-label="Enviar"
            className="p-2 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white flex-shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </aside>
    </>
  )
}

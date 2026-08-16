'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'

/* Seleção com busca por nome.
 *
 * Existe porque um `<select>` nativo com centenas de linhas obriga a rolar
 * procurando visualmente: numa operação com muitos corretores e proprietários,
 * trocar o responsável de um imóvel vira caça ao nome. O nativo tem busca por
 * digitação, mas só casa o COMEÇO do texto — quem lembra do sobrenome não
 * acha ninguém.
 *
 * Não é dependência nova: é input + lista. O projeto não traz biblioteca de
 * componente, e um combobox acessível cabe em um arquivo. */

export interface OpcaoBuscavel {
  valor: string
  rotulo: string
  /** Linha secundária — CPF mascarado, especialidade, e-mail. */
  detalhe?: string
  /** Texto extra que a busca considera mas a lista não mostra. */
  busca?: string
}

function normalizar(t: string): string {
  return t
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

export function SelecaoBuscavel({
  id,
  opcoes,
  valor,
  aoEscolher,
  rotuloVazio = 'Nenhum',
  placeholder = 'Buscar pelo nome…',
  disabled,
}: {
  id?: string
  opcoes: OpcaoBuscavel[]
  valor: string
  aoEscolher: (valor: string) => void
  rotuloVazio?: string
  placeholder?: string
  disabled?: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const [destaque, setDestaque] = useState(0)
  const caixa = useRef<HTMLDivElement>(null)
  const campoBusca = useRef<HTMLInputElement>(null)

  const escolhida = opcoes.find((o) => o.valor === valor)

  const filtradas = useMemo(() => {
    const q = normalizar(busca)
    if (!q) return opcoes
    /* Casa em qualquer posição, não só no começo: quem lembra "Silva" precisa
       achar "Ana Paula Silva". */
    return opcoes.filter((o) =>
      normalizar(`${o.rotulo} ${o.detalhe ?? ''} ${o.busca ?? ''}`).includes(q)
    )
  }, [opcoes, busca])

  useEffect(() => {
    if (!aberto) return
    campoBusca.current?.focus()

    function foraDaCaixa(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', foraDaCaixa)
    return () => document.removeEventListener('mousedown', foraDaCaixa)
  }, [aberto])

  function escolher(v: string) {
    aoEscolher(v)
    setAberto(false)
    setBusca('')
  }

  function teclado(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setAberto(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setDestaque((d) => Math.min(d + 1, filtradas.length - 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setDestaque((d) => Math.max(d - 1, 0))
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const alvo = filtradas[destaque]
      if (alvo) escolher(alvo.valor)
    }
  }

  return (
    <div className="relative" ref={caixa}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setAberto((a) => !a)}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-left text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-rose-500/30 disabled:opacity-60"
      >
        <span className="truncate">
          {escolhida ? (
            <>
              {escolhida.rotulo}
              {escolhida.detalhe && (
                <span className="text-gray-400 dark:text-gray-500"> · {escolhida.detalhe}</span>
              )}
            </>
          ) : (
            <span className="text-gray-400 dark:text-gray-500">{rotuloVazio}</span>
          )}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
      </button>

      {aberto && (
        <div className="absolute z-30 mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
            <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            <input
              ref={campoBusca}
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value)
                // Volta o destaque para o topo junto com a busca — em efeito, o
                // lint do projeto barra (set-state-in-effect).
                setDestaque(0)
              }}
              onKeyDown={teclado}
              placeholder={placeholder}
              className="w-full bg-transparent text-xs text-gray-800 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none"
            />
            {busca && (
              <button
                type="button"
                onClick={() => {
                  setBusca('')
                  setDestaque(0)
                }}
                aria-label="Limpar busca"
              >
                <X className="w-3.5 h-3.5 text-gray-400" />
              </button>
            )}
          </div>

          <ul role="listbox" className="max-h-56 overflow-y-auto py-1">
            <li>
              <button
                type="button"
                onClick={() => escolher('')}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 ${
                  !valor ? 'text-rose-600 dark:text-rose-400' : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                {rotuloVazio}
              </button>
            </li>

            {filtradas.length === 0 && (
              <li className="px-3 py-3 text-center text-[11px] text-gray-400">
                Nada encontrado para “{busca}”.
              </li>
            )}

            {filtradas.map((o, i) => (
              <li key={o.valor}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.valor === valor}
                  onMouseEnter={() => setDestaque(i)}
                  onClick={() => escolher(o.valor)}
                  className={`w-full flex items-center justify-between gap-2 text-left px-3 py-1.5 text-xs ${
                    i === destaque ? 'bg-gray-50 dark:bg-gray-800' : ''
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-gray-800 dark:text-gray-200">
                      {o.rotulo}
                    </span>
                    {o.detalhe && (
                      <span className="block truncate text-[11px] text-gray-400 dark:text-gray-500">
                        {o.detalhe}
                      </span>
                    )}
                  </span>
                  {o.valor === valor && (
                    <Check className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 flex-shrink-0" />
                  )}
                </button>
              </li>
            ))}
          </ul>

          {opcoes.length > 8 && (
            <p className="px-3 py-1.5 text-[10px] text-gray-400 border-t border-gray-100 dark:border-gray-800">
              {filtradas.length} de {opcoes.length}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

'use client'

import { useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'

/* Equivalente do stores/theme.js (Pinia) da referencia, em React.

   A fonte da verdade e a classe `dark` no <html>, aplicada antes da primeira
   pintura pelo script inline do RootLayout. Isso faz do tema um sistema
   externo ao React, entao o jeito correto de le-lo e useSyncExternalStore —
   ler no corpo do componente quebraria o SSR (nao existe `document`), e copiar
   para useState dentro de um efeito dispara render em cascata.

   getServerSnapshot devolve false: no servidor nao ha como saber a preferencia,
   entao renderiza o icone de "ativar escuro" e o React corrige apos hidratar. */

const CHAVE = 'lovehome_theme'

const ouvintes = new Set<() => void>()

function subscribe(cb: () => void) {
  ouvintes.add(cb)
  return () => {
    ouvintes.delete(cb)
  }
}

function getSnapshot() {
  return document.documentElement.classList.contains('dark')
}

function getServerSnapshot() {
  return false
}

export function ThemeToggle() {
  const isDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  function toggle() {
    const proximo = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', proximo)
    try {
      localStorage.setItem(CHAVE, proximo ? 'dark' : 'light')
    } catch {
      /* modo privado / storage bloqueado: o tema so nao persiste entre sessoes */
    }
    ouvintes.forEach((cb) => cb())
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={isDark ? 'Modo claro' : 'Modo escuro'}
      aria-label={isDark ? 'Ativar modo claro' : 'Ativar modo escuro'}
      className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  )
}

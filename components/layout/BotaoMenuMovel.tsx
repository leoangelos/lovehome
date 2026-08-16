'use client'

import { Menu, X } from 'lucide-react'
import { useMenuMovel, alternarMenuMovel } from '@/components/layout/menu-movel'

/* O botão que abre a navegação no mobile. Some a partir de `lg`, onde a
   sidebar é parte do layout e está sempre visível. */
export function BotaoMenuMovel() {
  const aberto = useMenuMovel()

  return (
    <button
      type="button"
      onClick={() => alternarMenuMovel()}
      aria-label={aberto ? 'Fechar o menu' : 'Abrir o menu'}
      aria-expanded={aberto}
      className="lg:hidden p-1.5 -ml-1 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0"
    >
      {aberto ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
    </button>
  )
}

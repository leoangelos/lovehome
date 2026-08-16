import Link from 'next/link'
import { ExternalLink, LogOut, UserCircle2 } from 'lucide-react'
import { BotaoMenuMovel } from '@/components/layout/BotaoMenuMovel'
import { ThemeToggle } from './ThemeToggle'
import { ROTULO_PAPEL, type Role } from '@/lib/auth/permissions'
import { Logo } from '@/components/ui/Logo'

/* Porta do AppHeader.vue: barra de 56px, marca à esquerda, ações à direita.
   A navegação entre seções saiu do header e foi para a sidebar — o painel tem
   ~15 telas (PRD 8), que não cabem numa linha como os 4 itens da referência. */

export function AppHeader({ nome, email, role }: { nome: string | null; email: string; role: Role }) {
  return (
    <header className="flex items-center justify-between h-14 px-3 sm:px-6 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <BotaoMenuMovel />
        <Logo />
        <div className="min-w-0">
          <h1 className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-tight truncate">
            LoveHome
          </h1>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-tight">
            Atendimento e gestão imobiliária
          </p>
        </div>
      </div>

      <nav className="flex items-center gap-1 flex-shrink-0">
        <Link
          href="/imoveis"
          title="Ver vitrine"
          className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 text-xs font-medium rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <span className="hidden md:inline">Ver vitrine</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </Link>

        <span className="hidden sm:block w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1.5" />

        <Link
          href="/admin/perfil"
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors min-w-0"
          title="Meu perfil"
        >
          <UserCircle2 className="w-4 h-4 text-gray-400 dark:text-gray-500 flex-shrink-0" />
          <span className="min-w-0 hidden sm:block">
            <span className="block text-xs font-medium text-gray-700 dark:text-gray-300 leading-tight truncate max-w-[140px]">
              {nome ?? email}
            </span>
            <span className="block text-[10px] text-gray-400 dark:text-gray-500 leading-tight">
              {ROTULO_PAPEL[role]}
            </span>
          </span>
        </Link>

        <ThemeToggle />

        {/* Formulário e não link: sair é POST, para não ser disparável por
            uma tag de imagem em página de terceiro. */}
        <form action="/auth/sair" method="post">
          <button
            type="submit"
            title="Sair"
            aria-label="Sair"
            className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </form>
      </nav>
    </header>
  )
}

import Link from 'next/link'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { Logo } from '@/components/ui/Logo'
import { WidgetVitrine } from '@/components/vitrine/WidgetVitrine'

/* Shell publico — sem autenticacao e sem sidebar (PRD 17.3). Diferente do
   painel, aqui a pagina rola no body: e conteudo indexavel e compartilhavel,
   nao um app de tela travada. */

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="sticky top-0 z-10 flex items-center justify-between h-14 px-6 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <Link href="/imoveis" className="flex items-center gap-3 min-w-0">
          <Logo />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-tight">
              LoveHome
            </p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-tight">
              Imóveis em São Paulo
            </p>
          </div>
        </Link>

        <nav className="flex items-center gap-1">
          <Link
            href="/admin/dashboard"
            className="px-3 py-1.5 text-xs font-medium rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            Área interna
          </Link>
          <span className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1.5" />
          <ThemeToggle />
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>

      {/* O widget é o mesmo arquivo que um site de terceiro embutiria — a
          vitrine é só o primeiro site a usá-lo. `WidgetVitrine` é dono do
          ciclo de vida: monta ao entrar aqui e destrói ao navegar para fora
          (senão o balão seguia a pessoa até o painel). */}
      <WidgetVitrine />
    </div>
  )
}

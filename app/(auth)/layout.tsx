import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { Logo } from '@/components/ui/Logo'

/* Telas de entrada — sem sidebar e sem dados. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <div className="flex justify-end p-4">
        <ThemeToggle />
      </div>

      <main className="flex-1 flex items-center justify-center px-6 pb-20">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 mb-8">
            <Logo tamanho={40} />
            <div>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 leading-tight">
                LoveHome
              </p>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-tight">
                Painel interno
              </p>
            </div>
          </div>

          {children}
        </div>
      </main>
    </div>
  )
}

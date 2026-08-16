import { AppHeader } from '@/components/layout/AppHeader'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { CopilotoLateral } from '@/components/copiloto/CopilotoLateral'
import { exigirSessao } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissions'

/* Shell do painel — mesma estrutura do App.vue da referência: altura de tela
   travada, header fixo no topo e apenas a área de conteúdo rolando.

   O layout exige sessão, mas NÃO decide permissão por recurso: quem faz isso é
   exigirAcesso() em cada página. Layout do Next não roda antes da página de
   forma garantida em toda navegação, então usá-lo como único portão deixaria
   brecha — aqui ele resolve só "está logado?" e monta a navegação certa. */

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const sessao = await exigirSessao()

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-gray-50 dark:bg-gray-950">
      <AppHeader nome={sessao.nome} email={sessao.email} role={sessao.role} />
      <div className="flex flex-1 overflow-hidden relative">
        <AppSidebar role={sessao.role} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
      </div>

      {/* O painel lateral acompanha a pessoa em qualquer tela. Quem barra é a
          rota da API — esconder o botão é conveniência, não permissão. */}
      {pode(sessao.role, 'copiloto') && (
        <CopilotoLateral nome={sessao.nome || sessao.email} />
      )}
    </div>
  )
}

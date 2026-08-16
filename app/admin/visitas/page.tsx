import type { Metadata } from 'next'
import { VisitasCalendario } from '@/components/visitas/VisitasCalendario'
import { listarVisitas, listarCorretores } from '@/lib/queries/admin'
import { exigirAcesso } from '@/lib/auth/session'
import { escopoProprio } from '@/lib/auth/permissions'

export const metadata: Metadata = { title: 'Visitas — LoveHome' }
export const dynamic = 'force-dynamic'

export default async function VisitasPage() {
  const sessao = await exigirAcesso('visitas')

  /* O recorte por carteira é da CONSULTA, não do filtro da tela: o corretor
     não recebe as linhas dos outros, então nem um devtools aberto mostraria a
     agenda alheia. O seletor de corretor é conveniência de quem vê tudo. */
  const soAPropria = escopoProprio(sessao.role)
  const visitas = await listarVisitas(soAPropria ? sessao.brokerId : null)
  const corretores = soAPropria ? [] : await listarCorretores()

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Visitas</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {soAPropria ? 'Sua agenda' : 'Agenda da equipe'}
        </p>
      </div>

      <VisitasCalendario
        visitas={visitas}
        corretores={corretores.map((c) => ({ id: c.id, name: c.name }))}
        podeFiltrarPorCorretor={!soAPropria}
      />
    </div>
  )
}

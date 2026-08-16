import type { Metadata } from 'next'
import Link from 'next/link'
import { KeyRound } from 'lucide-react'
import { PerfilForm } from '@/components/usuarios/PerfilForm'
import { exigirSessao } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { DESCRICAO_PAPEL, ROTULO_PAPEL, pode, type Recurso } from '@/lib/auth/permissions'

export const metadata: Metadata = { title: 'Meu perfil — LoveHome' }
export const dynamic = 'force-dynamic'

/* Recursos mostrados no resumo de acesso. Fora da lista ficam os que não
   existem como tela ainda — prometer acesso a algo que não abre confunde. */
const RECURSOS_VISIVEIS: { recurso: Recurso; label: string }[] = [
  { recurso: 'dashboard', label: 'Dashboard' },
  { recurso: 'leads', label: 'Leads' },
  { recurso: 'visitas', label: 'Visitas' },
  { recurso: 'resumos', label: 'Resumos' },
  { recurso: 'imoveis', label: 'Imóveis' },
  { recurso: 'corretores', label: 'Corretores' },
  { recurso: 'usuarios', label: 'Usuários' },
]

export default async function PerfilPage() {
  const sessao = await exigirSessao('/admin/perfil')

  const admin = createAdminClient()
  const { data: perfil } = await admin
    .from('profiles')
    .select('full_name, phone, email')
    .eq('id', sessao.userId)
    .single()

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Meu perfil</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{perfil?.email}</p>
      </div>

      <PerfilForm nomeInicial={perfil?.full_name ?? ''} telefoneInicial={perfil?.phone ?? ''} />

      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Seu acesso</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-4">
          <strong className="font-medium text-gray-700 dark:text-gray-300">
            {ROTULO_PAPEL[sessao.role]}
          </strong>{' '}
          — {DESCRICAO_PAPEL[sessao.role]}
          {sessao.role === 'corretor' && ' Você enxerga apenas o que está atribuído a você.'}
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {RECURSOS_VISIVEIS.map(({ recurso, label }) => {
            const ver = pode(sessao.role, recurso)
            const editar = pode(sessao.role, recurso, 'editar')
            return (
              <div
                key={recurso}
                className={`px-3 py-2 rounded-lg border text-[11px] ${
                  ver
                    ? 'border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300'
                    : 'border-dashed border-gray-200 dark:border-gray-800 text-gray-300 dark:text-gray-700'
                }`}
              >
                <div className="font-medium">{label}</div>
                <div className={ver ? 'text-gray-400 dark:text-gray-500' : ''}>
                  {ver ? (editar ? 'ver e editar' : 'somente ver') : 'sem acesso'}
                </div>
              </div>
            )
          })}
        </div>

        {sessao.role === 'corretor' && !sessao.brokerId && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-4">
            Seu perfil ainda não está ligado a um cadastro de corretor — sem isso você não recebe
            leads nem visitas. Peça a um administrador para verificar.
          </p>
        )}
      </section>

      <Link
        href="/definir-senha"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-800 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <KeyRound className="w-3.5 h-3.5" />
        Trocar minha senha
      </Link>
    </div>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'
import { FileSignature } from 'lucide-react'
import { NegociosLista } from '@/components/negocios/NegociosLista'
import { listarNegocios } from '@/lib/queries/negocios'
import { exigirAcesso } from '@/lib/auth/session'
import { escopoProprio, pode } from '@/lib/auth/permissions'

export const metadata: Metadata = { title: 'Contratos — LoveHome' }
export const dynamic = 'force-dynamic'

export default async function ContratosPage() {
  const sessao = await exigirAcesso('contratos')
  const negocios = await listarNegocios(escopoProprio(sessao.role) ? sessao.brokerId : null)

  const emAprovacao = negocios.filter((n) => n.status === 'em_aprovacao').length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Contratos</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Venda e locação · {emAprovacao} aguardando aprovação de {negocios.length} no total
          </p>
        </div>

        {/* Os modelos ficam numa subpágina, não no menu: quem abre "Contratos"
            quer o negócio de alguém, e editar o texto do contrato é tarefa
            ocasional de quem administra. */}
        {pode(sessao.role, 'contratos', 'editar') && (
          <Link
            href="/admin/contratos/templates"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            <FileSignature className="w-3 h-3" />
            Modelos de contrato
          </Link>
        )}
      </div>

      <NegociosLista
        negocios={negocios}
        podeAprovar={pode(sessao.role, 'contratos', 'editar')}
      />
    </div>
  )
}

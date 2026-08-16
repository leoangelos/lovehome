import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { TemplatesEditor } from '@/components/contratos/TemplatesEditor'
import { listarTemplates } from '@/lib/leasing/templates'
import { exigirAcesso } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissions'

export const metadata: Metadata = { title: 'Modelos de contrato — LoveHome' }
export const dynamic = 'force-dynamic'

export default async function TemplatesPage() {
  const sessao = await exigirAcesso('contratos')
  const templates = await listarTemplates()

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/admin/contratos"
          className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 mb-2"
        >
          <ArrowLeft className="w-3 h-3" />
          Contratos
        </Link>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
          Modelos de contrato
        </h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          O texto daqui vira o PDF que as duas partes assinam. Um modelo por tipo fica em uso.
        </p>
      </div>

      <TemplatesEditor
        templates={templates}
        podeEditar={pode(sessao.role, 'contratos', 'editar')}
      />
    </div>
  )
}

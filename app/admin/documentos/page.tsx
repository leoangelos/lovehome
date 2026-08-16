import type { Metadata } from 'next'
import { DocumentosFila } from '@/components/negocios/DocumentosFila'
import { listarDocumentos } from '@/lib/queries/negocios'
import { exigirAcesso } from '@/lib/auth/session'
import { escopoProprio, pode } from '@/lib/auth/permissions'

export const metadata: Metadata = { title: 'Documentos — LoveHome' }
export const dynamic = 'force-dynamic'

export default async function DocumentosPage() {
  const sessao = await exigirAcesso('documentos')
  const documentos = await listarDocumentos(escopoProprio(sessao.role) ? sessao.brokerId : null)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Documentos</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Conferência humana antes de aprovar qualquer negócio
        </p>
      </div>

      <DocumentosFila
        documentos={documentos}
        podeRevisar={pode(sessao.role, 'documentos', 'editar')}
      />
    </div>
  )
}

import type { Metadata } from 'next'
import { PropertiesTable } from '@/components/imoveis/PropertiesTable'
import { listarImoveisAdmin } from '@/lib/queries/properties'
import { exigirAcesso } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissions'

export const metadata: Metadata = {
  title: 'Imóveis — LoveHome',
}

export const dynamic = 'force-dynamic'

export default async function ImoveisAdminPage() {
  const sessao = await exigirAcesso('imoveis')
  const imoveis = await listarImoveisAdmin()

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Imóveis</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Base completa, incluindo o que ainda não está publicado na vitrine
        </p>
      </div>

      <PropertiesTable imoveis={imoveis} podeAprovar={pode(sessao.role, 'imoveis', 'editar')} />
    </div>
  )
}

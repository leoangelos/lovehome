import type { Metadata } from 'next'
import { CanaisPainel } from '@/components/canais/CanaisPainel'
import { lerConfigParaTela } from '@/lib/channels/salvar-config'
import { listarSites } from '@/lib/channels/sites'
import { exigirAcesso } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissions'

export const metadata: Metadata = { title: 'Canais — LoveHome' }
export const dynamic = 'force-dynamic'

export default async function CanaisPage() {
  const sessao = await exigirAcesso('canais')

  const [zapi, meta, widget, asaas, sites] = await Promise.all([
    lerConfigParaTela('zapi'),
    lerConfigParaTela('meta'),
    lerConfigParaTela('widget'),
    lerConfigParaTela('asaas'),
    listarSites(),
  ])

  /* A URL vem do servidor: o webhook precisa do endereço público, e derivar do
     navegador daria localhost para quem estivesse testando local. */
  const urlBase = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Canais</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Credenciais de WhatsApp e sites autorizados a usar o widget. As chaves são gravadas
          criptografadas e nunca voltam para a tela.
        </p>
      </div>

      <CanaisPainel
        configs={[zapi, meta, asaas, widget]}
        sites={sites}
        urlBase={urlBase}
        podeEditar={pode(sessao.role, 'canais', 'editar')}
      />
    </div>
  )
}

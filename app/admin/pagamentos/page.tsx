import type { Metadata } from 'next'
import { PagamentosPainel } from '@/components/pagamentos/PagamentosPainel'
import { montarPainelPagamentos } from '@/lib/queries/pagamentos'
import { exigirAcesso } from '@/lib/auth/session'
import { escopoProprio, pode } from '@/lib/auth/permissions'

export const metadata: Metadata = { title: 'Pagamentos — LoveHome' }
export const dynamic = 'force-dynamic'

export default async function PagamentosPage() {
  const sessao = await exigirAcesso('pagamentos')
  const painel = await montarPainelPagamentos(
    escopoProprio(sessao.role) ? sessao.brokerId : null
  )

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Pagamentos</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {escopoProprio(sessao.role)
            ? 'Aluguéis dos contratos da sua carteira'
            : 'Aluguéis, inadimplência e conciliação com o Asaas'}
        </p>
      </div>

      <PagamentosPainel
        painel={painel}
        podeEditar={pode(sessao.role, 'pagamentos', 'editar')}
      />
    </div>
  )
}

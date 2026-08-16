import type { Metadata } from 'next'
import Link from 'next/link'
import { SlidersHorizontal } from 'lucide-react'
import { FormulariosLista } from '@/components/formularios/FormulariosLista'
import { aguardandoConferencia, listarFormularios } from '@/lib/queries/formularios'
import { exigirAcesso } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissions'

export const metadata: Metadata = { title: 'Formulários — LoveHome' }
export const dynamic = 'force-dynamic'

export default async function FormulariosPage() {
  /* Sem recorte por corretor: 'formularios' não está na matriz do corretor
     (§9.2). Quem chega aqui vê a operação inteira — e só o admin decide, porque
     vincular contato a cadastro dá acesso ao contrato e ao boleto do titular. */
  const sessao = await exigirAcesso('formularios')
  const formularios = await listarFormularios()
  const fila = aguardandoConferencia(formularios)

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Formulários</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {fila.length > 0
              ? `${fila.length} ${fila.length === 1 ? 'cadastro aguarda' : 'cadastros aguardam'} conferência de CPF`
              : 'Links de cadastro e de listagem enviados pelos agentes'}
          </p>
        </div>
        <Link
          href="/admin/formularios/campos"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 text-xs text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-700 transition-colors flex-shrink-0"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Campos do formulário
        </Link>
      </div>

      <FormulariosLista
        formularios={formularios}
        podeDecidir={pode(sessao.role, 'formularios', 'editar')}
      />
    </div>
  )
}

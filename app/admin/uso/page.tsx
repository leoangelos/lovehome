import type { Metadata } from 'next'
import { PainelUsoComponente } from '@/components/uso/PainelUso'
import { montarPainelUso } from '@/lib/queries/uso'
import { exigirAcesso } from '@/lib/auth/session'

export const metadata: Metadata = { title: 'Uso e custo — LoveHome' }
export const dynamic = 'force-dynamic'

export default async function UsoPage() {
  /* `uso` não está na lista de nenhum papel além do admin (que é 'tudo'):
     custo é dado de gestão, não de operação. Nem o viewer, que lê o resto. */
  await exigirAcesso('uso')
  const painel = await montarPainelUso()

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Uso e custo</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Toda chamada de IA do sistema — agentes, orquestrador, copiloto, embeddings,
          transcrição e análise de imagem
        </p>
      </div>

      <PainelUsoComponente painel={painel} />
    </div>
  )
}

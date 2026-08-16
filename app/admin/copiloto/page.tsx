import type { Metadata } from 'next'
import { CopilotoChat } from '@/components/copiloto/CopilotoChat'
import { exigirAcesso } from '@/lib/auth/session'
import { escopoProprio } from '@/lib/auth/permissions'

export const metadata: Metadata = { title: 'Copiloto — LoveHome' }
export const dynamic = 'force-dynamic'

export default async function CopilotoPage() {
  const sessao = await exigirAcesso('copiloto')
  const primeiroNome = (sessao.nome ?? sessao.email).split(' ')[0].split('@')[0]

  return (
    /* Altura travada e só a conversa rolando — mesmo princípio do shell (§17.1).
       Chat com a página inteira rolando afasta o campo de digitação da mão. */
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-shrink-0 mb-4">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Copiloto</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {escopoProprio(sessao.role)
            ? 'Responde com os dados da sua carteira'
            : 'Responde com os dados da operação inteira'}
        </p>
      </div>

      <CopilotoChat primeiroNome={primeiroNome} />
    </div>
  )
}

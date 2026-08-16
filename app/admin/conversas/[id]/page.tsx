import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { ConversaThread } from '@/components/conversas/ConversaThread'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { buscarConversa, ROTULO_CANAL } from '@/lib/queries/conversas'
import { exigirAcesso } from '@/lib/auth/session'
import { escopoProprio, pode } from '@/lib/auth/permissions'
import { cpfMascarado, telefone } from '@/lib/utils/format'

export const metadata: Metadata = { title: 'Conversa — LoveHome' }
export const dynamic = 'force-dynamic'

export default async function ConversaPage({ params }: { params: Promise<{ id: string }> }) {
  const sessao = await exigirAcesso('conversas')
  const { id } = await params

  const conversa = await buscarConversa(id)
  if (!conversa) notFound()

  /* Recorte por carteira também na página: a URL é adivinhável por quem tem
     sessão, e esconder o link da lista não protege nada (§9.3). */
  if (escopoProprio(sessao.role) && conversa.contato.broker_id !== sessao.brokerId) {
    redirect('/admin/conversas')
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-shrink-0 mb-4">
        <Link
          href="/admin/conversas"
          className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 mb-2"
        >
          <ArrowLeft className="w-3 h-3" />
          Conversas
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
              {conversa.contato.nome_cadastro ?? conversa.contato.nome ?? 'Contato sem nome'}
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
              {conversa.contato.telefone && telefone(conversa.contato.telefone)}
              {/* CPF nunca inteiro na tela (PRD 6.2) */}
              {conversa.contato.cpf_last4 && ` · ${cpfMascarado(conversa.contato.cpf_last4)}`}
              {` · ${ROTULO_CANAL[conversa.channel] ?? conversa.channel}`}
              {conversa.contato.corretor && ` · ${conversa.contato.corretor}`}
            </p>
          </div>
          <StatusBadge status={conversa.contato.funnel_stage} />
        </div>

        {/* Respostas dos campos configuráveis (PRD 6.5). Só aparecem se a
            imobiliária configurou perguntas E a pessoa respondeu. */}
        {conversa.contato.extras.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {conversa.contato.extras.map((e) => (
              <span key={e.rotulo} className="text-[11px] text-gray-500 dark:text-gray-400">
                <span className="text-gray-400 dark:text-gray-500">{e.rotulo}:</span>{' '}
                <span className="text-gray-700 dark:text-gray-300">{e.valor}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <ConversaThread
        conversa={conversa}
        podeAtender={pode(sessao.role, 'conversas', 'editar')}
        /* O trace mostra prompt do sistema e retorno cru de tool — inclusive de
           tools que leem dado de cliente. É diagnóstico de sistema, não de
           atendimento: fica com quem administra os agentes. */
        podeVerTrace={pode(sessao.role, 'agentes')}
        souEu={conversa.taken_by === sessao.userId}
      />
    </div>
  )
}

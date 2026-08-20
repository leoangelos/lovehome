'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Download, FileCheck, X } from 'lucide-react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { cpfMascarado, dataHora } from '@/lib/utils/format'
import { ROTULO_DOCUMENTO } from '@/lib/ui/rotulos'
import type { DocumentoLinha } from '@/lib/queries/negocios'

export function DocumentosFila({
  documentos,
  podeRevisar,
}: {
  documentos: DocumentoLinha[]
  podeRevisar: boolean
}) {
  const router = useRouter()
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [recusando, setRecusando] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const pendentes = documentos.filter((d) => d.status === 'pendente_revisao')
  const revisados = documentos.filter((d) => d.status !== 'pendente_revisao')

  async function abrirArquivo(id: string) {
    setErro(null)
    const r = await fetch(`/api/admin/documentos/${id}/arquivo`)
    const corpo = await r.json()
    if (!r.ok) return setErro(corpo.erro ?? 'Não foi possível abrir o arquivo.')
    window.open(corpo.url, '_blank', 'noopener')
  }

  async function decidir(id: string, acao: 'aprovar' | 'rejeitar', motivoTexto?: string) {
    setErro(null)
    setOcupado(id)

    const r = await fetch(`/api/admin/documentos/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao, motivo: motivoTexto }),
    })
    const corpo = await r.json()
    setOcupado(null)

    if (!r.ok) return setErro(corpo.erro ?? 'Não foi possível salvar.')

    /* A recusa dispara aviso ao cliente com o motivo — é assim que ele sabe
       que precisa mandar outro arquivo. Se o aviso não saiu, quem recusou
       precisa saber para avisar por outro meio. */
    if (corpo.aviso && !corpo.aviso.enviado) {
      setErro(`Salvo, mas o aviso ao cliente não saiu (${corpo.aviso.motivo ?? 'sem detalhe'}) — avise por outro meio.`)
    }

    setRecusando(null)
    setMotivo('')
    router.refresh()
  }

  function Linha({ d }: { d: DocumentoLinha }) {
    const emRecusa = recusando === d.id
    return (
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-800 dark:text-gray-200">
              {ROTULO_DOCUMENTO[d.type] ?? d.type}
            </p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
              {d.cliente ?? 'Cliente sem nome'}
              {/* CPF nunca inteiro na tela (PRD 6.2) */}
              {d.cliente_cpf_last4 && ` · ${cpfMascarado(d.cliente_cpf_last4)}`}
              {d.imovel && ` · ${d.imovel}`} · recebido {dataHora(d.created_at)}
            </p>
            {d.storage_path.startsWith('whatsapp://') ? (
              /* Registro sem arquivo: a pessoa afirmou ter enviado, mas o
                 download falhou ou não havia o quê anexar. Dizer onde procurar
                 é melhor do que oferecer um link que não abre. */
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                Sem arquivo guardado — abra a conversa no WhatsApp para visualizar.
              </p>
            ) : (
              <button
                type="button"
                onClick={() => abrirArquivo(d.id)}
                className="inline-flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400 hover:underline mt-0.5"
              >
                <Download className="w-3 h-3" />
                Abrir arquivo
              </button>
            )}
            {d.rejection_reason && (
              <p className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">
                Recusado: {d.rejection_reason}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <StatusBadge status={d.status} />
            {podeRevisar && d.status === 'pendente_revisao' && !emRecusa && (
              <>
                <button
                  type="button"
                  disabled={ocupado === d.id}
                  onClick={() => decidir(d.id, 'aprovar')}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-50"
                >
                  <Check className="w-3 h-3" />
                  Aprovar
                </button>
                <button
                  type="button"
                  disabled={ocupado === d.id}
                  onClick={() => {
                    setRecusando(d.id)
                    setMotivo('')
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                >
                  <X className="w-3 h-3" />
                  Recusar
                </button>
              </>
            )}
          </div>
        </div>

        {emRecusa && (
          <div className="mt-3 flex items-center gap-2">
            <input
              autoFocus
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por que está recusando? O cliente vai receber isso."
              className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30"
            />
            <button
              type="button"
              disabled={!motivo.trim() || ocupado === d.id}
              onClick={() => decidir(d.id, 'rejeitar', motivo)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white"
            >
              Confirmar recusa
            </button>
            <button
              type="button"
              onClick={() => setRecusando(null)}
              className="px-2 py-1.5 rounded-lg text-[11px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {erro && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-4 py-2.5">
          {erro}
        </p>
      )}

      {documentos.length === 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
          <FileCheck className="w-8 h-8 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nenhum documento recebido ainda.
          </p>
        </div>
      )}

      {pendentes.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Aguardando conferência ({pendentes.length})
          </h2>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {pendentes.map((d) => (
              <Linha key={d.id} d={d} />
            ))}
          </div>
        </section>
      )}

      {revisados.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-600 mb-2">
            Já conferidos ({revisados.length})
          </h2>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 opacity-70">
            {revisados.map((d) => (
              <Linha key={d.id} d={d} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

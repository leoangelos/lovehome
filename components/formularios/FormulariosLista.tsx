'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowRight, ClipboardList, Link2, X } from 'lucide-react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { cpfMascarado, dataHora, telefone } from '@/lib/utils/format'
import { ROTULO_TIPO_FORMULARIO as ROTULO_TIPO } from '@/lib/ui/rotulos'
import type { FormularioLinha } from '@/lib/queries/formularios'

const ROTULO_PAPEL: Record<string, string> = {
  interessado: 'Interessado',
  proprietario: 'Proprietário',
  inquilino_ativo: 'Inquilino ativo',
}

function papeis(lista: string[]): string {
  if (!lista.length) return '—'
  return lista.map((p) => ROTULO_PAPEL[p] ?? p).join(', ')
}

export function FormulariosLista({
  formularios,
  podeDecidir,
}: {
  formularios: FormularioLinha[]
  podeDecidir: boolean
}) {
  const router = useRouter()
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [recusando, setRecusando] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const naFila = formularios.filter((f) => f.conflito && !f.conflito.decisao)
  const decididos = formularios.filter((f) => f.conflito?.decisao)
  const comuns = formularios.filter((f) => !f.conflito)

  async function decidir(id: string, acao: 'vincular' | 'recusar', motivoTexto?: string) {
    setErro(null)
    setOcupado(id)

    const r = await fetch(`/api/admin/formularios/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao, motivo: motivoTexto }),
    })
    const corpo = await r.json()
    setOcupado(null)

    if (!r.ok) return setErro(corpo.erro ?? 'Não foi possível salvar.')

    setRecusando(null)
    setMotivo('')
    router.refresh()
  }

  function CartaoConflito({ f }: { f: FormularioLinha }) {
    const c = f.conflito!
    const emRecusa = recusando === f.id
    const semPonteiro = !c.existente

    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-amber-200 dark:border-amber-900/50 overflow-hidden">
        <div className="px-4 py-2.5 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-900/40 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <p className="text-[11px] text-amber-800 dark:text-amber-300">
            CPF já cadastrado — confirme por telefone que é a mesma pessoa antes de vincular.
          </p>
        </div>

        <div className="p-4">
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">
            Veio de {f.contato_nome ?? 'contato sem nome'}
            {f.contato_telefone && ` · ${telefone(f.contato_telefone)}`} · preenchido{' '}
            {dataHora(f.submitted_at ?? f.created_at)}
          </p>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] items-center">
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
              <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1.5">
                Digitou agora
              </p>
              <p className="text-xs font-medium text-gray-800 dark:text-gray-200">
                {c.informado.full_name ?? '—'}
              </p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 break-all">
                {c.informado.email ?? '—'}
              </p>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                {papeis(c.informado.papeis)}
              </p>
            </div>

            <ArrowRight className="w-4 h-4 text-gray-300 dark:text-gray-700 mx-auto rotate-90 sm:rotate-0" />

            <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3">
              <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1.5">
                Já cadastrado
              </p>
              {c.existente ? (
                <>
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-200">
                    {c.existente.full_name}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 break-all">
                    {c.existente.email ?? '—'}
                  </p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                    {/* CPF nunca inteiro na tela (PRD 6.2) */}
                    {cpfMascarado(c.existente.cpf_last4)} · {papeis(c.existente.papeis)}
                  </p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500">
                    desde {dataHora(c.existente.created_at)}
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-gray-400 dark:text-gray-500">
                  Submissão antiga, sem referência ao cadastro que conflitou. Confira pela tela de
                  leads.
                </p>
              )}
            </div>
          </div>

          {podeDecidir && !emRecusa && (
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <button
                type="button"
                disabled={ocupado === f.id || semPonteiro}
                title={
                  semPonteiro ? 'Sem referência ao cadastro que conflitou' : undefined
                }
                onClick={() => decidir(f.id, 'vincular')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white"
              >
                <Link2 className="w-3 h-3" />É a mesma pessoa — vincular
              </button>
              <button
                type="button"
                disabled={ocupado === f.id}
                onClick={() => {
                  setRecusando(f.id)
                  setMotivo('')
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                <X className="w-3 h-3" />
                Não vincular
              </button>
            </div>
          )}

          {emRecusa && (
            <div className="flex items-center gap-2 mt-4">
              <input
                autoFocus
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Por que não vincular? Fica no histórico da submissão."
                className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30"
              />
              <button
                type="button"
                disabled={!motivo.trim() || ocupado === f.id}
                onClick={() => decidir(f.id, 'recusar', motivo)}
                className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white"
              >
                Confirmar
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
      </div>
    )
  }

  function LinhaSimples({ f }: { f: FormularioLinha }) {
    const c = f.conflito
    return (
      <div className="px-4 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-800 dark:text-gray-200">
            {ROTULO_TIPO[f.form_type]}
            {f.resumo_listagem && (
              <span className="font-normal text-gray-500 dark:text-gray-400">
                {' '}
                · {f.resumo_listagem}
              </span>
            )}
          </p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
            {f.contato_nome ?? 'Contato sem nome'}
            {f.contato_telefone && ` · ${telefone(f.contato_telefone)}`} · enviado{' '}
            {dataHora(f.created_at)}
            {f.submitted_at && ` · preenchido ${dataHora(f.submitted_at)}`}
          </p>
          {c?.decisao && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              {c.decisao === 'vinculado' ? 'Vinculado' : 'Não vinculado'} por {c.decidido_por} em{' '}
              {dataHora(c.decidido_em)}
              {c.motivo && ` — ${c.motivo}`}
            </p>
          )}
        </div>
        <StatusBadge status={f.status} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {erro && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-4 py-2.5">
          {erro}
        </p>
      )}

      {formularios.length === 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
          <ClipboardList className="w-8 h-8 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nenhum formulário enviado ainda.
          </p>
        </div>
      )}

      {naFila.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Aguardando conferência ({naFila.length})
          </h2>
          <div className="space-y-3">
            {naFila.map((f) => (
              <CartaoConflito key={f.id} f={f} />
            ))}
          </div>
        </section>
      )}

      {comuns.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Links enviados ({comuns.length})
          </h2>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {comuns.map((f) => (
              <LinhaSimples key={f.id} f={f} />
            ))}
          </div>
        </section>
      )}

      {decididos.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-600 mb-2">
            Conferências resolvidas ({decididos.length})
          </h2>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 opacity-70">
            {decididos.map((f) => (
              <LinhaSimples key={f.id} f={f} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

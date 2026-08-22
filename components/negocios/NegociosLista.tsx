'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, FileSignature, X } from 'lucide-react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { brl, cpfMascarado, data as formatarData } from '@/lib/utils/format'
import { ROTULO_DOCUMENTO } from '@/lib/ui/rotulos'
import type { NegocioLinha } from '@/lib/queries/negocios'
import { ContratoAcoes } from './ContratoAcoes'
import { CondicoesNegocio } from './CondicoesNegocio'
import { AnexarDocumento } from './AnexarDocumento'

const ROTULO_FINANCIAMENTO: Record<string, string> = {
  a_vista: 'à vista',
  financiado: 'financiado',
  consorcio: 'consórcio',
}

export function NegociosLista({
  negocios,
  podeAprovar,
}: {
  negocios: NegocioLinha[]
  podeAprovar: boolean
}) {
  const router = useRouter()
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function decidir(id: string, acao: 'aprovar' | 'rejeitar') {
    setErro(null)
    setOcupado(id)

    const r = await fetch(`/api/admin/deals/${id}/approve`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao }),
    })
    const corpo = await r.json()
    setOcupado(null)

    if (!r.ok) return setErro(corpo.erro ?? 'Não foi possível concluir.')
    router.refresh()
  }

  /* Proposta e desfazer usam a rota própria — que também avisa o cliente pelo
     canal dele. O aviso que falha vira mensagem na tela, não silêncio. */
  async function decidirProposta(id: string, acao: 'aceitar' | 'recusar' | 'desfazer', motivo?: string) {
    setErro(null)
    setOcupado(id)

    const r = await fetch(`/api/admin/deals/${id}/proposta`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao, motivo }),
    })
    const corpo = await r.json().catch(() => ({}))
    setOcupado(null)

    if (!r.ok) return setErro(corpo.erro ?? 'Não foi possível concluir.')
    if (corpo.aviso && !corpo.aviso.enviado) {
      setErro(`Feito, mas o aviso ao cliente não saiu (${corpo.aviso.motivo ?? 'sem detalhe'}) — avise por outro meio.`)
    }
    router.refresh()
  }

  function recusarPropostaComMotivo(id: string) {
    const motivo = window.prompt('Motivo da recusa (opcional — vai no aviso ao cliente):')
    if (motivo === null) return
    void decidirProposta(id, 'recusar', motivo)
  }

  function desfazerComMotivo(id: string) {
    const motivo = window.prompt(
      'Motivo para desfazer (obrigatório — o cliente recebe, e o imóvel volta para a vitrine):'
    )
    if (motivo === null) return
    if (!motivo.trim()) return setErro('Desfazer exige motivo.')
    void decidirProposta(id, 'desfazer', motivo)
  }

  if (negocios.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
        <FileSignature className="w-8 h-8 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Nenhum negócio ainda. Eles nascem quando o agente reserva um imóvel para alguém.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {erro && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-4 py-2.5">
          {erro}
        </p>
      )}

      {negocios.map((n) => {
        const recebidos = new Map(n.documentos_recebidos.map((d) => [d.type, d.status]))
        const viaPainel = new Set(n.documentos_recebidos.filter((d) => d.via === 'painel').map((d) => d.type))
        const semDocumento = n.documentos_recebidos.length === 0
        const porConferir = n.documentos_recebidos.filter(
          (d) => d.status === 'pendente_revisao'
        ).length

        return (
          <article
            key={n.id}
            className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400 uppercase tracking-wide">
                  {n.deal_type === 'locacao' ? 'Locação' : 'Venda'}
                  {n.financing_type && ` · ${ROTULO_FINANCIAMENTO[n.financing_type]}`}
                </p>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white mt-0.5">
                  {n.imovel_titulo ?? 'Imóvel não informado'}
                </h2>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                  {n.imovel} · {n.cliente ?? 'Cliente sem nome'}
                  {n.cliente_cpf_last4 && ` · ${cpfMascarado(n.cliente_cpf_last4)}`}
                  {n.corretor && ` · ${n.corretor}`}
                </p>
              </div>

              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold text-gray-900 dark:text-white tnum">
                  {brl(n.valor_cents)}
                  {n.deal_type === 'locacao' && (
                    <span className="text-[11px] font-normal text-gray-400">/mês</span>
                  )}
                </p>
                <div className="mt-1 flex items-center justify-end gap-1.5">
                  {n.status === 'proposta' && n.fila_posicao != null && (
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-md ${
                        n.fila_posicao === 1
                          ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 font-medium'
                          : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                      }`}
                    >
                      {n.fila_posicao === 1 ? 'avaliar primeiro' : `${n.fila_posicao}ª na fila`}
                      {(n.fila_tamanho ?? 0) > 1 && ` de ${n.fila_tamanho}`}
                    </span>
                  )}
                  <StatusBadge status={n.status} />
                </div>
              </div>
            </div>

            {n.status === 'cancelado' && n.recusa_motivo && (
              <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
                Motivo: {n.recusa_motivo}
              </p>
            )}

            {n.status !== 'cancelado' && <CondicoesNegocio negocio={n} podeEditar={podeAprovar} />}

            {/* Proposta ainda não aceita não tem seção de documentos: eles só
                são pedidos no aceite — é o desenho do fluxo, não um atraso. */}
            {n.status !== 'proposta' && (
            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
              <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500 mb-1.5">
                Documentos
              </p>

              {n.documentos_solicitados.length === 0 ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">Nenhum solicitado ainda.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {n.documentos_solicitados.map((tipo) => {
                    const status = recebidos.get(tipo)
                    const cor =
                      status === 'aprovado'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                        : status === 'rejeitado'
                          ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          : status === 'pendente_revisao'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                            : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500'
                    const sufixo =
                      status === 'aprovado'
                        ? ''
                        : status === 'rejeitado'
                          ? ' · recusado'
                          : status === 'pendente_revisao'
                            ? ' · a conferir'
                            : ' · não enviado'
                    return (
                      <span key={tipo} className={`text-[11px] px-2 py-0.5 rounded-md ${cor}`}>
                        {ROTULO_DOCUMENTO[tipo] ?? tipo}
                        {sufixo}
                        {viaPainel.has(tipo) && ' · pelo painel'}
                      </span>
                    )
                  })}
                </div>
              )}

              {podeAprovar && ['em_aprovacao', 'aprovado'].includes(n.status) && !n.contract_signed_at && (
                <div className="mt-2">
                  <AnexarDocumento
                    dealId={n.id}
                    sugeridos={n.documentos_solicitados.filter((t) => !recebidos.has(t))}
                  />
                </div>
              )}
            </div>
            )}

            {podeAprovar && n.status === 'proposta' && (
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center gap-2">
                <span className="text-[11px] text-gray-400 dark:text-gray-500 mr-auto">
                  Aceitar reserva o imóvel e pede os documentos ao cliente. Recusar não mexe no imóvel.
                </span>
                <button
                  type="button"
                  disabled={ocupado === n.id}
                  onClick={() => decidirProposta(n.id, 'aceitar')}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-50"
                >
                  <Check className="w-3 h-3" />
                  Aceitar proposta
                </button>
                <button
                  type="button"
                  disabled={ocupado === n.id}
                  onClick={() => recusarPropostaComMotivo(n.id)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                >
                  <X className="w-3 h-3" />
                  Recusar
                </button>
              </div>
            )}

            {podeAprovar && n.status === 'em_aprovacao' && (
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center gap-2">
                {/* Aviso, não bloqueio: aprovar sem documento é decisão de quem
                    revisa. O que a API trava é aprovar com documento por
                    conferir — a revisão vem antes (PRD 15.2). */}
                {semDocumento && (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400 mr-auto">
                    Nenhum documento recebido
                  </span>
                )}
                {porConferir > 0 && (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400 mr-auto">
                    {porConferir} documento(s) a conferir antes de aprovar
                  </span>
                )}
                {!semDocumento && porConferir === 0 && <span className="mr-auto" />}

                <button
                  type="button"
                  disabled={ocupado === n.id}
                  onClick={() => decidir(n.id, 'aprovar')}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-50"
                >
                  <Check className="w-3 h-3" />
                  Aprovar negócio
                </button>
                <button
                  type="button"
                  disabled={ocupado === n.id}
                  onClick={() => desfazerComMotivo(n.id)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                >
                  <X className="w-3 h-3" />
                  Desfazer
                </button>
              </div>
            )}

            {/* Negócio aprovado que não vai adiante (financiamento negado,
                desistência) também pode ser desfeito — o imóvel volta à
                vitrine e as propostas da fila continuam lá. 'ativo' não: isso
                é rescisão. */}
            {podeAprovar && n.status === 'aprovado' && !n.contract_signed_at && (
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 flex items-center gap-2">
                <span className="text-[11px] text-gray-400 dark:text-gray-500 mr-auto">
                  Não vai concluir? Desfazer devolve o imóvel à vitrine e avisa o cliente.
                </span>
                <button
                  type="button"
                  disabled={ocupado === n.id}
                  onClick={() => desfazerComMotivo(n.id)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                >
                  <X className="w-3 h-3" />
                  Desfazer negócio
                </button>
              </div>
            )}

            {podeAprovar && <ContratoAcoes negocio={n} />}

            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-3">
              Aberto em {formatarData(n.created_at)}
              {n.contract_signed_at && ` · contrato assinado em ${formatarData(n.contract_signed_at)}`}
            </p>
          </article>
        )
      })}
    </div>
  )
}

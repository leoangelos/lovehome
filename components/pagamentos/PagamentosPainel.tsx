'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CreditCard, ExternalLink, RefreshCw } from 'lucide-react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { brl, cpfMascarado, data as fmtData, dataHora, num } from '@/lib/utils/format'
import type { PainelPagamentos, ParcelaLinha } from '@/lib/queries/pagamentos'

type Filtro = 'atrasadas' | 'aReceber' | 'pagas' | 'todas'

const FILTROS: { chave: Filtro; rotulo: string }[] = [
  { chave: 'atrasadas', rotulo: 'Em atraso' },
  { chave: 'aReceber', rotulo: 'A receber' },
  { chave: 'pagas', rotulo: 'Pagas' },
  { chave: 'todas', rotulo: 'Todas' },
]

function Cartao({
  titulo,
  valor,
  detalhe,
  alerta,
}: {
  titulo: string
  valor: string
  detalhe?: string
  alerta?: boolean
}) {
  return (
    <div
      className={`bg-white dark:bg-gray-900 rounded-xl border p-4 ${
        alerta
          ? 'border-red-200 dark:border-red-900/50'
          : 'border-gray-200 dark:border-gray-800'
      }`}
    >
      <p className="text-[11px] text-gray-400 dark:text-gray-500">{titulo}</p>
      <p
        className={`text-lg font-semibold tnum mt-0.5 ${
          alerta ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'
        }`}
      >
        {valor}
      </p>
      {detalhe && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 tnum mt-0.5">{detalhe}</p>
      )}
    </div>
  )
}

export function PagamentosPainel({
  painel,
  podeEditar,
}: {
  painel: PainelPagamentos
  podeEditar: boolean
}) {
  const router = useRouter()
  /* Abre em "em atraso": a tela existe para agir, e a lista completa por data
     não diz a ninguém o que fazer primeiro. */
  const [filtro, setFiltro] = useState<Filtro>('atrasadas')
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const { resumo, parcelas, orfaos, semCobranca } = painel

  const contagem = {
    atrasadas: parcelas.filter((p) => p.vencida).length,
    aReceber: parcelas.filter((p) => p.status === 'pendente' && !p.vencida).length,
    pagas: parcelas.filter((p) => p.status === 'pago').length,
    todas: parcelas.length,
  }

  const visiveis = parcelas.filter((p) => {
    if (filtro === 'atrasadas') return p.vencida
    if (filtro === 'aReceber') return p.status === 'pendente' && !p.vencida
    if (filtro === 'pagas') return p.status === 'pago'
    return true
  })

  async function sincronizar(dealId: string) {
    setErro(null)
    setAviso(null)
    setOcupado(dealId)

    const r = await fetch(`/api/admin/pagamentos/${dealId}`, { method: 'POST' })
    const corpo = await r.json().catch(() => ({}))
    setOcupado(null)

    if (!r.ok) return setErro(corpo.erro ?? 'Não foi possível sincronizar.')

    setAviso(
      corpo.criou
        ? `Cobrança criada no Asaas — ${corpo.parcelas} parcela(s).`
        : `Sincronizado: ${corpo.parcelas} parcela(s) conferida(s).`
    )
    router.refresh()
  }

  function Linha({ p }: { p: ParcelaLinha }) {
    return (
      <tr className={p.vencida ? 'bg-red-50/40 dark:bg-red-900/10' : ''}>
        <td className="px-4 py-2 tnum whitespace-nowrap text-gray-600 dark:text-gray-400">
          {p.competencia}
        </td>
        <td className="px-3 py-2 text-gray-800 dark:text-gray-200 max-w-[220px] truncate">
          {p.cliente ?? 'Sem cliente'}
          {/* CPF nunca inteiro na tela (PRD 6.2) */}
          {p.cliente_cpf_last4 && (
            <span className="text-gray-400 dark:text-gray-600">
              {' '}
              · {cpfMascarado(p.cliente_cpf_last4)}
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-gray-500 dark:text-gray-400 max-w-[200px] truncate">
          {p.imovel ?? '—'}
        </td>
        <td className="px-3 py-2 text-right tnum whitespace-nowrap text-gray-800 dark:text-gray-200">
          {brl(p.amount_cents)}
        </td>
        <td className="px-3 py-2 tnum whitespace-nowrap text-gray-500 dark:text-gray-400">
          {fmtData(p.due_date)}
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          {/* `vencida` é calculado: o status só vira 'atrasado' quando o Asaas
              avisa, e até lá a parcela venceria em silêncio na tela. */}
          <StatusBadge status={p.vencida ? 'atrasado' : p.status} />
        </td>
        <td className="px-4 py-2 text-right whitespace-nowrap">
          <span className="inline-flex items-center gap-1">
            {p.boleto_url && p.status !== 'pago' && (
              <a
                href={p.boleto_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20"
              >
                <ExternalLink className="w-3 h-3" />
                boleto
              </a>
            )}
            {podeEditar && (
              <button
                type="button"
                disabled={ocupado === p.deal_id}
                onClick={() => sincronizar(p.deal_id)}
                title="Buscar a situação atual no Asaas"
                className="p-1 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
              >
                <RefreshCw className={`w-3 h-3 ${ocupado === p.deal_id ? 'animate-spin' : ''}`} />
              </button>
            )}
          </span>
        </td>
      </tr>
    )
  }

  return (
    <div className="space-y-4">
      {erro && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-4 py-2.5">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900/50 rounded-lg px-4 py-2.5">
          {aviso}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Cartao
          titulo="Em atraso"
          valor={brl(resumo.atrasadoCents)}
          detalhe={`${num(resumo.parcelasAtrasadas)} parcela(s)`}
          alerta={resumo.parcelasAtrasadas > 0}
        />
        <Cartao titulo="A receber" valor={brl(resumo.aReceberCents)} />
        <Cartao
          titulo="Recebido no mês"
          valor={brl(resumo.recebidoMesCents)}
          detalhe={`${num(resumo.contratosAtivos)} contrato(s) ativo(s)`}
        />
      </div>

      {/* ---- Contrato ativo sem cobrança ---- */}
      {semCobranca.length > 0 && (
        <section className="bg-white dark:bg-gray-900 rounded-xl border border-amber-200 dark:border-amber-900/50 overflow-hidden">
          <div className="px-4 py-2.5 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-100 dark:border-amber-900/40 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-px" />
            <p className="text-[11px] text-amber-800 dark:text-amber-300">
              {/* Ativar o contrato não é desfeito quando a criação da cobrança
                  falha — é decisão deliberada. Por isso precisa aparecer aqui. */}
              {semCobranca.length} contrato(s) ativo(s) <strong>sem cobrança no Asaas</strong>. É
              aluguel que não vai ser cobrado enquanto ficar assim.
            </p>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {semCobranca.map((c) => (
              <div key={c.deal_id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-gray-800 dark:text-gray-200 truncate">
                    {c.cliente ?? 'Sem cliente'}
                  </p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                    {c.imovel ?? '—'}
                  </p>
                </div>
                {podeEditar && (
                  <button
                    type="button"
                    disabled={ocupado === c.deal_id}
                    onClick={() => sincronizar(c.deal_id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white flex-shrink-0"
                  >
                    <RefreshCw className={`w-3 h-3 ${ocupado === c.deal_id ? 'animate-spin' : ''}`} />
                    Gerar cobrança
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---- Parcelas ---- */}
      <div className="flex flex-wrap gap-1.5">
        {FILTROS.map((f) => (
          <button
            key={f.chave}
            type="button"
            onClick={() => setFiltro(f.chave)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
              filtro === f.chave
                ? 'bg-rose-600 text-white'
                : 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:border-rose-300 dark:hover:border-rose-800'
            }`}
          >
            {f.rotulo}
            <span className="ml-1.5 tnum opacity-70">{contagem[f.chave]}</span>
          </button>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
          <CreditCard className="w-8 h-8 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {filtro === 'atrasadas'
              ? 'Nenhuma parcela em atraso.'
              : parcelas.length === 0
                ? 'Nenhuma cobrança ainda. Elas nascem quando um contrato de locação é ativado.'
                : 'Nada neste filtro.'}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 text-left text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-2.5 font-medium">Mês</th>
                  <th className="px-3 py-2.5 font-medium">Cliente</th>
                  <th className="px-3 py-2.5 font-medium">Imóvel</th>
                  <th className="px-3 py-2.5 font-medium text-right">Valor</th>
                  <th className="px-3 py-2.5 font-medium">Vencimento</th>
                  <th className="px-3 py-2.5 font-medium">Situação</th>
                  <th className="px-4 py-2.5 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {visiveis.map((p) => (
                  <Linha key={p.id} p={p} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- Conciliação ---- */}
      {orfaos.length > 0 && (
        <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-2">
          <div>
            <h2 className="text-xs font-semibold text-gray-800 dark:text-gray-200">
              A conciliar ({orfaos.length})
            </h2>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
              {/* Não é erro do webhook: é cobrança que existe lá e não aqui. */}
              O Asaas avisou sobre cobranças que este sistema não conhece — normalmente criadas
              direto no painel deles. Sincronize o contrato correspondente para trazê-las.
            </p>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {orfaos.map((e) => (
              <div key={e.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-mono text-gray-700 dark:text-gray-300 truncate">
                    {e.event} · {e.asaas_payment_id}
                  </p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-600">
                    {dataHora(e.recebido_em)}
                    {e.observacao && ` · ${e.observacao}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

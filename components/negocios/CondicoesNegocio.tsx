'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { brl, data as formatarData } from '@/lib/utils/format'
import { paraCentavos, paraTextoReais } from '@/lib/utils/dinheiro'
import type { NegocioLinha } from '@/lib/queries/negocios'

/* Condições do negócio — o que o contrato vai ler. Fica no cartão, acima das
   ações de contrato, porque é ali que a pessoa descobre que faltou o sinal:
   o aviso "campos faltando" aparecia e não havia onde preencher.

   As pendências do contrato são mostradas ANTES de gerar: é mais barato saber
   que falta a forma de pagamento agora do que abrir um PDF com
   "[FORMA DE PAGAMENTO NÃO INFORMADO]" no meio. */

const ROTULO_FINANCIAMENTO: Record<string, string> = {
  a_vista: 'à vista',
  financiado: 'financiado',
  consorcio: 'consórcio',
}

const INPUT =
  'w-full px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-rose-500/30 tnum'
const ROTULO = 'block text-[11px] text-gray-500 dark:text-gray-400 mb-1'

/* Texto mostrado e texto lido falam a mesma língua (pt-BR) — ver lib/utils/dinheiro. */
const reais = paraTextoReais
const centavos = paraCentavos

/** O que o contrato vai apontar como faltando, a partir do que já está no negócio. */
export function pendenciasDoContrato(n: NegocioLinha): string[] {
  const faltam: string[] = []
  if (n.deal_type === 'venda') {
    if (n.down_payment_cents == null) faltam.push('valor do sinal')
    if (!n.financing_type) faltam.push('forma de pagamento')
  } else {
    if (!n.start_date) faltam.push('data de início')
    if (!n.end_date) faltam.push('data de término')
  }
  return faltam
}

export function CondicoesNegocio({ negocio, podeEditar }: { negocio: NegocioLinha; podeEditar: boolean }) {
  const router = useRouter()
  const [editando, setEditando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [preco, setPreco] = useState(() => reais(negocio.valor_cents))
  const [sinal, setSinal] = useState(() => reais(negocio.down_payment_cents))
  const [forma, setForma] = useState(negocio.financing_type ?? '')
  const [itbi, setItbi] = useState(negocio.itbi_status ?? 'pendente')
  const [inicio, setInicio] = useState(negocio.start_date ?? '')
  const [fim, setFim] = useState(negocio.end_date ?? '')
  const [aviso, setAviso] = useState(String(negocio.notice_period_days ?? 30))

  const venda = negocio.deal_type === 'venda'
  const pendencias = pendenciasDoContrato(negocio)
  const editavel = podeEditar && !negocio.contract_signed_at && ['proposta', 'em_aprovacao', 'aprovado'].includes(negocio.status)

  async function salvar() {
    setErro(null)
    const corpo = venda
      ? {
          sale_price_cents: centavos(preco),
          down_payment_cents: centavos(sinal),
          financing_type: forma || null,
          itbi_status: itbi || null,
        }
      : {
          rent_price_cents: centavos(preco),
          start_date: inicio || null,
          end_date: fim || null,
          notice_period_days: aviso === '' ? null : Number(aviso),
        }
    if (Object.values(corpo).some((v) => typeof v === 'number' && Number.isNaN(v))) {
      return setErro('Valor em dinheiro inválido — use números, ex.: 820000 ou 820.000,00.')
    }

    setOcupado(true)
    const r = await fetch(`/api/admin/deals/${negocio.id}/condicoes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    })
    const resposta = await r.json().catch(() => ({}))
    setOcupado(false)
    if (!r.ok) return setErro(resposta.erro ?? 'Não foi possível salvar.')
    setEditando(false)
    router.refresh()
  }

  return (
    <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500">Condições do negócio</p>
        {editavel && !editando && (
          <button
            type="button"
            onClick={() => setEditando(true)}
            className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
          >
            <Pencil className="w-3 h-3" />
            Editar
          </button>
        )}
      </div>

      {!editando && (
        <>
          <p className="text-xs text-gray-600 dark:text-gray-400 tnum">
            {venda ? (
              <>
                Venda por {brl(negocio.valor_cents)} · sinal{' '}
                {negocio.down_payment_cents != null ? brl(negocio.down_payment_cents) : '—'} ·{' '}
                {negocio.financing_type ? ROTULO_FINANCIAMENTO[negocio.financing_type] : 'forma de pagamento —'} · ITBI{' '}
                {negocio.itbi_status ?? 'pendente'}
              </>
            ) : (
              <>
                Aluguel {brl(negocio.valor_cents)}/mês · de {negocio.start_date ? formatarData(negocio.start_date) : '—'} a{' '}
                {negocio.end_date ? formatarData(negocio.end_date) : '—'} · aviso prévio {negocio.notice_period_days ?? 30} dias
              </>
            )}
          </p>
          {pendencias.length > 0 && editavel && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
              O contrato vai sair com lacuna: {pendencias.join(', ')}. Preencha antes de gerar.
            </p>
          )}
        </>
      )}

      {editando && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={ROTULO}>{venda ? 'Valor de venda (R$)' : 'Aluguel mensal (R$)'}</label>
              <input className={INPUT} inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} />
            </div>
            {venda ? (
              <>
                <div>
                  <label className={ROTULO}>Sinal (R$) — 0 se não houver</label>
                  <input className={INPUT} inputMode="decimal" value={sinal} onChange={(e) => setSinal(e.target.value)} placeholder="0" />
                </div>
                <div>
                  <label className={ROTULO}>Forma de pagamento</label>
                  <select className={INPUT} value={forma} onChange={(e) => setForma(e.target.value)}>
                    <option value="">Não informada</option>
                    <option value="a_vista">À vista</option>
                    <option value="financiado">Financiado</option>
                    <option value="consorcio">Consórcio</option>
                  </select>
                </div>
                <div>
                  <label className={ROTULO}>ITBI</label>
                  <select className={INPUT} value={itbi} onChange={(e) => setItbi(e.target.value)}>
                    <option value="pendente">Pendente</option>
                    <option value="pago">Pago</option>
                  </select>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className={ROTULO}>Início</label>
                  <input type="date" className={INPUT} value={inicio} onChange={(e) => setInicio(e.target.value)} />
                </div>
                <div>
                  <label className={ROTULO}>Término</label>
                  <input type="date" className={INPUT} value={fim} onChange={(e) => setFim(e.target.value)} />
                </div>
                <div>
                  <label className={ROTULO}>Aviso prévio (dias)</label>
                  <input type="number" min={0} max={365} className={INPUT} value={aviso} onChange={(e) => setAviso(e.target.value)} />
                </div>
              </>
            )}
          </div>

          {erro && <p className="text-[11px] text-red-600 dark:text-red-400">{erro}</p>}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={ocupado}
              onClick={salvar}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white"
            >
              {ocupado ? 'Salvando…' : 'Salvar condições'}
            </button>
            <button
              type="button"
              disabled={ocupado}
              onClick={() => setEditando(false)}
              className="px-2 py-1.5 rounded-lg text-[11px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

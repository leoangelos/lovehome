'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { Activity, AlertTriangle, ChevronDown, ExternalLink } from 'lucide-react'
import { num } from '@/lib/utils/format'
import type { PainelUso, ResumoPeriodo, LinhaAgrupada } from '@/lib/queries/uso'

/** Custo é da ordem de USD 0,0002 por chamada — 4 casas, senão tudo vira 0,00. */
function usd(v: number): string {
  if (v === 0) return '$0'
  if (v < 0.01) return `$${v.toFixed(4)}`
  return `$${v.toFixed(2)}`
}

function tokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`
  return num(v)
}

function Cartao({ titulo, resumo }: { titulo: string; resumo: ResumoPeriodo }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      <p className="text-[11px] text-gray-400 dark:text-gray-500">{titulo}</p>
      <p className="text-lg font-semibold text-gray-900 dark:text-white tnum mt-0.5">
        {usd(resumo.custoUsd)}
      </p>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 tnum mt-0.5">
        {num(resumo.requisicoes)} requisições · {tokens(resumo.tokens)} tokens
      </p>
      {resumo.falhas > 0 && (
        <p className="text-[11px] text-red-600 dark:text-red-400 tnum mt-0.5">
          {resumo.falhas} com falha
        </p>
      )}
    </div>
  )
}

function Barras({ titulo, linhas }: { titulo: string; linhas: LinhaAgrupada[] }) {
  const maior = Math.max(...linhas.map((l) => l.custoUsd), 0.000001)

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
      <h2 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-3">{titulo}</h2>
      {linhas.length === 0 ? (
        <p className="text-[11px] text-gray-400 dark:text-gray-600">Sem uso no período.</p>
      ) : (
        <div className="space-y-2">
          {linhas.map((l) => (
            <div key={l.chave}>
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <span className="text-gray-700 dark:text-gray-300 truncate">{l.rotulo}</span>
                <span className="text-gray-500 dark:text-gray-400 tnum flex-shrink-0">
                  {usd(l.custoUsd)}
                  <span className="text-gray-400 dark:text-gray-600">
                    {' '}
                    · {num(l.requisicoes)}× · {tokens(l.tokens)}
                  </span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 mt-1 overflow-hidden">
                <div
                  className="h-full rounded-full bg-rose-500"
                  style={{ width: `${Math.max(2, (l.custoUsd / maior) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Par({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between gap-3 text-[11px]">
      <dt className="text-gray-400 dark:text-gray-500">{rotulo}</dt>
      <dd className="text-gray-700 dark:text-gray-300 tnum text-right">{valor}</dd>
    </div>
  )
}

export function PainelUsoComponente({ painel }: { painel: PainelUso }) {
  const [detalhes, setDetalhes] = useState(false)
  const [aberta, setAberta] = useState<string | null>(null)

  const maiorDia = Math.max(...painel.porDia.map((d) => d.custoUsd), 0.000001)

  return (
    <div className="space-y-4">
      {painel.vazio ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
          <Activity className="w-8 h-8 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Nenhuma chamada registrada nos últimos 30 dias.
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">
            {/* Honestidade sobre a origem do dado: o registro começou agora, e
                gasto anterior a ele não existe em lugar nenhum. */}
            O registro de uso passou a valer a partir da instalação desta tela — chamadas
            anteriores não foram contabilizadas.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Cartao titulo="Hoje" resumo={painel.hoje} />
            <Cartao titulo="Últimos 7 dias" resumo={painel.seteDias} />
            <Cartao titulo="Últimos 30 dias" resumo={painel.trintaDias} />
          </div>

          {/* ---- Série diária ---- */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <h2 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Custo por dia
            </h2>
            <div className="flex items-end gap-[3px] h-24">
              {painel.porDia.map((d) => (
                <div
                  key={d.dia}
                  title={`${d.dia}: ${usd(d.custoUsd)} · ${d.requisicoes} requisições`}
                  className="flex-1 bg-rose-500/80 hover:bg-rose-600 rounded-t-sm min-h-[2px]"
                  style={{ height: `${Math.max(2, (d.custoUsd / maiorDia) * 100)}%` }}
                />
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-gray-400 dark:text-gray-600 mt-1.5">
              <span>{painel.porDia[0]?.dia.slice(5)}</span>
              <span>{painel.porDia[painel.porDia.length - 1]?.dia.slice(5)}</span>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Barras titulo="Onde o dinheiro vai (30 dias)" linhas={painel.porOperacao} />
            <Barras titulo="Por modelo (30 dias)" linhas={painel.porModelo} />
          </div>

          {/* ---- Requisições recentes ---- */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
            <button
              type="button"
              onClick={() => setDetalhes(!detalhes)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50"
            >
              <h2 className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                Últimas requisições ({painel.recentes.length})
              </h2>
              <span className="text-[11px] text-gray-400">{detalhes ? 'fechar' : 'abrir'}</span>
            </button>

            {detalhes && (
              <div className="border-t border-gray-100 dark:border-gray-800 overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-gray-400 dark:text-gray-600 border-b border-gray-100 dark:border-gray-800">
                      <th className="text-left font-medium px-4 py-2">Quando</th>
                      <th className="text-left font-medium px-2 py-2">Operação</th>
                      <th className="text-left font-medium px-2 py-2">Modelo</th>
                      <th className="text-right font-medium px-2 py-2">Tokens</th>
                      <th className="text-right font-medium px-2 py-2">Custo</th>
                      <th className="text-right font-medium px-4 py-2">Tempo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {painel.recentes.map((r) => (
                      <Fragment key={r.id}>
                      <tr
                        onClick={() => setAberta((a) => (a === r.id ? null : r.id))}
                        className={`cursor-pointer ${
                          aberta === r.id ? 'bg-gray-50 dark:bg-gray-800/60' : ''
                        } ${r.sucesso ? 'hover:bg-gray-50 dark:hover:bg-gray-800/40' : 'bg-red-50/50 dark:bg-red-900/10'}`}
                      >
                        <td className="px-4 py-1.5 text-gray-500 dark:text-gray-400 tnum whitespace-nowrap">
                          {new Date(r.ocorrido_em).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="px-2 py-1.5 text-gray-700 dark:text-gray-300">
                          {r.operacao}
                          {r.agente && (
                            <span className="text-gray-400 dark:text-gray-600"> · {r.agente}</span>
                          )}
                          {!r.sucesso && (
                            <AlertTriangle className="inline w-3 h-3 ml-1 text-red-500" />
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400">{r.modelo}</td>
                        <td className="px-2 py-1.5 text-right text-gray-500 dark:text-gray-400 tnum">
                          {num(r.tokens_total)}
                        </td>
                        <td className="px-2 py-1.5 text-right text-gray-600 dark:text-gray-300 tnum">
                          {usd(Number(r.custo_usd))}
                        </td>
                        <td className="px-4 py-1.5 text-right text-gray-400 dark:text-gray-600 tnum">
                          {r.duracao_ms ? `${(r.duracao_ms / 1000).toFixed(1)}s` : '—'}
                          <ChevronDown
                            className={`inline w-3 h-3 ml-1.5 text-gray-300 dark:text-gray-600 transition-transform ${
                              aberta === r.id ? 'rotate-180' : ''
                            }`}
                          />
                        </td>
                      </tr>

                      {/* O "por que custou isso". Sem isto a tabela dizia o total
                          e nada mais — e um número de 12 mil tokens sem
                          explicação não deixa ninguém agir. */}
                      {aberta === r.id && (
                        <tr className="bg-gray-50 dark:bg-gray-800/40">
                          <td colSpan={6} className="px-4 py-3">
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div>
                                <p className="text-[11px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                  {r.detalhe?.resumo ?? 'Chamada registrada'}
                                </p>
                                <dl className="space-y-0.5">
                                  <Par rotulo="Tokens de entrada" valor={num(r.tokens_entrada)} />
                                  <Par
                                    rotulo="Tokens de saída"
                                    valor={`${num(r.tokens_saida)} (custa ~4x mais)`}
                                  />
                                  {(r.detalhe?.entradas ?? []).map((e) => (
                                    <Par key={e.rotulo} rotulo={e.rotulo} valor={e.valor} />
                                  ))}
                                </dl>
                              </div>

                              <div>
                                {r.detalhe?.tools && r.detalhe.tools.length > 0 && (
                                  <>
                                    <p className="text-[11px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                                      Ferramentas acionadas
                                    </p>
                                    <ul className="space-y-0.5 mb-3">
                                      {r.detalhe.tools.map((t, i) => (
                                        <li
                                          key={`${t.nome}-${i}`}
                                          className="flex justify-between gap-2 text-[11px]"
                                        >
                                          <span className="font-mono text-gray-600 dark:text-gray-400 truncate">
                                            {t.nome}
                                          </span>
                                          {t.ms !== undefined && (
                                            <span className="tnum text-gray-400 flex-shrink-0">
                                              {t.ms}ms
                                            </span>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  </>
                                )}

                                {!r.sucesso && r.erro && (
                                  <p className="text-[11px] text-red-600 dark:text-red-400 mb-2">
                                    {r.erro}
                                  </p>
                                )}

                                {r.conversation_id ? (
                                  <Link
                                    href={`/admin/conversas/${r.conversation_id}`}
                                    className="inline-flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400 hover:underline"
                                  >
                                    Abrir a conversa — o trace mostra o prompt inteiro
                                    <ExternalLink className="w-3 h-3" />
                                  </Link>
                                ) : (
                                  <p className="text-[11px] text-gray-400 dark:text-gray-500">
                                    {/* Embedding, transcrição e resumo não nascem
                                        de uma conversa aberta no painel. */}
                                    Esta chamada não pertence a uma conversa.
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <p className="text-[10px] text-gray-400 dark:text-gray-600">
        {/* O número precisa vir com a ressalva colada nele. Custo estimado
            apresentado como exato vira decisão errada de orçamento. */}
        Custo <strong>estimado</strong> em dólar, calculado a partir de uma tabela de preços
        mantida no código. Serve para acompanhar tendência e achar o que consome demais — não
        para conferir a fatura da OpenAI.
      </p>
    </div>
  )
}

'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, Building2, CalendarDays, ChevronLeft, ChevronRight, List } from 'lucide-react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { SelecaoBuscavel } from '@/components/ui/SelecaoBuscavel'
import { data as formatarData } from '@/lib/utils/format'
import type { VisitaLinha } from '@/lib/queries/admin'
import { AcoesVisita } from './AcoesVisita'

/* Agenda de visitas em calendário (§17.1).
 *
 * A lista agrupada por dia respondia "o que tenho hoje". O calendário responde
 * a outra pergunta, que a lista não responde: "como está a semana" e "que dia
 * está vazio" — que é o que alguém precisa para encaixar uma visita nova.
 *
 * O filtro por corretor é CONVENIÊNCIA de quem vê tudo. O recorte de acesso
 * continua na consulta do servidor: corretor recebe só a própria agenda e nem
 * chega a receber as linhas dos outros, então o seletor não aparece para ele.
 *
 * O modo "Por imóvel" responde a terceira pergunta: "quem mais vai neste
 * apartamento, e quando" — duas pessoas com corretores diferentes no mesmo
 * imóvel no mesmo horário é o conflito que a agenda por corretor não mostra.
 * O motor de agendamento já recusa isso (e o banco também, por índice único);
 * a visão aqui é para enxergar a ocupação e pegar dado legado. */

const ROTULO_TIPO: Record<string, string> = {
  visita: 'Visita',
  reuniao_investidor: 'Reunião de investidor',
  call_apresentacao: 'Call de apresentação',
}

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** Chave YYYY-MM-DD no fuso LOCAL. `toISOString()` converte para UTC e joga a
    visita das 21h para o dia seguinte — a agenda mostraria o dia errado. */
function chaveDia(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function horaDe(iso: string) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function diaDaSemana(iso: string) {
  const nome = new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long' })
  /* Capitaliza só a inicial, na mão: a classe `capitalize` do CSS trata o hífen
     como separador e renderiza "Segunda-Feira", errado em português. */
  return nome.charAt(0).toUpperCase() + nome.slice(1)
}

/* `no_show` é o valor do enum (VisitStatus) — 'nao_compareceu' nunca casava e a
   falta continuava contando como visita ativa no calendário. */
const CANCELADAS = ['cancelada', 'no_show']

export function VisitasCalendario({
  visitas,
  corretores,
  podeFiltrarPorCorretor,
  podeEditar = false,
}: {
  visitas: VisitaLinha[]
  corretores: { id: string; name: string }[]
  podeFiltrarPorCorretor: boolean
  /** Mostra as ações (confirmar, reagendar, cancelar…). A posse é checada na API. */
  podeEditar?: boolean
}) {
  const hoje = new Date()
  const [modo, setModo] = useState<'calendario' | 'lista' | 'imoveis'>('calendario')
  const [corretor, setCorretor] = useState('')
  const [imovel, setImovel] = useState('')
  const [mes, setMes] = useState(() => new Date(hoje.getFullYear(), hoje.getMonth(), 1))
  const [diaAberto, setDiaAberto] = useState<string | null>(chaveDia(hoje))

  /* Imóveis que aparecem nas visitas carregadas — é o universo útil do filtro. */
  const imoveis = useMemo(() => {
    const m = new Map<string, string>()
    for (const v of visitas) {
      if (v.property_id && !m.has(v.property_id)) {
        m.set(v.property_id, `${v.imovel ?? '?'}${v.imovel_regiao ? ` · ${v.imovel_regiao}` : ''}`)
      }
    }
    return [...m.entries()].map(([valor, rotulo]) => ({ valor, rotulo })).sort((a, b) => a.rotulo.localeCompare(b.rotulo))
  }, [visitas])

  const filtradas = useMemo(
    () =>
      visitas.filter(
        (v) => (!corretor || v.broker_id === corretor) && (!imovel || v.property_id === imovel)
      ),
    [visitas, corretor, imovel]
  )

  const porDia = useMemo(() => {
    const m = new Map<string, VisitaLinha[]>()
    for (const v of filtradas) {
      const k = chaveDia(new Date(v.scheduled_at))
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(v)
    }
    return m
  }, [filtradas])

  /* Grade sempre com semanas inteiras: começa no domingo anterior ao dia 1 e
     termina no sábado seguinte ao último dia. */
  const celulas = useMemo(() => {
    const primeiro = new Date(mes.getFullYear(), mes.getMonth(), 1)
    const inicio = new Date(primeiro)
    inicio.setDate(1 - primeiro.getDay())

    const ultimo = new Date(mes.getFullYear(), mes.getMonth() + 1, 0)
    const total = Math.ceil((primeiro.getDay() + ultimo.getDate()) / 7) * 7

    return Array.from({ length: total }, (_, i) => {
      const d = new Date(inicio)
      d.setDate(inicio.getDate() + i)
      return d
    })
  }, [mes])

  const futuras = filtradas.filter(
    (v) => new Date(v.scheduled_at) >= hoje && ['agendada', 'confirmada'].includes(v.status)
  )

  const doDiaAberto = diaAberto ? (porDia.get(diaAberto) ?? []) : []
  const chaveHoje = chaveDia(hoje)

  return (
    <div className="space-y-4">
      {/* ---- Controles ---- */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMes((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
            aria-label="Mês anterior"
            className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="px-1 sm:px-2 text-xs font-semibold text-gray-800 dark:text-gray-200 min-w-[110px] sm:min-w-[130px] text-center">
            {mes.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
          </span>
          <button
            type="button"
            onClick={() => setMes((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
            aria-label="Próximo mês"
            className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setMes(new Date(hoje.getFullYear(), hoje.getMonth(), 1))
              setDiaAberto(chaveHoje)
            }}
            className="ml-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-800 text-[11px] text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-700"
          >
            Hoje
          </button>
        </div>

        <div className="flex items-center gap-2">
          {podeFiltrarPorCorretor && corretores.length > 0 && (
            <div className="w-52">
              <SelecaoBuscavel
                opcoes={corretores.map((c) => ({ valor: c.id, rotulo: c.name }))}
                valor={corretor}
                aoEscolher={setCorretor}
                rotuloVazio="Todos os corretores"
                placeholder="Buscar corretor…"
              />
            </div>
          )}

          {imoveis.length > 0 && (
            <div className="w-52">
              <SelecaoBuscavel
                opcoes={imoveis}
                valor={imovel}
                aoEscolher={setImovel}
                rotuloVazio="Todos os imóveis"
                placeholder="Buscar imóvel…"
              />
            </div>
          )}

          <div className="flex rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
            {(
              [
                { chave: 'calendario' as const, Icone: CalendarDays, rotulo: 'Calendário' },
                { chave: 'lista' as const, Icone: List, rotulo: 'Lista' },
                { chave: 'imoveis' as const, Icone: Building2, rotulo: 'Por imóvel' },
              ]
            ).map(({ chave, Icone, rotulo }) => (
              <button
                key={chave}
                type="button"
                onClick={() => setModo(chave)}
                aria-pressed={modo === chave}
                title={rotulo}
                className={`px-2.5 py-1.5 ${
                  modo === chave
                    ? 'bg-rose-600 text-white'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                <Icone className="w-3.5 h-3.5" />
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        {futuras.length} agendada{futuras.length === 1 ? '' : 's'} daqui pra frente ·{' '}
        {filtradas.length} na janela carregada
        {corretor && ' · filtrado por corretor'}
        {imovel && ' · filtrado por imóvel'}
      </p>

      {modo === 'calendario' ? (
        <>
          {/* ---- Grade ---- */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div className="grid grid-cols-7 border-b border-gray-100 dark:border-gray-800">
              {DIAS.map((d) => (
                <div
                  key={d}
                  className="px-1 py-1.5 text-center text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase"
                >
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7">
              {celulas.map((d) => {
                const k = chaveDia(d)
                const doDia = porDia.get(k) ?? []
                const ativas = doDia.filter((v) => !CANCELADAS.includes(v.status))
                const outroMes = d.getMonth() !== mes.getMonth()
                const eHoje = k === chaveHoje
                const selecionado = k === diaAberto

                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setDiaAberto(k)}
                    className={`min-h-[68px] sm:min-h-[84px] p-1.5 text-left border-r border-b border-gray-100 dark:border-gray-800 transition-colors ${
                      selecionado
                        ? 'bg-rose-50 dark:bg-rose-900/20'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                    } ${outroMes ? 'opacity-40' : ''}`}
                  >
                    <span
                      className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] tnum ${
                        eHoje
                          ? 'bg-rose-600 text-white font-semibold'
                          : 'text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      {d.getDate()}
                    </span>

                    {/* Até duas na célula; o resto conta. Espremer cinco numa
                        caixa de 84px não deixa nenhuma legível. */}
                    <div className="mt-1 space-y-0.5">
                      {ativas.slice(0, 2).map((v) => (
                        <p
                          key={v.id}
                          className="text-[10px] leading-tight truncate text-gray-600 dark:text-gray-400"
                        >
                          <span className="tnum font-medium">{horaDe(v.scheduled_at)}</span>{' '}
                          {v.lead ?? 'sem nome'}
                        </p>
                      ))}
                      {ativas.length > 2 && (
                        <p className="text-[10px] text-rose-600 dark:text-rose-400 font-medium">
                          +{ativas.length - 2}
                        </p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* ---- Dia selecionado ---- */}
          {diaAberto && (
            <section>
              <h2 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                {formatarData(diaAberto)}
                <span className="font-normal text-gray-400 dark:text-gray-500 ml-2">
                  {diaDaSemana(`${diaAberto}T12:00:00`)}
                </span>
              </h2>
              <LinhasDoDia visitas={doDiaAberto} podeEditar={podeEditar} />
            </section>
          )}
        </>
      ) : modo === 'imoveis' ? (
        <PorImovel visitas={filtradas} hoje={hoje} podeEditar={podeEditar} />
      ) : (
        <div className="space-y-5">
          {porDia.size === 0 && <Vazio />}
          {[...porDia.entries()].map(([dia, doDia]) => (
            <section key={dia}>
              <h2
                className={`text-xs font-semibold mb-2 ${
                  new Date(`${dia}T23:59:59`) < hoje
                    ? 'text-gray-400 dark:text-gray-600'
                    : 'text-gray-700 dark:text-gray-300'
                }`}
              >
                {formatarData(dia)}
                <span className="font-normal text-gray-400 dark:text-gray-500 ml-2">
                  {diaDaSemana(`${dia}T12:00:00`)}
                </span>
              </h2>
              <LinhasDoDia visitas={doDia} podeEditar={podeEditar} />
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function LinhasDoDia({ visitas, podeEditar }: { visitas: VisitaLinha[]; podeEditar: boolean }) {
  if (visitas.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-6 text-center">
        <p className="text-xs text-gray-400 dark:text-gray-500">Nenhuma visita neste dia.</p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
      {visitas.map((v) => (
        <div key={v.id} className="flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200 tnum w-12 flex-shrink-0">
            {horaDe(v.scheduled_at)}
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
              {v.lead ?? 'Contato sem nome'}
              {v.type !== 'visita' && (
                <span className="ml-2 text-[11px] font-normal text-violet-600 dark:text-violet-400">
                  {ROTULO_TIPO[v.type]}
                </span>
              )}
            </p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
              {v.imovel ?? 'Imóvel não informado'}
              {v.imovel_regiao && ` · ${v.imovel_regiao}`} · {v.corretor ?? 'Sem corretor'}
            </p>
          </div>

          <StatusBadge status={v.status} />
          {podeEditar && <AcoesVisita visita={v} />}
        </div>
      ))}
    </div>
  )
}

/**
 * Ocupação por imóvel: só visitas ativas daqui pra frente, agrupadas por
 * apartamento e ordenadas pela próxima. Duas visitas ativas no mesmo imóvel
 * com menos de 1h de diferença ganham a marca de conflito — o motor não deixa
 * mais criar assim, então o que aparecer aqui é dado antigo ou marcação manual.
 */
function PorImovel({ visitas, hoje, podeEditar }: { visitas: VisitaLinha[]; hoje: Date; podeEditar: boolean }) {
  const grupos = useMemo(() => {
    const ativas = visitas.filter(
      (v) => new Date(v.scheduled_at) >= hoje && ['agendada', 'confirmada'].includes(v.status)
    )
    const m = new Map<string, VisitaLinha[]>()
    for (const v of ativas) {
      const k = v.property_id ?? 'sem-imovel'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(v)
    }
    return [...m.entries()]
      .map(([id, lista]) => {
        lista.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
        const conflitos = new Set<string>()
        for (let i = 1; i < lista.length; i++) {
          const antes = new Date(lista[i - 1].scheduled_at).getTime()
          const agora = new Date(lista[i].scheduled_at).getTime()
          if (agora - antes < 60 * 60_000) {
            conflitos.add(lista[i - 1].id)
            conflitos.add(lista[i].id)
          }
        }
        return { id, lista, conflitos }
      })
      .sort((a, b) => a.lista[0].scheduled_at.localeCompare(b.lista[0].scheduled_at))
  }, [visitas, hoje])

  if (grupos.length === 0) return <Vazio />

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {grupos.map(({ id, lista, conflitos }) => {
        const primeira = lista[0]
        return (
          <div
            key={id}
            className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden"
          >
            <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                  {primeira.imovel ?? 'Imóvel não informado'}
                  {primeira.imovel_regiao && (
                    <span className="font-normal text-gray-400 dark:text-gray-500"> · {primeira.imovel_regiao}</span>
                  )}
                </p>
                {primeira.imovel_titulo && (
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{primeira.imovel_titulo}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {conflitos.size > 0 && (
                  <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400">
                    <AlertTriangle className="w-3 h-3" />
                    conflito de horário
                  </span>
                )}
                <span className="text-[11px] px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 tnum">
                  {lista.length} visita{lista.length === 1 ? '' : 's'}
                </span>
              </div>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {lista.map((v) => (
                <div
                  key={v.id}
                  className={`flex items-center gap-3 px-4 py-2.5 ${
                    conflitos.has(v.id) ? 'bg-red-50/60 dark:bg-red-900/10' : ''
                  }`}
                >
                  <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 tnum w-20 flex-shrink-0">
                    {formatarData(chaveDia(new Date(v.scheduled_at))).slice(0, 5)} {horaDe(v.scheduled_at)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-gray-800 dark:text-gray-200 truncate">{v.lead ?? 'Contato sem nome'}</p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                      {v.corretor ?? 'Sem corretor'}
                      {v.type !== 'visita' && ` · ${ROTULO_TIPO[v.type]}`}
                    </p>
                  </div>
                  <StatusBadge status={v.status} />
                  {podeEditar && <AcoesVisita visita={v} />}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Vazio() {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
      <CalendarDays className="w-8 h-8 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
      <p className="text-sm text-gray-500 dark:text-gray-400">Nenhuma visita nesta janela.</p>
    </div>
  )
}

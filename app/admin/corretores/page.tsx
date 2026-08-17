import type { Metadata } from 'next'
import { Building2, CalendarCheck, Users } from 'lucide-react'
import { listarCorretores, listarRegioesDoAcervo } from '@/lib/queries/admin'
import { exigirAcesso } from '@/lib/auth/session'
import { escopoProprio, pode } from '@/lib/auth/permissions'
import { num, telefone } from '@/lib/utils/format'
import { CorretorEditor } from '@/components/corretores/CorretorEditor'

export const metadata: Metadata = { title: 'Corretores — LoveHome' }
export const dynamic = 'force-dynamic'

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

const ROTULO_ESPECIALIDADE: Record<string, string> = {
  residencial: 'Residencial',
  investimento: 'Investimento',
  comercial: 'Comercial',
  geral: 'Geral',
}

/** 'seg-sex 09:00–18:00 (almoço 12:00–13:00)' em vez de cinco linhas iguais. */
function resumirAgenda(
  agenda: {
    weekday: number
    start_time: string
    end_time: string
    break_start: string | null
    break_end: string | null
  }[]
) {
  if (agenda.length === 0) return null

  const porHorario = new Map<string, number[]>()
  for (const j of agenda) {
    const almoco =
      j.break_start && j.break_end ? ` (almoço ${j.break_start.slice(0, 5)}–${j.break_end.slice(0, 5)})` : ''
    const chave = `${j.start_time.slice(0, 5)}–${j.end_time.slice(0, 5)}${almoco}`
    if (!porHorario.has(chave)) porHorario.set(chave, [])
    porHorario.get(chave)!.push(j.weekday)
  }

  return [...porHorario.entries()].map(([horario, dias]) => {
    const ordenados = [...dias].sort((a, b) => a - b)
    const sequencial =
      ordenados.length > 2 && ordenados.every((d, i) => i === 0 || d === ordenados[i - 1] + 1)
    const rotuloDias = sequencial
      ? `${DIAS[ordenados[0]]}-${DIAS[ordenados[ordenados.length - 1]]}`
      : ordenados.map((d) => DIAS[d]).join(', ')
    return `${rotuloDias} ${horario}`
  })
}

export default async function CorretoresPage() {
  const sessao = await exigirAcesso('corretores')
  const [corretores, regioes] = await Promise.all([listarCorretores(), listarRegioesDoAcervo()])

  const editaTodos = pode(sessao.role, 'corretores', 'editar')
  /* O próprio corretor edita a própria ficha (agenda, almoço, áreas, contato).
     Ativar/desativar continua sendo de quem gere o time. */
  const podeEditar = (id: string) => editaTodos || (escopoProprio(sessao.role) && sessao.brokerId === id)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Corretores</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Time, carteira, áreas de atuação e agenda — é daqui que o agente de agendamento tira os horários
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {corretores.map((c) => {
          const agenda = resumirAgenda(c.agenda)
          return (
            <div
              key={c.id}
              className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{c.name}</h2>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                    {c.specialty ? ROTULO_ESPECIALIDADE[c.specialty] : 'Sem especialidade'}
                    {c.phone && ` · ${telefone(c.phone)}`}
                    {c.email && ` · ${c.email}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {!c.is_active && (
                    <span className="text-[11px] px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500">
                      Inativo
                    </span>
                  )}
                  {podeEditar(c.id) && (
                    <CorretorEditor corretor={c} regioesSugeridas={regioes} podeAtivar={editaTodos} />
                  )}
                </div>
              </div>

              {c.region_focus && c.region_focus.length > 0 ? (
                <div className="flex flex-wrap gap-1 mt-3">
                  {c.region_focus.map((r) => (
                    <span
                      key={r}
                      className="text-[11px] px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-3">
                  Sem áreas de atuação — só recebe visitas dos próprios imóveis.
                </p>
              )}

              <div className="grid grid-cols-3 gap-2 sm:gap-3 mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                    <Building2 className="w-3.5 h-3.5" />
                    Imóveis
                  </div>
                  <div className="text-lg font-bold text-gray-900 dark:text-white tnum leading-tight mt-0.5">
                    {num(c.imoveis)}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                    <CalendarCheck className="w-3.5 h-3.5" />
                    Visitas
                  </div>
                  <div className="text-lg font-bold text-gray-900 dark:text-white tnum leading-tight mt-0.5">
                    {num(c.visitas_futuras)}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                    <Users className="w-3.5 h-3.5" />
                    Leads
                  </div>
                  <div className="text-lg font-bold text-gray-900 dark:text-white tnum leading-tight mt-0.5">
                    {num(c.leads)}
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500 mb-1">
                  Disponibilidade
                </p>
                {agenda ? (
                  <p className="text-xs text-gray-600 dark:text-gray-400 tnum">
                    {agenda.join(' · ')}
                  </p>
                ) : (
                  /* Sem agenda o check_broker_availability não devolve horário
                     nenhum, e o agente não consegue marcar visita para esse
                     corretor — vale avisar em vez de mostrar espaço vazio. */
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Sem agenda cadastrada — o agente não consegue marcar visitas com este corretor.
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {corretores.length === 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">Nenhum corretor cadastrado.</p>
        </div>
      )}
    </div>
  )
}

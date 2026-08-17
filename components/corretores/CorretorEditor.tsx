'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus, X } from 'lucide-react'
import type { CorretorLinha } from '@/lib/queries/admin'

/* Editor da ficha do corretor: contato, áreas de atuação e agenda semanal.
 *
 * A agenda é o que o agente de agendamento usa para prometer horário a
 * cliente. Por isso a tela é explícita — um dia por linha, início/fim e
 * almoço — em vez de um texto livre "seg-sex 9-18". A validação real está em
 * lib/corretores/salvar.ts; aqui só se evita mandar o óbvio errado. */

const DIAS = [
  { weekday: 1, rotulo: 'Segunda' },
  { weekday: 2, rotulo: 'Terça' },
  { weekday: 3, rotulo: 'Quarta' },
  { weekday: 4, rotulo: 'Quinta' },
  { weekday: 5, rotulo: 'Sexta' },
  { weekday: 6, rotulo: 'Sábado' },
  { weekday: 0, rotulo: 'Domingo' },
]

const ESPECIALIDADES = [
  { valor: 'residencial', rotulo: 'Residencial' },
  { valor: 'investimento', rotulo: 'Investimento' },
  { valor: 'comercial', rotulo: 'Comercial' },
  { valor: 'geral', rotulo: 'Geral' },
]

interface DiaForm {
  atende: boolean
  inicio: string
  fim: string
  almocoInicio: string
  almocoFim: string
}

interface Form {
  name: string
  email: string
  phone: string
  specialty: string
  is_active: boolean
  regioes: string[]
  dias: Record<number, DiaForm>
}

const INPUT =
  'w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30 disabled:opacity-60'
const HORA = `${INPUT} px-2 tnum`
const ROTULO = 'block text-[11px] text-gray-500 dark:text-gray-400 mb-1'

function hhmm(valor: string | null | undefined): string {
  return valor ? valor.slice(0, 5) : ''
}

function montarForm(c: CorretorLinha): Form {
  const dias: Record<number, DiaForm> = {}
  for (const d of DIAS) {
    const linha = c.agenda.find((a) => a.weekday === d.weekday)
    dias[d.weekday] = linha
      ? {
          atende: true,
          inicio: hhmm(linha.start_time),
          fim: hhmm(linha.end_time),
          almocoInicio: hhmm(linha.break_start),
          almocoFim: hhmm(linha.break_end),
        }
      : { atende: false, inicio: '09:00', fim: '18:00', almocoInicio: '12:00', almocoFim: '13:00' }
  }
  return {
    name: c.name,
    email: c.email ?? '',
    phone: c.phone ?? '',
    specialty: c.specialty ?? '',
    is_active: c.is_active,
    regioes: c.region_focus ?? [],
    dias,
  }
}

export function CorretorEditor({
  corretor,
  regioesSugeridas,
  podeAtivar,
}: {
  corretor: CorretorLinha
  regioesSugeridas: string[]
  /** Só quem gere o time ativa/desativa; o próprio corretor edita o resto. */
  podeAtivar: boolean
}) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [form, setForm] = useState<Form>(() => montarForm(corretor))
  const [novaRegiao, setNovaRegiao] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  function abrir() {
    setForm(montarForm(corretor))
    setNovaRegiao('')
    setErro(null)
    setAberto(true)
  }

  function editarDia(weekday: number, mudanca: Partial<DiaForm>) {
    setForm((f) => ({ ...f, dias: { ...f.dias, [weekday]: { ...f.dias[weekday], ...mudanca } } }))
  }

  /* "Copiar segunda para os dias úteis" poupa quatro edições iguais — que é o
     caso normal. */
  function copiarSegundaParaSemana() {
    const seg = form.dias[1]
    setForm((f) => {
      const dias = { ...f.dias }
      for (const w of [2, 3, 4, 5]) dias[w] = { ...seg }
      return { ...f, dias }
    })
  }

  function adicionarRegiao(texto: string) {
    const limpa = texto.replace(/\s+/g, ' ').trim()
    if (!limpa) return
    setForm((f) =>
      f.regioes.some((r) => r.toLowerCase() === limpa.toLowerCase())
        ? f
        : { ...f, regioes: [...f.regioes, limpa] }
    )
    setNovaRegiao('')
  }

  async function salvar() {
    setErro(null)
    setOcupado(true)

    const agenda = DIAS.filter((d) => form.dias[d.weekday].atende).map((d) => {
      const dia = form.dias[d.weekday]
      return {
        weekday: d.weekday,
        start_time: dia.inicio,
        end_time: dia.fim,
        break_start: dia.almocoInicio || null,
        break_end: dia.almocoFim || null,
      }
    })

    const r = await fetch(`/api/admin/corretores/${corretor.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        email: form.email,
        phone: form.phone,
        specialty: form.specialty || null,
        ...(podeAtivar ? { is_active: form.is_active } : {}),
        region_focus: form.regioes,
        agenda,
      }),
    })
    setOcupado(false)

    if (!r.ok) {
      const corpo = await r.json().catch(() => ({}))
      return setErro(corpo.erro ?? 'Não foi possível salvar.')
    }
    setAberto(false)
    router.refresh()
  }

  const sugestoesRestantes = regioesSugeridas.filter(
    (s) => !form.regioes.some((r) => r.toLowerCase() === s.toLowerCase())
  )

  return (
    <>
      <button
        onClick={abrir}
        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        <Pencil className="w-3 h-3" />
        Editar
      </button>

      {aberto && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 w-full max-w-2xl my-8">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-800">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{corretor.name}</h3>
              <button onClick={() => setAberto(false)} aria-label="Fechar">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* ---- Contato ---- */}
              <section>
                <h4 className="text-xs font-semibold text-gray-800 dark:text-gray-200 mb-2">Contato</h4>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">
                  Nome e telefone vão para o cliente na confirmação da visita — é com quem ele vai falar no dia.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={ROTULO}>Nome</label>
                    <input className={INPUT} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </div>
                  <div>
                    <label className={ROTULO}>Especialidade</label>
                    <select className={INPUT} value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })}>
                      <option value="">Sem especialidade</option>
                      {ESPECIALIDADES.map((e) => (
                        <option key={e.valor} value={e.valor}>
                          {e.rotulo}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={ROTULO}>WhatsApp / telefone</label>
                    <input className={INPUT} placeholder="11 99999-9999" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  </div>
                  <div>
                    <label className={ROTULO}>E-mail</label>
                    <input className={INPUT} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </div>
                </div>
                {podeAtivar && (
                  <label className="mt-3 flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                    <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                    Ativo — recebe visitas e leads
                  </label>
                )}
              </section>

              {/* ---- Áreas ---- */}
              <section>
                <h4 className="text-xs font-semibold text-gray-800 dark:text-gray-200 mb-2">Áreas de atuação</h4>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">
                  Bairros que este corretor atende. Visita a imóvel de um desses bairros pode cair com ele, mesmo que
                  o imóvel seja de outro corretor.
                </p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {form.regioes.map((r) => (
                    <span
                      key={r}
                      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                    >
                      {r}
                      <button
                        onClick={() => setForm({ ...form, regioes: form.regioes.filter((x) => x !== r) })}
                        aria-label={`Remover ${r}`}
                        className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                  {form.regioes.length === 0 && (
                    <span className="text-[11px] text-gray-400">Nenhum bairro — só recebe visitas dos próprios imóveis.</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    className={INPUT}
                    list={`regioes-${corretor.id}`}
                    placeholder="Digite um bairro e Enter"
                    value={novaRegiao}
                    onChange={(e) => setNovaRegiao(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault()
                        adicionarRegiao(novaRegiao)
                      }
                    }}
                  />
                  <datalist id={`regioes-${corretor.id}`}>
                    {sugestoesRestantes.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                  <button
                    onClick={() => adicionarRegiao(novaRegiao)}
                    className="inline-flex items-center gap-1 text-xs px-3 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                {sugestoesRestantes.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {sugestoesRestantes.slice(0, 12).map((s) => (
                      <button
                        key={s}
                        onClick={() => adicionarRegiao(s)}
                        className="text-[11px] px-2 py-0.5 rounded-md border border-dashed border-gray-300 dark:border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                      >
                        + {s}
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {/* ---- Agenda ---- */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-gray-800 dark:text-gray-200">Agenda semanal</h4>
                  <button
                    onClick={copiarSegundaParaSemana}
                    className="text-[11px] text-rose-600 dark:text-rose-400 hover:underline"
                  >
                    Copiar segunda para ter–sex
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">
                  Visitas são de 1h, na hora cheia (9h, 10h…). O almoço fica fora da agenda. Horário de São Paulo.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[11px] text-gray-400 dark:text-gray-500">
                        <th className="text-left font-medium pb-1.5 pr-2">Dia</th>
                        <th className="text-left font-medium pb-1.5 pr-2">Início</th>
                        <th className="text-left font-medium pb-1.5 pr-2">Fim</th>
                        <th className="text-left font-medium pb-1.5 pr-2">Almoço de</th>
                        <th className="text-left font-medium pb-1.5">até</th>
                      </tr>
                    </thead>
                    <tbody>
                      {DIAS.map((d) => {
                        const dia = form.dias[d.weekday]
                        return (
                          <tr key={d.weekday} className="border-t border-gray-100 dark:border-gray-800">
                            <td className="py-1.5 pr-2 whitespace-nowrap">
                              <label className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                                <input
                                  type="checkbox"
                                  checked={dia.atende}
                                  onChange={(e) => editarDia(d.weekday, { atende: e.target.checked })}
                                />
                                {d.rotulo}
                              </label>
                            </td>
                            <td className="py-1.5 pr-2">
                              <input type="time" step={1800} className={HORA} disabled={!dia.atende} value={dia.inicio} onChange={(e) => editarDia(d.weekday, { inicio: e.target.value })} />
                            </td>
                            <td className="py-1.5 pr-2">
                              <input type="time" step={1800} className={HORA} disabled={!dia.atende} value={dia.fim} onChange={(e) => editarDia(d.weekday, { fim: e.target.value })} />
                            </td>
                            <td className="py-1.5 pr-2">
                              <input type="time" step={1800} className={HORA} disabled={!dia.atende} value={dia.almocoInicio} onChange={(e) => editarDia(d.weekday, { almocoInicio: e.target.value })} />
                            </td>
                            <td className="py-1.5">
                              <input type="time" step={1800} className={HORA} disabled={!dia.atende} value={dia.almocoFim} onChange={(e) => editarDia(d.weekday, { almocoFim: e.target.value })} />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-2">
                  Sem almoço? Deixe os dois campos vazios. Dia desmarcado não recebe visita.
                </p>
              </section>

              {erro && <p className="text-xs text-red-600 dark:text-red-400">{erro}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setAberto(false)}
                  disabled={ocupado}
                  className="text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Cancelar
                </button>
                <button
                  onClick={salvar}
                  disabled={ocupado}
                  className="text-xs px-3 py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60"
                >
                  {ocupado ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

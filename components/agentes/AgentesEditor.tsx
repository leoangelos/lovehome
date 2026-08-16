'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bot, RotateCcw, Save } from 'lucide-react'
import { dataHora } from '@/lib/utils/format'
import { MODELOS_DISPONIVEIS, capacidadesDoModelo } from '@/lib/ui/rotulos'
import type { AgenteNaTela } from '@/lib/agents/salvar-config'

export function AgentesEditor({
  agentes,
  podeEditar,
}: {
  agentes: AgenteNaTela[]
  podeEditar: boolean
}) {
  const router = useRouter()
  const [aberto, setAberto] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<Record<string, Partial<AgenteNaTela>>>({})
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  function valor<K extends keyof AgenteNaTela>(a: AgenteNaTela, campo: K): AgenteNaTela[K] {
    return (rascunho[a.key]?.[campo] ?? a[campo]) as AgenteNaTela[K]
  }

  function editar(key: string, campo: keyof AgenteNaTela, v: unknown) {
    setRascunho((r) => ({ ...r, [key]: { ...r[key], [campo]: v } }))
  }

  function sujo(a: AgenteNaTela): boolean {
    const r = rascunho[a.key]
    if (!r) return false
    return (
      (r.system_prompt !== undefined && r.system_prompt !== a.system_prompt) ||
      (r.model !== undefined && r.model !== a.model) ||
      (r.temperature !== undefined && r.temperature !== a.temperature) ||
      (r.wa_display_name !== undefined && r.wa_display_name !== a.wa_display_name)
    )
  }

  async function salvar(a: AgenteNaTela) {
    setErro(null)
    setAviso(null)
    setOcupado(a.key)

    const r = await fetch(`/api/admin/agentes/${a.key}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_prompt: valor(a, 'system_prompt'),
        model: valor(a, 'model'),
        temperature: Number(valor(a, 'temperature')),
        wa_display_name: valor(a, 'wa_display_name') || null,
      }),
    })
    setOcupado(null)

    if (!r.ok) {
      const corpo = await r.json().catch(() => ({}))
      return setErro(corpo.erro ?? 'Não foi possível salvar.')
    }

    setRascunho((x) => {
      const copia = { ...x }
      delete copia[a.key]
      return copia
    })
    /* A janela de cache é real e invisível: quem edita e testa em seguida
       precisa saber por que a conversa ainda respondeu do jeito antigo. */
    setAviso(`${a.nome} salvo. Conversas já em andamento podem levar até 5 minutos para pegar a versão nova.`)
    router.refresh()
  }

  async function restaurar(a: AgenteNaTela) {
    if (!confirm(`Restaurar o prompt padrão de ${a.nome}? A versão editada será apagada.`)) return

    setErro(null)
    setOcupado(a.key)
    const r = await fetch(`/api/admin/agentes/${a.key}`, { method: 'DELETE' })
    setOcupado(null)

    if (!r.ok) {
      const corpo = await r.json().catch(() => ({}))
      return setErro(corpo.erro ?? 'Não foi possível restaurar.')
    }
    setRascunho((x) => {
      const copia = { ...x }
      delete copia[a.key]
      return copia
    })
    setAviso(`${a.nome} voltou ao prompt do código.`)
    router.refresh()
  }

  return (
    <div className="space-y-3">
      {erro && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-4 py-2.5">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 rounded-lg px-4 py-2.5">
          {aviso}
        </p>
      )}

      {agentes.map((a) => {
        const expandido = aberto === a.key
        return (
          <section
            key={a.key}
            className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setAberto(expandido ? null : a.key)}
              className="w-full flex items-start justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-800 dark:text-gray-200 flex items-center gap-2">
                  <Bot className="w-3.5 h-3.5 text-gray-400" />
                  {a.nome}
                  {/* Sem isto, quem abre a tela não sabe se está lendo o que roda
                      hoje ou o padrão que veio do código. */}
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      a.personalizado
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                    }`}
                  >
                    {a.personalizado ? 'personalizado' : 'padrão do código'}
                  </span>
                </p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                  {a.descricao}
                </p>
                <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-0.5 tnum">
                  {a.model} · temperatura {Number(a.temperature).toFixed(2)}
                  {a.atualizado_em && ` · editado ${dataHora(a.atualizado_em)}`}
                </p>
              </div>
              <span className="text-[11px] text-gray-400 flex-shrink-0">
                {expandido ? 'fechar' : 'abrir'}
              </span>
            </button>

            {expandido && (
              <div className="px-4 pb-4 space-y-3 border-t border-gray-100 dark:border-gray-800 pt-3">
                <div>
                  <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                    Prompt do sistema
                  </label>
                  <textarea
                    value={valor(a, 'system_prompt') as string}
                    onChange={(e) => editar(a.key, 'system_prompt', e.target.value)}
                    disabled={!podeEditar}
                    rows={16}
                    spellCheck={false}
                    className="w-full px-3 py-2 text-[11px] font-mono leading-relaxed rounded-lg bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-rose-500/30 disabled:opacity-60"
                  />
                  <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-1 tnum">
                    {(valor(a, 'system_prompt') as string).length} caracteres
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                      Modelo
                    </label>
                    <select
                      value={valor(a, 'model') as string}
                      onChange={(e) => editar(a.key, 'model', e.target.value)}
                      disabled={!podeEditar}
                      className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-rose-500/30 disabled:opacity-60"
                    >
                      {MODELOS_DISPONIVEIS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.rotulo}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                      Temperatura
                    </label>
                    {/* Travada onde o modelo não aceita: a OpenAI responde 400 a
                        `temperature` diferente de 1 em gpt-5 e nos de raciocínio.
                        Deixar o campo editável seria oferecer um ajuste que
                        derruba o atendimento na próxima mensagem de um cliente. */}
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      max="2"
                      value={
                        capacidadesDoModelo(valor(a, 'model') as string).aceitaTemperatura
                          ? (valor(a, 'temperature') as number)
                          : 1
                      }
                      onChange={(e) => editar(a.key, 'temperature', Number(e.target.value))}
                      disabled={
                        !podeEditar || !capacidadesDoModelo(valor(a, 'model') as string).aceitaTemperatura
                      }
                      className="w-full px-3 py-2 text-xs tnum rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-rose-500/30 disabled:opacity-60"
                    />
                    <p className="text-[10px] text-gray-400 mt-1 leading-snug">
                      {capacidadesDoModelo(valor(a, 'model') as string).nota}
                    </p>
                  </div>

                  <div>
                    <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                      Nome no WhatsApp
                    </label>
                    <input
                      value={(valor(a, 'wa_display_name') as string) ?? ''}
                      onChange={(e) => editar(a.key, 'wa_display_name', e.target.value)}
                      disabled={!podeEditar}
                      placeholder="opcional"
                      className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30 disabled:opacity-60"
                    />
                  </div>
                </div>

                {podeEditar && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={ocupado === a.key || !sujo(a)}
                      onClick={() => salvar(a)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[11px] font-medium bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white"
                    >
                      <Save className="w-3 h-3" />
                      Salvar
                    </button>

                    {a.personalizado && (
                      <button
                        type="button"
                        disabled={ocupado === a.key}
                        onClick={() => restaurar(a)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Restaurar padrão
                      </button>
                    )}

                    {sujo(a) && (
                      <span className="text-[10px] text-amber-600 dark:text-amber-400">
                        alterações não salvas
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

'use client'

import { Check } from 'lucide-react'
import {
  campoVisivel,
  type CampoFormulario,
} from '@/lib/registrations/campos-formato'

/* Perguntas configuradas no painel (PRD 6.5). Renderiza o que a imobiliaria
   acrescentou ao formulario padrao — nunca substitui os campos do cadastro,
   que sustentam o gate da secao 6.3.

   Campo restrito a papel so aparece depois que a pessoa marca o papel: por
   isso esta secao vem DEPOIS de "o que voce quer fazer". */

const campoClasse =
  'w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30'

const rotuloClasse = 'block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5'

export function CamposExtras({
  campos,
  papeisMarcados,
  valores,
  aoMudar,
}: {
  campos: CampoFormulario[]
  papeisMarcados: string[]
  valores: Record<string, unknown>
  aoMudar: (chave: string, valor: unknown) => void
}) {
  const visiveis = campos.filter((c) => c.is_active && campoVisivel(c, papeisMarcados))
  if (visiveis.length === 0) return null

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Mais um pouco</h2>

      {visiveis.map((campo) => {
        const valor = valores[campo.chave]
        const id = `extra-${campo.chave}`

        return (
          <div key={campo.id}>
            <label className={rotuloClasse} htmlFor={id}>
              {campo.rotulo}
              {!campo.obrigatorio && <span className="text-gray-400"> (opcional)</span>}
            </label>

            {campo.tipo === 'texto_longo' && (
              <textarea
                id={id}
                rows={3}
                value={String(valor ?? '')}
                onChange={(e) => aoMudar(campo.chave, e.target.value)}
                className={campoClasse}
                required={campo.obrigatorio}
              />
            )}

            {campo.tipo === 'numero' && (
              <input
                id={id}
                inputMode="decimal"
                value={String(valor ?? '')}
                onChange={(e) => aoMudar(campo.chave, e.target.value.replace(/[^\d.,]/g, ''))}
                className={campoClasse}
                required={campo.obrigatorio}
              />
            )}

            {campo.tipo === 'data' && (
              <input
                id={id}
                type="date"
                value={String(valor ?? '')}
                onChange={(e) => aoMudar(campo.chave, e.target.value)}
                className={campoClasse}
                required={campo.obrigatorio}
              />
            )}

            {campo.tipo === 'escolha' && (
              <select
                id={id}
                value={String(valor ?? '')}
                onChange={(e) => aoMudar(campo.chave, e.target.value)}
                className={campoClasse}
                required={campo.obrigatorio}
              >
                <option value="">Selecione…</option>
                {campo.opcoes.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            )}

            {campo.tipo === 'multipla' && (
              <div className="flex flex-wrap gap-2">
                {campo.opcoes.map((o) => {
                  const lista = Array.isArray(valor) ? (valor as string[]) : []
                  const marcado = lista.includes(o)
                  return (
                    <button
                      key={o}
                      type="button"
                      aria-pressed={marcado}
                      onClick={() =>
                        aoMudar(
                          campo.chave,
                          marcado ? lista.filter((x) => x !== o) : [...lista, o]
                        )
                      }
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                        marcado
                          ? 'border-rose-400 dark:border-rose-600 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300'
                          : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-700'
                      }`}
                    >
                      {marcado && <Check className="w-3 h-3" />}
                      {o}
                    </button>
                  )
                })}
              </div>
            )}

            {campo.tipo === 'sim_nao' && (
              <div className="flex gap-2">
                {[
                  { rotulo: 'Sim', v: true },
                  { rotulo: 'Não', v: false },
                ].map((op) => (
                  <button
                    key={op.rotulo}
                    type="button"
                    aria-pressed={valor === op.v}
                    onClick={() => aoMudar(campo.chave, op.v)}
                    className={`px-4 py-1.5 rounded-lg border text-xs transition-colors ${
                      valor === op.v
                        ? 'border-rose-400 dark:border-rose-600 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300'
                        : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-700'
                    }`}
                  >
                    {op.rotulo}
                  </button>
                ))}
              </div>
            )}

            {campo.tipo === 'texto' && (
              <input
                id={id}
                value={String(valor ?? '')}
                onChange={(e) => aoMudar(campo.chave, e.target.value)}
                className={campoClasse}
                required={campo.obrigatorio}
              />
            )}

            {campo.ajuda && (
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{campo.ajuda}</p>
            )}
          </div>
        )
      })}
    </section>
  )
}

'use client'

import { useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import {
  TIPOS,
  TIPOS_COM_OPCOES,
  sugerirChave,
  validarDefinicao,
  type CampoFormulario,
  type TipoCampo,
} from '@/lib/registrations/campos-formato'

/* Campos configuráveis do formulário público (PRD 6.5).
 *
 * O que esta tela deliberadamente NÃO faz: mexer em CPF, nome, e-mail,
 * endereço e papel. Esses cinco são o que define `registration_status =
 * 'completo'` no gate da §6.3 — se a tela pudesse desligá-los, o portão diria
 * "completo" sobre um cadastro que não sustenta contrato nem cobrança. Eles
 * aparecem aqui listados e travados, para quem configura entender o limite em
 * vez de procurar o botão que não existe. */

const CAMPOS_FIXOS = [
  'CPF',
  'Nome completo',
  'E-mail',
  'Data de nascimento',
  'Endereço completo',
  'O que você quer fazer (papéis)',
]

const PAPEIS_DISPONIVEIS = [
  { valor: 'interessado', rotulo: 'Procurando imóvel' },
  { valor: 'proprietario', rotulo: 'Tem imóvel para ofertar' },
]

const campoClasse =
  'w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30'
const rotuloClasse = 'block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5'

interface Rascunho {
  id?: string
  chave: string
  rotulo: string
  ajuda: string
  tipo: TipoCampo
  opcoes: string[]
  obrigatorio: boolean
  papeis: string[]
  is_active: boolean
  /** Trava a sugestão automática assim que a chave já tem resposta gravada. */
  chaveTravada: boolean
}

function vazio(): Rascunho {
  return {
    chave: '',
    rotulo: '',
    ajuda: '',
    tipo: 'texto',
    opcoes: [],
    obrigatorio: false,
    papeis: [],
    is_active: true,
    chaveTravada: false,
  }
}

function deCampo(c: CampoFormulario, respostas: number): Rascunho {
  return {
    id: c.id,
    chave: c.chave,
    rotulo: c.rotulo,
    ajuda: c.ajuda ?? '',
    tipo: c.tipo,
    opcoes: c.opcoes,
    obrigatorio: c.obrigatorio,
    papeis: c.papeis,
    is_active: c.is_active,
    chaveTravada: respostas > 0,
  }
}

export function CamposEditor({
  campos,
  respostas,
  podeEditar,
}: {
  campos: CampoFormulario[]
  /** Quantos cadastros já responderam cada chave. */
  respostas: Record<string, number>
  podeEditar: boolean
}) {
  const [lista, setLista] = useState(campos)
  const [editando, setEditando] = useState<Rascunho | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  async function chamar(url: string, metodo: string, corpo?: unknown) {
    const r = await fetch(url, {
      method: metodo,
      headers: { 'Content-Type': 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined,
    })
    const dados = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(dados.erro ?? 'Não foi possível concluir.')
    return dados
  }

  async function salvar() {
    if (!editando) return
    setErro(null)

    const problemas = validarDefinicao(editando)
    if (problemas.length) return setErro(problemas[0].mensagem)

    setSalvando(true)
    try {
      await chamar('/api/admin/formularios/campos', 'POST', {
        id: editando.id,
        chave: editando.chave,
        rotulo: editando.rotulo,
        ajuda: editando.ajuda,
        tipo: editando.tipo,
        opcoes: editando.opcoes,
        obrigatorio: editando.obrigatorio,
        papeis: editando.papeis,
        is_active: editando.is_active,
      })
      window.location.reload()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  async function alternarAtivo(campo: CampoFormulario) {
    setErro(null)
    try {
      await chamar('/api/admin/formularios/campos', 'POST', {
        id: campo.id,
        chave: campo.chave,
        rotulo: campo.rotulo,
        ajuda: campo.ajuda,
        tipo: campo.tipo,
        opcoes: campo.opcoes,
        obrigatorio: campo.obrigatorio,
        papeis: campo.papeis,
        is_active: !campo.is_active,
      })
      setLista((a) =>
        a.map((c) => (c.id === campo.id ? { ...c, is_active: !c.is_active } : c))
      )
    } catch (e) {
      setErro((e as Error).message)
    }
  }

  async function remover(campo: CampoFormulario) {
    setErro(null)
    setAviso(null)
    try {
      await chamar(`/api/admin/formularios/campos/${campo.id}`, 'DELETE')
      setLista((a) => a.filter((c) => c.id !== campo.id))
    } catch (e) {
      /* A recusa por "já tem resposta" não é falha: é a alternativa certa
         sendo oferecida. Vem em amarelo, não em vermelho. */
      setAviso((e as Error).message)
    }
  }

  async function mover(indice: number, direcao: -1 | 1) {
    const destino = indice + direcao
    if (destino < 0 || destino >= lista.length) return
    const nova = [...lista]
    ;[nova[indice], nova[destino]] = [nova[destino], nova[indice]]
    setLista(nova)
    try {
      await chamar('/api/admin/formularios/campos', 'PATCH', { ids: nova.map((c) => c.id) })
    } catch (e) {
      setErro((e as Error).message)
      setLista(lista)
    }
  }

  const obrigatorios = lista.filter((c) => c.is_active && c.obrigatorio).length

  return (
    <div className="space-y-4">
      {/* ---- O que não é configurável ---- */}
      <section className="bg-gray-50 dark:bg-gray-900/50 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
        <h2 className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
          <Lock className="w-3 h-3" />
          Sempre perguntados
        </h2>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
          São o que define um cadastro completo. Sem eles o sistema não libera visita, reserva
          nem contrato — por isso não podem ser desligados aqui.
        </p>
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {CAMPOS_FIXOS.map((c) => (
            <span
              key={c}
              className="px-2 py-1 rounded-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-[11px] text-gray-500 dark:text-gray-400"
            >
              {c}
            </span>
          ))}
        </div>
      </section>

      {erro && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-4 py-2.5">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 rounded-lg px-4 py-2.5 flex items-start justify-between gap-3">
          <span>{aviso}</span>
          <button onClick={() => setAviso(null)} aria-label="Fechar">
            <X className="w-3.5 h-3.5 flex-shrink-0" />
          </button>
        </p>
      )}

      {/* ---- Perguntas próprias ---- */}
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              Suas perguntas
            </h2>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              {lista.length === 0
                ? 'Nenhuma ainda — o formulário mostra só os campos padrão'
                : `${lista.filter((c) => c.is_active).length} ativa(s)${
                    obrigatorios > 0 ? `, ${obrigatorios} obrigatória(s)` : ''
                  }`}
            </p>
          </div>
          {podeEditar && (
            <button
              onClick={() => {
                setEditando(vazio())
                setErro(null)
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Nova pergunta
            </button>
          )}
        </div>

        {lista.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-gray-400 dark:text-gray-500">
            Acrescente aqui o que a sua operação precisa saber além do cadastro básico.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {lista.map((campo, indice) => {
              const tipo = TIPOS.find((t) => t.valor === campo.tipo)
              const usos = respostas[campo.chave] ?? 0
              return (
                <li key={campo.id} className="px-4 py-3 flex items-start gap-3">
                  {podeEditar && (
                    <div className="flex flex-col gap-0.5 pt-0.5">
                      <button
                        onClick={() => mover(indice, -1)}
                        disabled={indice === 0}
                        aria-label="Subir"
                        className="text-gray-300 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => mover(indice, 1)}
                        disabled={indice === lista.length - 1}
                        aria-label="Descer"
                        className="text-gray-300 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-sm font-medium truncate ${
                        campo.is_active
                          ? 'text-gray-800 dark:text-gray-200'
                          : 'text-gray-400 dark:text-gray-600 line-through'
                      }`}
                    >
                      {campo.rotulo}
                    </p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 flex flex-wrap gap-x-2">
                      <span className="font-mono">{campo.chave}</span>
                      <span>· {tipo?.rotulo}</span>
                      {campo.obrigatorio && <span className="text-rose-500">· obrigatória</span>}
                      {campo.papeis.length > 0 && (
                        <span>
                          · só para{' '}
                          {campo.papeis
                            .map((p) => PAPEIS_DISPONIVEIS.find((x) => x.valor === p)?.rotulo ?? p)
                            .join(' / ')}
                        </span>
                      )}
                      {usos > 0 && <span>· {usos} resposta(s)</span>}
                    </p>
                  </div>

                  {podeEditar && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => alternarAtivo(campo)}
                        title={campo.is_active ? 'Parar de perguntar' : 'Voltar a perguntar'}
                        className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        {campo.is_active ? (
                          <Eye className="w-3.5 h-3.5" />
                        ) : (
                          <EyeOff className="w-3.5 h-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => setEditando(deCampo(campo, usos))}
                        className="px-2 py-1 rounded-md text-[11px] text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => remover(campo)}
                        title="Apagar"
                        className="p-1.5 rounded-md text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* ---- Editor ---- */}
      {editando && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 w-full max-w-lg my-8">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-800">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                {editando.id ? 'Editar pergunta' : 'Nova pergunta'}
              </h3>
              <button onClick={() => setEditando(null)} aria-label="Fechar">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className={rotuloClasse} htmlFor="rotulo">
                  A pergunta, como o cliente vai ler
                </label>
                <input
                  id="rotulo"
                  value={editando.rotulo}
                  onChange={(e) =>
                    setEditando((a) =>
                      a
                        ? {
                            ...a,
                            rotulo: e.target.value,
                            /* Só sugere a chave enquanto ela não foi tocada e
                               não há resposta gravada: mudar a chave depois
                               orfanaria o que já foi respondido. */
                            chave:
                              a.id || a.chaveTravada ? a.chave : sugerirChave(e.target.value),
                          }
                        : a
                    )
                  }
                  placeholder="Qual a sua renda mensal aproximada?"
                  className={campoClasse}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={rotuloClasse} htmlFor="chave">
                    Identificador
                  </label>
                  <input
                    id="chave"
                    value={editando.chave}
                    disabled={editando.chaveTravada}
                    onChange={(e) =>
                      setEditando((a) => (a ? { ...a, chave: e.target.value.toLowerCase() } : a))
                    }
                    className={`${campoClasse} font-mono disabled:opacity-60`}
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    {editando.chaveTravada
                      ? 'Travado: já há respostas gravadas com esta chave.'
                      : 'Como a resposta fica guardada.'}
                  </p>
                </div>

                <div>
                  <label className={rotuloClasse} htmlFor="tipo">
                    Tipo de resposta
                  </label>
                  <select
                    id="tipo"
                    value={editando.tipo}
                    onChange={(e) =>
                      setEditando((a) => (a ? { ...a, tipo: e.target.value as TipoCampo } : a))
                    }
                    className={campoClasse}
                  >
                    {TIPOS.map((t) => (
                      <option key={t.valor} value={t.valor}>
                        {t.rotulo} — {t.descricao}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {TIPOS_COM_OPCOES.includes(editando.tipo) && (
                <div>
                  <label className={rotuloClasse} htmlFor="opcoes">
                    Opções, uma por linha
                  </label>
                  <textarea
                    id="opcoes"
                    rows={4}
                    value={editando.opcoes.join('\n')}
                    onChange={(e) =>
                      setEditando((a) => (a ? { ...a, opcoes: e.target.value.split('\n') } : a))
                    }
                    placeholder={'Até R$ 3.000\nDe R$ 3.000 a R$ 6.000\nAcima de R$ 6.000'}
                    className={campoClasse}
                  />
                </div>
              )}

              <div>
                <label className={rotuloClasse} htmlFor="ajuda">
                  Texto de apoio <span className="text-gray-400">(opcional)</span>
                </label>
                <input
                  id="ajuda"
                  value={editando.ajuda}
                  onChange={(e) => setEditando((a) => (a ? { ...a, ajuda: e.target.value } : a))}
                  className={campoClasse}
                />
              </div>

              <div>
                <span className={rotuloClasse}>Mostrar só para</span>
                <div className="flex flex-wrap gap-2">
                  {PAPEIS_DISPONIVEIS.map((p) => {
                    const marcado = editando.papeis.includes(p.valor)
                    return (
                      <button
                        key={p.valor}
                        type="button"
                        aria-pressed={marcado}
                        onClick={() =>
                          setEditando((a) =>
                            a
                              ? {
                                  ...a,
                                  papeis: marcado
                                    ? a.papeis.filter((x) => x !== p.valor)
                                    : [...a.papeis, p.valor],
                                }
                              : a
                          )
                        }
                        className={`px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                          marcado
                            ? 'border-rose-400 dark:border-rose-600 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300'
                            : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400'
                        }`}
                      >
                        {p.rotulo}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[10px] text-gray-400 mt-1">
                  Nenhum marcado = pergunta para todo mundo. Quem não vê a pergunta também não é
                  cobrado por ela.
                </p>
              </div>

              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                <input
                  type="checkbox"
                  checked={editando.obrigatorio}
                  onChange={(e) =>
                    setEditando((a) => (a ? { ...a, obrigatorio: e.target.checked } : a))
                  }
                  className="rounded border-gray-300 text-rose-600 focus:ring-rose-500/30"
                />
                Obrigatória — o cadastro não é enviado sem ela
              </label>

              {erro && (
                <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-3 py-2">
                  {erro}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-3 border-t border-gray-100 dark:border-gray-800">
              <button
                onClick={() => setEditando(null)}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Cancelar
              </button>
              <button
                onClick={salvar}
                disabled={salvando}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-xs font-medium"
              >
                {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

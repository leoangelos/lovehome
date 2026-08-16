'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, Eye, FileSignature, Plus, Save, Trash2 } from 'lucide-react'
import { dataHora } from '@/lib/utils/format'
import { PLACEHOLDERS, analisarTemplate, previewComExemplos } from '@/lib/leasing/placeholders'
import type { TemplateContrato, DealType } from '@/lib/leasing/templates'

const ROTULO_TIPO: Record<DealType, string> = { locacao: 'Locação', venda: 'Venda' }

export function TemplatesEditor({
  templates,
  podeEditar,
}: {
  templates: TemplateContrato[]
  podeEditar: boolean
}) {
  const router = useRouter()
  const [aberto, setAberto] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<Record<string, { name: string; body: string }>>({})
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [previa, setPrevia] = useState<string | null>(null)
  const [novoTipo, setNovoTipo] = useState<DealType | null>(null)

  function valores(t: TemplateContrato) {
    return rascunho[t.id] ?? { name: t.name, body: t.body_template }
  }

  function editar(id: string, campo: 'name' | 'body', v: string) {
    const base = templates.find((t) => t.id === id)!
    setRascunho((r) => ({
      ...r,
      [id]: { ...(r[id] ?? { name: base.name, body: base.body_template }), [campo]: v },
    }))
  }

  function sujo(t: TemplateContrato) {
    const v = rascunho[t.id]
    return Boolean(v && (v.name !== t.name || v.body !== t.body_template))
  }

  async function salvar(t: TemplateContrato) {
    const v = valores(t)
    setErro(null)
    setAviso(null)
    setOcupado(t.id)

    const r = await fetch('/api/admin/contratos/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: t.id,
        deal_type: t.deal_type,
        name: v.name,
        body_template: v.body,
        is_active: t.is_active,
      }),
    })
    const corpo = await r.json().catch(() => ({}))
    setOcupado(null)

    if (!r.ok) return setErro(corpo.erro ?? 'Não foi possível salvar.')

    setRascunho((x) => {
      const c = { ...x }
      delete c[t.id]
      return c
    })
    setAviso('Modelo salvo. Contratos gerados a partir de agora usam a versão nova.')
    router.refresh()
  }

  async function criar(tipo: DealType) {
    const base = templates.find((t) => t.deal_type === tipo)
    setErro(null)
    setOcupado('novo')

    const r = await fetch('/api/admin/contratos/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deal_type: tipo,
        name: `${ROTULO_TIPO[tipo]} — cópia`,
        /* Nasce como cópia do que já existe: template em branco daria a alguém
           uma página vazia onde deveria haver um contrato. */
        body_template: base?.body_template ?? '',
        is_active: false,
      }),
    })
    const corpo = await r.json().catch(() => ({}))
    setOcupado(null)
    setNovoTipo(null)

    if (!r.ok) return setErro(corpo.erro ?? 'Não foi possível criar.')
    router.refresh()
  }

  async function acao(id: string, metodo: 'PATCH' | 'DELETE', confirmacao?: string) {
    if (confirmacao && !confirm(confirmacao)) return
    setErro(null)
    setOcupado(id)
    const r = await fetch(`/api/admin/contratos/templates/${id}`, { method: metodo })
    const corpo = await r.json().catch(() => ({}))
    setOcupado(null)
    if (!r.ok) return setErro(corpo.erro ?? 'Não foi possível.')
    router.refresh()
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

      {/* ---- Campos disponíveis ---- */}
      <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
        <h2 className="text-xs font-semibold text-gray-800 dark:text-gray-200 mb-1">
          Campos disponíveis
        </h2>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">
          {/* A lista existe para não se escrever um campo que o sistema não sabe
              preencher — ele sairia literal no PDF. Salvar recusa se acontecer. */}
          Escreva entre chaves duplas. Só estes são reconhecidos: qualquer outro é recusado ao
          salvar, porque sairia literal dentro do contrato.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PLACEHOLDERS.map((p) => (
            <span
              key={p.chave}
              title={`${p.rotulo} — ex: ${p.exemplo}`}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                p.onde === 'locacao'
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  : p.onde === 'venda'
                    ? 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
              }`}
            >
              {`{{${p.chave}}}`}
            </span>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-2">
          Cinza vale nos dois · azul só em locação · roxo só em venda
        </p>
      </section>

      {(['locacao', 'venda'] as DealType[]).map((tipo) => {
        const doTipo = templates.filter((t) => t.deal_type === tipo)
        return (
          <section key={tipo} className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                {ROTULO_TIPO[tipo]} ({doTipo.length})
              </h2>
              {podeEditar && (
                <button
                  type="button"
                  disabled={ocupado === 'novo'}
                  onClick={() => setNovoTipo(novoTipo === tipo ? null : tipo)}
                  className="inline-flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400 hover:underline"
                >
                  <Plus className="w-3 h-3" />
                  novo modelo
                </button>
              )}
            </div>

            {novoTipo === tipo && (
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between gap-3">
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  O novo modelo nasce como cópia do atual, desativado. Ative quando estiver pronto.
                </p>
                <button
                  type="button"
                  onClick={() => criar(tipo)}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-rose-600 hover:bg-rose-700 text-white flex-shrink-0"
                >
                  Criar cópia
                </button>
              </div>
            )}

            {doTipo.map((t) => {
              const v = valores(t)
              const analise = analisarTemplate(v.body, t.deal_type)
              const expandido = aberto === t.id

              return (
                <div
                  key={t.id}
                  className={`bg-white dark:bg-gray-900 rounded-xl border overflow-hidden ${
                    t.is_active
                      ? 'border-emerald-300 dark:border-emerald-800'
                      : 'border-gray-200 dark:border-gray-800'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setAberto(expandido ? null : t.id)}
                    className="w-full flex items-start justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-800 dark:text-gray-200 flex items-center gap-2">
                        <FileSignature className="w-3.5 h-3.5 text-gray-400" />
                        {v.name}
                        {t.is_active && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                            em uso
                          </span>
                        )}
                      </p>
                      <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-0.5 tnum">
                        {v.body.length} caracteres · {analise.usados.length} campo(s) ·{' '}
                        {dataHora(t.created_at)}
                      </p>
                      {(analise.faltando.length > 0 || analise.foraDeContexto.length > 0) && (
                        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 inline-flex items-center gap-1">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          {analise.faltando.length > 0 &&
                            `faltam ${analise.faltando.length} campo(s) essencial(is)`}
                          {analise.faltando.length > 0 && analise.foraDeContexto.length > 0 && ' · '}
                          {analise.foraDeContexto.length > 0 &&
                            `${analise.foraDeContexto.length} campo(s) de outro tipo`}
                        </p>
                      )}
                    </div>
                    <span className="text-[11px] text-gray-400 flex-shrink-0">
                      {expandido ? 'fechar' : 'abrir'}
                    </span>
                  </button>

                  {expandido && (
                    <div className="px-4 pb-4 space-y-3 border-t border-gray-100 dark:border-gray-800 pt-3">
                      <div>
                        <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                          Nome do modelo
                        </label>
                        <input
                          value={v.name}
                          onChange={(e) => editar(t.id, 'name', e.target.value)}
                          disabled={!podeEditar}
                          className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-rose-500/30 disabled:opacity-60"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                          Texto do contrato
                        </label>
                        <textarea
                          value={v.body}
                          onChange={(e) => editar(t.id, 'body', e.target.value)}
                          disabled={!podeEditar}
                          rows={20}
                          spellCheck={false}
                          className="w-full px-3 py-2 text-[11px] font-mono leading-relaxed rounded-lg bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-rose-500/30 disabled:opacity-60"
                        />
                      </div>

                      {analise.desconhecidos.length > 0 && (
                        <p className="text-[11px] text-red-600 dark:text-red-400">
                          Campo não reconhecido:{' '}
                          <span className="font-mono">
                            {analise.desconhecidos.map((c) => `{{${c}}}`).join(', ')}
                          </span>{' '}
                          — sairia literal no PDF. Salvar vai recusar.
                        </p>
                      )}
                      {analise.faltando.length > 0 && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400">
                          {/* Aviso, não bloqueio: cláusula omitida às vezes é
                              escolha do jurídico. */}
                          Sem estes campos essenciais:{' '}
                          <span className="font-mono">
                            {analise.faltando.map((c) => `{{${c}}}`).join(', ')}
                          </span>
                        </p>
                      )}
                      {analise.foraDeContexto.length > 0 && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400">
                          Campos de outro tipo de contrato:{' '}
                          <span className="font-mono">
                            {analise.foraDeContexto.map((c) => `{{${c}}}`).join(', ')}
                          </span>
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        {podeEditar && (
                          <button
                            type="button"
                            disabled={ocupado === t.id || !sujo(t)}
                            onClick={() => salvar(t)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[11px] font-medium bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white"
                          >
                            <Save className="w-3 h-3" />
                            Salvar
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setPrevia(previewComExemplos(v.body))}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
                        >
                          <Eye className="w-3 h-3" />
                          Ver preenchido
                        </button>

                        {podeEditar && !t.is_active && (
                          <button
                            type="button"
                            disabled={ocupado === t.id}
                            onClick={() =>
                              acao(t.id, 'PATCH', `Passar a usar "${v.name}" nos próximos contratos?`)
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                          >
                            <Check className="w-3 h-3" />
                            Usar este
                          </button>
                        )}

                        {podeEditar && (
                          <button
                            type="button"
                            disabled={ocupado === t.id}
                            onClick={() =>
                              acao(t.id, 'DELETE', `Remover "${v.name}"? Não dá para desfazer.`)
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] text-gray-500 dark:text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                          >
                            <Trash2 className="w-3 h-3" />
                            Remover
                          </button>
                        )}

                        {sujo(t) && (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400">
                            alterações não salvas
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        )
      })}

      {/* ---- Prévia ---- */}
      {previa !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setPrevia(null)}
        >
          <div
            className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 max-w-3xl w-full max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                Prévia com dados de exemplo
              </h3>
              <button
                type="button"
                onClick={() => setPrevia(null)}
                className="text-[11px] text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                fechar
              </button>
            </div>
            <pre className="flex-1 overflow-y-auto p-4 text-[11px] leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap font-sans">
              {previa}
            </pre>
            <p className="px-4 py-2 text-[10px] text-gray-400 dark:text-gray-600 border-t border-gray-200 dark:border-gray-800">
              {/* Deixa claro que é exemplo: alguém poderia confundir com o
                  contrato de um cliente real. */}
              Valores de exemplo, não de um contrato real. O PDF final usa os dados do negócio.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

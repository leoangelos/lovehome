'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, Trash2, Upload } from 'lucide-react'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { dataHora } from '@/lib/utils/format'
import { CATEGORIAS, ROTULO_CATEGORIA, type CategoriaMaterial } from '@/lib/ui/rotulos'
import type { MaterialLinha } from '@/lib/rag/indexar'

function tamanho(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function MateriaisPainel({
  materiais,
  podeEditar,
}: {
  materiais: MaterialLinha[]
  podeEditar: boolean
}) {
  const router = useRouter()
  const [titulo, setTitulo] = useState('')
  const [categoria, setCategoria] = useState<CategoriaMaterial>('geral')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState<string | null>(null)
  const [removendo, setRemovendo] = useState<string | null>(null)
  const campoArquivo = useRef<HTMLInputElement>(null)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!arquivo || !titulo.trim() || enviando) return

    setErro(null)
    setSucesso(null)
    setEnviando(true)

    const form = new FormData()
    form.append('arquivo', arquivo)
    form.append('titulo', titulo.trim())
    form.append('categoria', categoria)

    try {
      const r = await fetch('/api/rag/upload', { method: 'POST', body: form })
      const corpo = await r.json()

      if (!r.ok) {
        setErro(corpo.erro ?? 'Não foi possível indexar o material.')
      } else {
        setSucesso(`"${titulo.trim()}" indexado em ${corpo.trechos} trecho(s).`)
        setTitulo('')
        setArquivo(null)
        // Limpa o input: sem isto ele continua exibindo o nome do arquivo já enviado.
        if (campoArquivo.current) campoArquivo.current.value = ''
      }
      router.refresh()
    } catch {
      setErro('Falha de conexão.')
    } finally {
      setEnviando(false)
    }
  }

  async function remover(id: string, nome: string) {
    if (!confirm(`Remover "${nome}"? O agente para de citar este material.`)) return
    setRemovendo(id)
    setErro(null)

    const r = await fetch(`/api/rag/documents/${id}`, { method: 'DELETE' })
    setRemovendo(null)

    if (!r.ok) {
      const corpo = await r.json().catch(() => ({}))
      return setErro(corpo.erro ?? 'Não foi possível remover.')
    }
    router.refresh()
  }

  return (
    <div className="space-y-5">
      {podeEditar && (
        <form
          onSubmit={enviar}
          className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <div>
              <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                Título
              </label>
              <input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Ex: Condições de financiamento 2026"
                className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30"
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                Categoria
              </label>
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value as CategoriaMaterial)}
                className="w-full px-3 py-2 text-xs rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-rose-500/30"
              >
                {CATEGORIAS.map((c) => (
                  <option key={c} value={c}>
                    {ROTULO_CATEGORIA[c]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
                Arquivo — PDF, TXT ou Markdown, até 20 MB
              </label>
              <input
                ref={campoArquivo}
                type="file"
                accept=".pdf,.txt,.md,.markdown"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
                className="w-full text-xs text-gray-500 dark:text-gray-400 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:text-[11px] file:font-medium file:bg-gray-100 dark:file:bg-gray-800 file:text-gray-600 dark:file:text-gray-300"
              />
            </div>
            <button
              type="submit"
              disabled={!arquivo || !titulo.trim() || enviando}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[11px] font-medium bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white"
            >
              <Upload className="w-3 h-3" />
              {enviando ? 'Indexando...' : 'Enviar e indexar'}
            </button>
          </div>

          <p className="text-[10px] text-gray-400 dark:text-gray-600">
            {/* Expectativa explícita: a indexação é síncrona e um PDF longo demora. */}
            A indexação acontece no envio — um PDF longo pode levar alguns segundos. PDF escaneado
            (imagem) não tem texto para extrair e será recusado.
          </p>
        </form>
      )}

      {erro && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-4 py-2.5">
          {erro}
        </p>
      )}
      {sucesso && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900/50 rounded-lg px-4 py-2.5">
          {sucesso}
        </p>
      )}

      {materiais.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
          <BookOpen className="w-8 h-8 text-gray-300 dark:text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Nenhum material indexado.</p>
          <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">
            Sem material, o agente diz que vai confirmar com um corretor em vez de responder.
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {materiais.map((m) => (
            <div key={m.id} className="px-4 py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-800 dark:text-gray-200">{m.title}</p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                  {ROTULO_CATEGORIA[m.categoria] ?? m.categoria}
                  {m.file_name && ` · ${m.file_name}`}
                  {m.file_size ? ` · ${tamanho(m.file_size)}` : ''}
                  {m.status === 'indexado' && ` · ${m.chunk_count} trecho(s)`} ·{' '}
                  {dataHora(m.created_at)}
                </p>
                {m.error_message && (
                  <p className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">
                    {m.error_message}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <StatusBadge status={m.status} />
                {podeEditar && (
                  <button
                    type="button"
                    disabled={removendo === m.id}
                    onClick={() => remover(m.id, m.title)}
                    className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                    aria-label="Remover"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

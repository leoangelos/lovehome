'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Paperclip } from 'lucide-react'
import { ROTULO_DOCUMENTO } from '@/lib/ui/rotulos'

/* Anexar documento pelo painel: o cliente mandou por e-mail ou entregou em
   mãos, e o agente não deve ficar pedindo pelo WhatsApp o que a equipe já tem.
   "Já conferi" entra direto como aprovado — quem anexou olhou o arquivo. */

const TIPOS = ['rg_cnh', 'comprovante_renda', 'comprovante_residencia', 'escritura_imovel', 'outro'] as const

const INPUT =
  'px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300'

export function AnexarDocumento({ dealId, sugeridos }: { dealId: string; sugeridos: string[] }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [tipo, setTipo] = useState<string>(sugeridos[0] ?? 'rg_cnh')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [conferido, setConferido] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!arquivo) return setErro('Escolha o arquivo.')
    setErro(null)
    setOcupado(true)

    const corpo = new FormData()
    corpo.set('arquivo', arquivo)
    corpo.set('tipo', tipo)
    corpo.set('conferido', conferido ? '1' : '0')

    const r = await fetch(`/api/admin/deals/${dealId}/documentos`, { method: 'POST', body: corpo })
    const resposta = await r.json().catch(() => ({}))
    setOcupado(false)
    if (!r.ok) return setErro(resposta.erro ?? 'Não foi possível anexar.')

    setAberto(false)
    setArquivo(null)
    router.refresh()
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
      >
        <Paperclip className="w-3 h-3" />
        Anexar documento recebido por outro canal
      </button>
    )
  }

  return (
    <form onSubmit={enviar} className="mt-2 rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-2">
      <p className="text-[11px] text-gray-500 dark:text-gray-400">
        Para documento que chegou por e-mail ou em mãos. Anexado aqui, o agente não pede pelo WhatsApp.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select className={INPUT} value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {TIPOS.map((t) => (
            <option key={t} value={t}>
              {ROTULO_DOCUMENTO[t] ?? t}
            </option>
          ))}
        </select>
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
          className="text-[11px] text-gray-600 dark:text-gray-400 file:mr-2 file:px-2.5 file:py-1.5 file:rounded-lg file:border-0 file:text-[11px] file:bg-gray-100 dark:file:bg-gray-800 file:text-gray-700 dark:file:text-gray-300"
        />
      </div>
      <label className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-400">
        <input type="checkbox" checked={conferido} onChange={(e) => setConferido(e.target.checked)} />
        Já conferi este documento — marcar como aprovado
      </label>
      {erro && <p className="text-[11px] text-red-600 dark:text-red-400">{erro}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={ocupado} className="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white">
          {ocupado ? 'Anexando…' : 'Anexar'}
        </button>
        <button type="button" onClick={() => setAberto(false)} className="px-2 py-1.5 rounded-lg text-[11px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
          Cancelar
        </button>
      </div>
    </form>
  )
}

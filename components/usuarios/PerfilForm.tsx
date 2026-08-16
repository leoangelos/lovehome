'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2 } from 'lucide-react'

const campoClasse =
  'w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30'

function mascararTelefone(v: string) {
  const d = v.replace(/\D/g, '').replace(/^55/, '').slice(0, 11)
  if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3').replace(/-$/, '')
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3').replace(/-$/, '')
}

export function PerfilForm({
  nomeInicial,
  telefoneInicial,
}: {
  nomeInicial: string
  telefoneInicial: string
}) {
  const router = useRouter()
  const [nome, setNome] = useState(nomeInicial)
  const [telefone, setTelefone] = useState(mascararTelefone(telefoneInicial))
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [falha, setFalha] = useState<string | null>(null)

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setFalha(null)
    setSalvo(false)
    setSalvando(true)

    const r = await fetch('/api/admin/perfil', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: nome, phone: telefone }),
    })
    const corpo = await r.json()
    setSalvando(false)

    if (!r.ok) return setFalha(corpo.erro ?? 'Não foi possível salvar.')

    setSalvo(true)
    router.refresh()
    setTimeout(() => setSalvo(false), 2500)
  }

  return (
    <form
      onSubmit={salvar}
      className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4"
    >
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Seus dados</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5" htmlFor="nome">
            Nome completo
          </label>
          <input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} className={campoClasse} required />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5" htmlFor="tel">
            Telefone
          </label>
          <input
            id="tel"
            inputMode="numeric"
            value={telefone}
            onChange={(e) => setTelefone(mascararTelefone(e.target.value))}
            placeholder="(11) 98765-4321"
            className={campoClasse}
          />
        </div>
      </div>

      {falha && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-3 py-2">
          {falha}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={salvando}
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-xs font-medium transition-colors"
        >
          {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {salvando ? 'Salvando...' : 'Salvar'}
        </button>

        {salvo && (
          <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="w-3.5 h-3.5" />
            Salvo
          </span>
        )}
      </div>
    </form>
  )
}

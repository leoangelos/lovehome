'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, Loader2, UserPlus } from 'lucide-react'
import { DESCRICAO_PAPEL, PAPEIS, ROTULO_PAPEL, type Role } from '@/lib/auth/permissions'
import { dataHora } from '@/lib/utils/format'
import type { UsuarioLinha } from '@/lib/auth/convites'

const campoClasse =
  'w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30'

const COR_PAPEL: Record<Role, string> = {
  admin: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  corretor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  editor: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  viewer: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

export function UsuariosPainel({
  usuarios,
  meuId,
}: {
  usuarios: UsuarioLinha[]
  meuId: string
}) {
  const router = useRouter()
  const [abrindo, setAbrindo] = useState(false)
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [papel, setPapel] = useState<Role>('corretor')
  const [enviando, setEnviando] = useState(false)
  const [falha, setFalha] = useState<string | null>(null)
  const [linkGerado, setLinkGerado] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)

  async function convidar(e: React.FormEvent) {
    e.preventDefault()
    setFalha(null)
    setEnviando(true)

    const r = await fetch('/api/admin/usuarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: nome, email, role: papel }),
    })
    const corpo = await r.json()
    setEnviando(false)

    if (!r.ok) return setFalha(corpo.erro ?? 'Não foi possível convidar.')

    setLinkGerado(corpo.link)
    setNome('')
    setEmail('')
    router.refresh()
  }

  async function alterar(id: string, patch: { role?: Role; is_active?: boolean }) {
    setFalha(null)
    setOcupado(id)

    const r = await fetch('/api/admin/usuarios', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    })
    const corpo = await r.json()
    setOcupado(null)

    if (!r.ok) return setFalha(corpo.erro ?? 'Não foi possível alterar.')
    router.refresh()
  }

  async function copiar(link: string) {
    await navigator.clipboard.writeText(link)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {usuarios.filter((u) => u.is_active).length} ativo
          {usuarios.filter((u) => u.is_active).length === 1 ? '' : 's'} ·{' '}
          {usuarios.filter((u) => u.pendente && u.is_active).length} convite
          {usuarios.filter((u) => u.pendente && u.is_active).length === 1 ? '' : 's'} pendente
          {usuarios.filter((u) => u.pendente && u.is_active).length === 1 ? '' : 's'}
        </p>

        <button
          type="button"
          onClick={() => {
            setAbrindo((v) => !v)
            setLinkGerado(null)
          }}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-rose-600 hover:bg-rose-700 text-white transition-colors"
        >
          <UserPlus className="w-3.5 h-3.5" />
          Convidar
        </button>
      </div>

      {abrindo && (
        <form
          onSubmit={convidar}
          className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                Nome completo
              </label>
              <input value={nome} onChange={(e) => setNome(e.target.value)} className={campoClasse} required />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                E-mail
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={campoClasse}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
              Papel
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {PAPEIS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPapel(p)}
                  aria-pressed={papel === p}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    papel === p
                      ? 'border-rose-400 dark:border-rose-600 bg-rose-50 dark:bg-rose-900/20'
                      : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'
                  }`}
                >
                  <span className="text-xs font-medium text-gray-800 dark:text-gray-200">
                    {ROTULO_PAPEL[p]}
                  </span>
                  <span className="block text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                    {DESCRICAO_PAPEL[p]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {falha && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-3 py-2">
              {falha}
            </p>
          )}

          <button
            type="submit"
            disabled={enviando}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-xs font-medium transition-colors"
          >
            {enviando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {enviando ? 'Gerando convite...' : 'Enviar convite'}
          </button>
        </form>
      )}

      {linkGerado && (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-900/50 rounded-xl p-4">
          <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300">
            Convite criado.
          </p>
          {/* O link aparece aqui porque o envio por e-mail depende de SMTP
              configurado no projeto Supabase. Sem essa cópia manual, um projeto
              sem SMTP geraria convites que nunca chegam. */}
          <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-0.5 mb-2">
            O e-mail só sai se o SMTP estiver configurado no Supabase. Enquanto isso, mande este
            link para a pessoa:
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[11px] bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-900/50 rounded-lg px-3 py-2 text-gray-700 dark:text-gray-300 truncate">
              {linkGerado}
            </code>
            <button
              type="button"
              onClick={() => copiar(linkGerado)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors flex-shrink-0"
            >
              {copiado ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiado ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
      )}

      {falha && !abrindo && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-4 py-2.5">
          {falha}
        </p>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 text-left">
                <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Pessoa</th>
                <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">Papel</th>
                <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400">
                  Último acesso
                </th>
                <th className="px-4 py-2.5 font-medium text-gray-500 dark:text-gray-400 text-right">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {usuarios.map((u) => {
                const souEu = u.id === meuId
                return (
                  <tr
                    key={u.id}
                    className={`hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
                      u.is_active ? '' : 'opacity-50'
                    }`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="text-gray-800 dark:text-gray-200">
                        {u.full_name ?? '—'}
                        {souEu && (
                          <span className="ml-2 text-[11px] text-gray-400 dark:text-gray-500">
                            (você)
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-400 dark:text-gray-500">{u.email}</div>
                    </td>

                    <td className="px-4 py-2.5">
                      <select
                        value={u.role}
                        disabled={souEu || ocupado === u.id || !u.is_active}
                        onChange={(e) => alterar(u.id, { role: e.target.value as Role })}
                        className={`text-[11px] font-medium px-2 py-1 rounded-md border-0 disabled:cursor-not-allowed ${COR_PAPEL[u.role]}`}
                      >
                        {PAPEIS.map((p) => (
                          <option key={p} value={p}>
                            {ROTULO_PAPEL[p]}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 tnum whitespace-nowrap">
                      {u.pendente ? (
                        <span className="text-amber-600 dark:text-amber-400">
                          convite pendente
                        </span>
                      ) : (
                        dataHora(u.last_sign_in_at)
                      )}
                    </td>

                    <td className="px-4 py-2.5 text-right">
                      {!souEu && (
                        <button
                          type="button"
                          disabled={ocupado === u.id}
                          onClick={() => alterar(u.id, { is_active: !u.is_active })}
                          className="text-[11px] px-2 py-1 rounded-md text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
                        >
                          {ocupado === u.id ? '...' : u.is_active ? 'Desativar' : 'Reativar'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

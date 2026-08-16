'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const campoClasse =
  'w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30'

const MINIMO = 8

export function SenhaForm({
  destino,
  nomeAtual,
  pedirNome,
}: {
  destino: string
  nomeAtual: string | null
  pedirNome: boolean
}) {
  const [nome, setNome] = useState(nomeAtual ?? '')
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [falha, setFalha] = useState<string | null>(null)

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setFalha(null)

    if (senha.length < MINIMO) return setFalha(`A senha precisa ter ao menos ${MINIMO} caracteres.`)
    if (senha !== confirmacao) return setFalha('As senhas não conferem.')
    if (pedirNome && !nome.trim().includes(' ')) return setFalha('Informe seu nome completo.')

    setSalvando(true)
    const supabase = createClient()

    const { error } = await supabase.auth.updateUser({
      password: senha,
      ...(pedirNome ? { data: { full_name: nome.trim() } } : {}),
    })

    if (error) {
      setFalha(error.message)
      setSalvando(false)
      return
    }

    if (pedirNome) {
      /* O nome vai também para profiles: `data` do updateUser grava só no
         metadata do auth, e o painel inteiro lê profiles.full_name. */
      await fetch('/api/admin/perfil', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: nome.trim() }),
      })
    }

    // Mesmo motivo do LoginForm: a senha nova invalida a sessão anterior e
    // gera cookie novo. Load completo garante que o servidor já o enxergue.
    window.location.assign(destino)
  }

  return (
    <form
      onSubmit={salvar}
      className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4"
    >
      <div>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">
          {pedirNome ? 'Bem-vindo à LoveHome' : 'Definir nova senha'}
        </h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          {pedirNome
            ? 'Só falta criar sua senha para começar.'
            : 'Escolha uma senha nova para sua conta.'}
        </p>
      </div>

      {pedirNome && (
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5" htmlFor="nome">
            Nome completo
          </label>
          <input
            id="nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className={campoClasse}
            required
          />
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5" htmlFor="senha">
          Senha
        </label>
        <input
          id="senha"
          type="password"
          autoComplete="new-password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          className={campoClasse}
          required
        />
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
          Mínimo de {MINIMO} caracteres.
        </p>
      </div>

      <div>
        <label
          className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5"
          htmlFor="confirmacao"
        >
          Repita a senha
        </label>
        <input
          id="confirmacao"
          type="password"
          autoComplete="new-password"
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          className={campoClasse}
          required
        />
      </div>

      {falha && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-3 py-2">
          {falha}
        </p>
      )}

      <button
        type="submit"
        disabled={salvando}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-sm font-medium transition-colors"
      >
        {salvando && <Loader2 className="w-4 h-4 animate-spin" />}
        {salvando ? 'Salvando...' : 'Salvar e entrar'}
      </button>
    </form>
  )
}

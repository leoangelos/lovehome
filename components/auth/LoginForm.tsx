'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const campoClasse =
  'w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30'

const MENSAGEM_ERRO: Record<string, string> = {
  link_invalido: 'Esse link não é válido. Peça um novo convite ao administrador.',
  link_expirado: 'O link expirou ou já foi usado. Peça um novo ao administrador.',
  sem_acesso: 'Sua conta não tem acesso ao painel. Fale com um administrador.',
}

export function LoginForm({ proximo, erro }: { proximo: string; erro?: string }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [entrando, setEntrando] = useState(false)
  const [falha, setFalha] = useState<string | null>(erro ? MENSAGEM_ERRO[erro] ?? null : null)

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setFalha(null)
    setEntrando(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha })

    if (error) {
      /* Mensagem única para credencial errada, seja e-mail inexistente ou senha
         incorreta. Distinguir os dois casos entrega ao atacante quais e-mails
         têm conta no sistema. */
      setFalha('E-mail ou senha incorretos.')
      setEntrando(false)
      return
    }

    /* Navegação completa em vez de router.push: o cookie de sessão acabou de
       ser gravado e a navegação do App Router dispara a requisição RSC antes de
       ele estar disponível — o servidor vê um anônimo, o proxy manda de volta
       para o login e o destino se perde no meio do caminho. Um load inteiro
       garante que o cookie vai junto na primeira requisição. */
    window.location.assign(proximo)
  }

  return (
    <form
      onSubmit={entrar}
      className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4"
    >
      <div>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Entrar</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Acesso restrito à equipe da LoveHome.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5" htmlFor="email">
          E-mail
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={campoClasse}
          required
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5" htmlFor="senha">
          Senha
        </label>
        <input
          id="senha"
          type="password"
          autoComplete="current-password"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
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
        disabled={entrando}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-sm font-medium transition-colors"
      >
        {entrando && <Loader2 className="w-4 h-4 animate-spin" />}
        {entrando ? 'Entrando...' : 'Entrar'}
      </button>

      <Link
        href="/esqueci-senha"
        className="block text-center text-xs text-gray-500 dark:text-gray-400 hover:underline"
      >
        Esqueci minha senha
      </Link>

      <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center">
        Não tem acesso? O painel é por convite — peça a um administrador.
      </p>
    </form>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const campoClasse =
  'w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/30'

export function EsqueciSenhaForm() {
  const [email, setEmail] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [falha, setFalha] = useState<string | null>(null)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setFalha(null)
    setEnviando(true)

    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      /* Aponta para a nossa página de recuperação, não para a raiz.
         Sem isso o Supabase usa a Site URL do projeto, o link cai em `/` e o
         token — que viaja no fragmento da URL — nunca é consumido por ninguém. */
      redirectTo: `${window.location.origin}/recuperar`,
    })

    setEnviando(false)

    /* Sucesso mesmo quando o e-mail não existe. Dizer "esse e-mail não está
       cadastrado" entregaria a quem tenta adivinhar quais contas existem. */
    if (error && !/rate|limit/i.test(error.message)) {
      console.error('[esqueci-senha]', error.message)
    }
    if (error && /rate|limit/i.test(error.message)) {
      setFalha('Muitas tentativas seguidas. Espere um minuto e tente de novo.')
      return
    }

    setEnviado(true)
  }

  if (enviado) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
          <Check className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Link enviado</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
          Se houver uma conta com esse e-mail, o link de troca de senha chega em instantes. Ele vale
          por uma hora.
        </p>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-3">
          Não recebeu? Verifique o spam — e confirme com um administrador se o envio de e-mail já
          está configurado no projeto.
        </p>
        <Link
          href="/login"
          className="inline-block mt-4 text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline"
        >
          Voltar para o login
        </Link>
      </div>
    )
  }

  return (
    <form
      onSubmit={enviar}
      className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 space-y-4"
    >
      <div>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Esqueci minha senha</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Informe seu e-mail e mandamos um link para criar uma senha nova.
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

      {falha && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-3 py-2">
          {falha}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-sm font-medium transition-colors"
      >
        {enviando && <Loader2 className="w-4 h-4 animate-spin" />}
        {enviando ? 'Enviando...' : 'Enviar link'}
      </button>

      <Link
        href="/login"
        className="block text-center text-xs text-gray-500 dark:text-gray-400 hover:underline"
      >
        Voltar para o login
      </Link>
    </form>
  )
}

'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

/* Consome o token que o Supabase devolve no FRAGMENTO da URL
   (#access_token=...&type=recovery) e o transforma em sessão de verdade.
 *
 * Precisa ser client component: o que vem depois do `#` nunca é enviado ao
 * servidor. Era exatamente esse o furo — o link de recuperação chegava com o
 * token no fragmento, ninguém o lia, e a pessoa caía numa página qualquer
 * "logada" sem estar.
 *
 * Também aceita o formato de query (`?code=`), usado quando o projeto está em
 * fluxo PKCE, para não depender de qual dos dois o Supabase mandar. */

type Estado = 'processando' | 'erro'

export function RecuperarSessao({ destino }: { destino: string }) {
  const [estado, setEstado] = useState<Estado>('processando')
  const [mensagem, setMensagem] = useState<string>('')

  useEffect(() => {
    const supabase = createClient()

    async function consumir() {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const query = new URLSearchParams(window.location.search)

      const erroDescricao = hash.get('error_description') ?? query.get('error_description')
      if (erroDescricao) {
        setMensagem(decodeURIComponent(erroDescricao))
        setEstado('erro')
        return
      }

      const accessToken = hash.get('access_token')
      const refreshToken = hash.get('refresh_token')

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })
        if (error) {
          setMensagem('Não foi possível validar o link. Ele pode ter expirado ou já ter sido usado.')
          setEstado('erro')
          return
        }

        /* Limpa o fragmento antes de sair da página: token em URL fica no
           histórico do navegador e vaza em qualquer print ou link copiado. */
        window.history.replaceState(null, '', window.location.pathname)
        window.location.assign(destino)
        return
      }

      const code = query.get('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (error) {
          setMensagem('Não foi possível validar o link. Ele pode ter expirado ou já ter sido usado.')
          setEstado('erro')
          return
        }
        window.location.assign(destino)
        return
      }

      setMensagem('Este endereço não traz nenhum token de recuperação.')
      setEstado('erro')
    }

    consumir()
  }, [destino])

  if (estado === 'erro') {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 text-center">
        <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
        </div>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">Link não funcionou</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">{mensagem}</p>
        <Link
          href="/esqueci-senha"
          className="inline-block mt-4 text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline"
        >
          Pedir um link novo
        </Link>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
      <Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto mb-3" />
      <p className="text-sm text-gray-500 dark:text-gray-400">Validando seu link...</p>
    </div>
  )
}

import type { Metadata } from 'next'
import { AlertCircle } from 'lucide-react'
import { ListagemForm } from '@/components/imoveis/ListagemForm'
import { validarTokenListagem } from '@/lib/imoveis/listagem'

export const metadata: Metadata = {
  title: 'Cadastrar imóvel — LoveHome',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

const MENSAGENS = {
  inexistente: {
    titulo: 'Link inválido',
    texto: 'Esse endereço não corresponde a nenhum cadastro de imóvel. Confira o link da conversa.',
  },
  expirado: {
    titulo: 'Link expirado',
    texto: 'Esse link passou da validade. Peça um novo na conversa do WhatsApp.',
  },
  ja_preenchido: {
    titulo: 'Imóvel já enviado',
    texto: 'Esse imóvel já foi enviado para análise. Se quiser cadastrar outro, fale com a gente.',
  },
}

export default async function ListarImovelPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const resultado = await validarTokenListagem(token)

  if (!resultado.valido) {
    const m = MENSAGENS[resultado.motivo]
    return (
      <div className="max-w-md mx-auto">
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
          </div>
          <h1 className="text-base font-semibold text-gray-900 dark:text-white">{m.titulo}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">{m.texto}</p>
        </div>
      </div>
    )
  }

  const temRascunho = Object.keys(resultado.rascunho).length > 0

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Cadastrar seu imóvel</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {temRascunho
            ? 'Já preenchemos o que você contou na conversa. Confira, complete o que faltar e mande as fotos.'
            : 'Preencha os dados do imóvel e mande as fotos.'}
        </p>
      </div>

      {!resultado.temCadastro && (
        /* Publicar imóvel em nome de alguém exige identidade confirmada (PRD 6.3).
           O aviso aparece aqui porque o imóvel até entra para análise, mas fica
           travado na aprovação sem o cadastro — melhor dizer antes. */
        <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
          <p className="text-xs text-amber-800 dark:text-amber-300">
            Seu cadastro ainda não está completo. Pode enviar o imóvel normalmente, mas para
            publicá-lo vamos precisar do seu CPF — o link do cadastro está na conversa do WhatsApp.
          </p>
        </div>
      )}

      <ListagemForm token={token} rascunho={resultado.rascunho} />
    </div>
  )
}

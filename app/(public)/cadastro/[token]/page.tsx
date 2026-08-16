import type { Metadata } from 'next'
import { AlertCircle } from 'lucide-react'
import { RegistrationForm } from '@/components/cadastro/RegistrationForm'
import { validarToken } from '@/lib/registrations/form'

export const metadata: Metadata = {
  title: 'Cadastro — LoveHome',
  // Formulário com dado pessoal não deve ser indexado nem aparecer em busca.
  robots: { index: false, follow: false },
}

/* O token é a credencial: sem sessão, sem login. Por isso a página é sempre
   renderizada sob demanda — cachear significaria servir o estado de validade
   de um token para o acesso seguinte. */
export const dynamic = 'force-dynamic'

const MENSAGENS = {
  inexistente: {
    titulo: 'Link inválido',
    texto: 'Esse endereço não corresponde a nenhum cadastro. Confira o link enviado na conversa.',
  },
  expirado: {
    titulo: 'Link expirado',
    texto: 'Esse link passou da validade. Peça um novo na conversa do WhatsApp — leva um segundo.',
  },
  ja_preenchido: {
    titulo: 'Cadastro já preenchido',
    texto: 'Esse cadastro já foi concluído. Pode voltar para a conversa que a gente continua de lá.',
  },
}

export default async function CadastroPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const resultado = await validarToken(token)

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

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Complete seu cadastro</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Precisamos disso para confirmar visitas e cuidar da documentação. Leva dois minutos.
        </p>
      </div>

      <RegistrationForm
        token={token}
        nomeSugerido={resultado.nomeSugerido}
        campos={resultado.campos}
      />
    </div>
  )
}

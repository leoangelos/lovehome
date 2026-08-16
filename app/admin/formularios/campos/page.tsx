import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { CamposEditor } from '@/components/formularios/CamposEditor'
import { listarCampos, contarRespostas } from '@/lib/registrations/campos'
import { exigirAcesso } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissions'

export const metadata: Metadata = { title: 'Campos do formulário — LoveHome' }
export const dynamic = 'force-dynamic'

export default async function CamposPage() {
  /* 'formularios' + 'editar' é só admin na §9.2, e é o nível certo: decidir
     que dado pessoal a empresa passa a coletar de todo cliente é decisão de
     quem responde pela base, não de quem atende. */
  const sessao = await exigirAcesso('formularios')
  const campos = await listarCampos('cadastro')
  const respostas = await contarRespostas(campos)

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/admin/formularios"
          className="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400 hover:text-rose-600 dark:hover:text-rose-400 mb-2"
        >
          <ArrowLeft className="w-3 h-3" />
          Formulários
        </Link>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
          Campos do formulário
        </h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          O que o formulário público de cadastro pergunta, além dos dados obrigatórios
        </p>
      </div>

      <CamposEditor
        campos={campos}
        respostas={respostas}
        podeEditar={pode(sessao.role, 'formularios', 'editar')}
      />
    </div>
  )
}

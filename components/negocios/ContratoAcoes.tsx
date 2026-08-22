'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, FileSignature, Loader2, Upload } from 'lucide-react'
import type { NegocioLinha } from '@/lib/queries/negocios'

/* Ciclo do contrato na tela: gerar → baixar → registrar a via assinada → ativar.
   Cada passo só aparece quando o anterior aconteceu — a ordem é a da seção 15
   do PRD, e mostrar tudo de uma vez convidaria a pular etapa. */

const ROTULO_METODO: Record<string, string> = { manual: 'assinatura manual', govbr: 'gov.br' }
const ROTULO_CANAL: Record<string, string> = { whatsapp: 'WhatsApp', email: 'e-mail' }

export function ContratoAcoes({ negocio }: { negocio: NegocioLinha }) {
  const router = useRouter()
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [subindo, setSubindo] = useState(false)
  const [metodo, setMetodo] = useState<'manual' | 'govbr'>('govbr')
  const [canal, setCanal] = useState<'whatsapp' | 'email'>('whatsapp')
  const [arquivo, setArquivo] = useState<File | null>(null)

  /* Só faz sentido a partir de 'aprovado': antes disso o negócio ainda está
     sob revisão humana e nenhum contrato deveria existir. */
  const podeGerar = negocio.status === 'aprovado' || negocio.status === 'ativo'
  if (!podeGerar && !negocio.tem_contrato) return null

  async function gerar() {
    setErro(null)
    setAviso(null)
    setOcupado('gerar')

    const r = await fetch(`/api/admin/deals/${negocio.id}/contract`, { method: 'POST' })
    const corpo = await r.json()
    setOcupado(null)

    if (!r.ok) return setErro(corpo.erro ?? 'Não foi possível gerar.')

    /* Lacuna não impede gerar — o contrato sai com o campo marcado em maiúsculas
       para quem revisa enxergar. Esconder o aviso é que seria ruim. */
    if (corpo.lacunas?.length) {
      setAviso(
        `Contrato gerado com campos faltando: ${corpo.lacunas.join(', ')}. ` +
          'Preencha em "Condições do negócio" (ou no cadastro do cliente/imóvel) e gere novamente.'
      )
    }
    if (corpo.url) window.open(corpo.url, '_blank', 'noopener')
    router.refresh()
  }

  async function baixar(assinado: boolean) {
    setErro(null)
    setOcupado(assinado ? 'baixar-assinado' : 'baixar')

    const r = await fetch(`/api/admin/deals/${negocio.id}/contract?assinado=${assinado ? 1 : 0}`)
    const corpo = await r.json()
    setOcupado(null)

    if (!r.ok) return setErro(corpo.erro ?? 'Não foi possível abrir.')
    window.open(corpo.url, '_blank', 'noopener')
  }

  async function enviarAssinado(e: React.FormEvent) {
    e.preventDefault()
    if (!arquivo) return setErro('Escolha o PDF assinado.')

    setErro(null)
    setOcupado('assinado')

    const corpo = new FormData()
    corpo.set('arquivo', arquivo)
    corpo.set('signature_method', metodo)
    corpo.set('returned_via', canal)

    const r = await fetch(`/api/admin/deals/${negocio.id}/signed-document`, {
      method: 'POST',
      body: corpo,
    })
    const resposta = await r.json()
    setOcupado(null)

    if (!r.ok) return setErro(resposta.erro ?? 'Não foi possível registrar.')

    setSubindo(false)
    setArquivo(null)
    router.refresh()
  }

  async function ativar() {
    setErro(null)
    setOcupado('ativar')

    const r = await fetch(`/api/admin/deals/${negocio.id}/signed-document`, { method: 'PATCH' })
    const corpo = await r.json()
    setOcupado(null)

    if (!r.ok) return setErro(corpo.erro ?? 'Não foi possível ativar.')
    router.refresh()
  }

  const carregando = (chave: string) => ocupado === chave

  return (
    <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 space-y-3">
      {erro && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-3 py-2">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 rounded-lg px-3 py-2">
          {aviso}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {podeGerar && (
          <button
            type="button"
            disabled={carregando('gerar')}
            onClick={gerar}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white transition-colors"
          >
            {carregando('gerar') ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <FileSignature className="w-3 h-3" />
            )}
            {negocio.tem_contrato ? 'Gerar novamente' : 'Gerar contrato'}
          </button>
        )}

        {negocio.tem_contrato && (
          <button
            type="button"
            disabled={carregando('baixar')}
            onClick={() => baixar(false)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            <Download className="w-3 h-3" />
            Baixar contrato
          </button>
        )}

        {negocio.tem_assinado && (
          <button
            type="button"
            disabled={carregando('baixar-assinado')}
            onClick={() => baixar(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-50"
          >
            <Download className="w-3 h-3" />
            Baixar via assinada
          </button>
        )}

        {negocio.tem_contrato && !negocio.tem_assinado && !subindo && (
          <button
            type="button"
            onClick={() => setSubindo(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <Upload className="w-3 h-3" />
            Registrar via assinada
          </button>
        )}

        {negocio.tem_assinado && negocio.status === 'aprovado' && (
          <button
            type="button"
            disabled={carregando('ativar')}
            onClick={ativar}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white transition-colors"
          >
            {carregando('ativar') && <Loader2 className="w-3 h-3 animate-spin" />}
            {negocio.deal_type === 'locacao' ? 'Ativar locação' : 'Concluir venda'}
          </button>
        )}
      </div>

      {negocio.tem_assinado && negocio.signature_method && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500">
          Assinado por {ROTULO_METODO[negocio.signature_method]}, devolvido por{' '}
          {ROTULO_CANAL[negocio.signed_returned_via ?? 'whatsapp']}.
        </p>
      )}

      {subindo && (
        <form
          onSubmit={enviarAssinado}
          className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 space-y-3"
        >
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            O cliente assina por conta própria — manualmente ou pelo gov.br — e devolve o PDF.
            Suba o arquivo recebido aqui.
          </p>

          <div className="flex flex-wrap gap-3">
            <label className="text-[11px] text-gray-600 dark:text-gray-400">
              Como assinou
              <select
                value={metodo}
                onChange={(e) => setMetodo(e.target.value as 'manual' | 'govbr')}
                className="ml-2 px-2 py-1 rounded-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300"
              >
                <option value="govbr">gov.br</option>
                <option value="manual">Manual</option>
              </select>
            </label>

            <label className="text-[11px] text-gray-600 dark:text-gray-400">
              Voltou por
              <select
                value={canal}
                onChange={(e) => setCanal(e.target.value as 'whatsapp' | 'email')}
                className="ml-2 px-2 py-1 rounded-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-300"
              >
                <option value="whatsapp">WhatsApp</option>
                <option value="email">E-mail</option>
              </select>
            </label>
          </div>

          <input
            type="file"
            accept="application/pdf"
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            className="block w-full text-[11px] text-gray-600 dark:text-gray-400 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:text-[11px] file:bg-gray-100 dark:file:bg-gray-800 file:text-gray-700 dark:file:text-gray-300"
          />

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={carregando('assinado')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white"
            >
              {carregando('assinado') && <Loader2 className="w-3 h-3 animate-spin" />}
              Registrar
            </button>
            <button
              type="button"
              onClick={() => setSubindo(false)}
              className="px-2 py-1.5 rounded-lg text-[11px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

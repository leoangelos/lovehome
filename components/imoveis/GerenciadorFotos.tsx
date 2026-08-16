'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, ImagePlus, Star, Trash2 } from 'lucide-react'

/* Fotos do imóvel: enviar, reordenar, definir capa e remover.
 *
 * A CAPA É A PRIMEIRA DA LISTA — o card da vitrine e a imagem do Open Graph já
 * leem `photos[0]`. Por isso "definir como capa" é literalmente mover para o
 * começo, e não um sinalizador à parte que poderia divergir da ordem.
 *
 * Tudo é aplicado no servidor de uma vez, mandando o array inteiro: ordem,
 * capa e remoção saem da mesma operação. */

export function GerenciadorFotos({
  propertyId,
  fotosIniciais,
  podeEditar,
}: {
  propertyId: string
  fotosIniciais: string[]
  podeEditar: boolean
}) {
  const router = useRouter()
  const [fotos, setFotos] = useState<string[]>(fotosIniciais)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [arrastando, setArrastando] = useState<number | null>(null)
  const campoArquivo = useRef<HTMLInputElement>(null)

  async function salvarOrdem(novas: string[]) {
    const anteriores = fotos
    setFotos(novas) // otimista: sem isso o arraste parece não ter funcionado
    setErro(null)
    setOcupado(true)

    const r = await fetch(`/api/admin/properties/${propertyId}/fotos`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fotos: novas }),
    })
    setOcupado(false)

    if (!r.ok) {
      const corpo = await r.json().catch(() => ({}))
      setFotos(anteriores) // desfaz: deixar na ordem errada mentiria sobre o estado
      return setErro(corpo.erro ?? 'Não foi possível salvar.')
    }
    router.refresh()
  }

  function mover(de: number, para: number) {
    if (para < 0 || para >= fotos.length || de === para) return
    const novas = [...fotos]
    const [item] = novas.splice(de, 1)
    novas.splice(para, 0, item)
    salvarOrdem(novas)
  }

  async function enviar(lista: FileList | null) {
    if (!lista?.length) return
    setErro(null)
    setOcupado(true)

    const form = new FormData()
    for (const f of Array.from(lista)) form.append('fotos', f)

    const r = await fetch(`/api/admin/properties/${propertyId}/fotos`, {
      method: 'POST',
      body: form,
    })
    const corpo = await r.json().catch(() => ({}))
    setOcupado(false)
    if (campoArquivo.current) campoArquivo.current.value = ''

    if (!r.ok) return setErro(corpo.erro ?? 'Não foi possível enviar.')
    setFotos(corpo.fotos ?? [])
    router.refresh()
  }

  function remover(indice: number) {
    const ehCapa = indice === 0 && fotos.length > 1
    const aviso = ehCapa
      ? 'Remover a capa? A próxima foto passa a ser a capa na vitrine.'
      : 'Remover esta foto? O arquivo é apagado e não dá para desfazer.'
    if (!confirm(aviso)) return
    salvarOrdem(fotos.filter((_, i) => i !== indice))
  }

  return (
    <section className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xs font-semibold text-gray-800 dark:text-gray-200">
            Fotos ({fotos.length})
          </h2>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
            {/* Dizer o que a ordem significa evita a pergunta "qual é a capa?". */}
            A primeira é a capa — é ela que aparece na busca e ao compartilhar o link.
          </p>
        </div>

        {podeEditar && (
          <>
            <input
              ref={campoArquivo}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => enviar(e.target.files)}
              className="hidden"
            />
            <button
              type="button"
              disabled={ocupado}
              onClick={() => campoArquivo.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white"
            >
              <ImagePlus className="w-3 h-3" />
              {ocupado ? 'Enviando...' : 'Adicionar fotos'}
            </button>
          </>
        )}
      </div>

      {erro && (
        <p className="text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/50 rounded-lg px-3 py-2">
          {erro}
        </p>
      )}

      {fotos.length === 0 ? (
        <p className="text-[11px] text-gray-400 dark:text-gray-600 py-6 text-center">
          Nenhuma foto. Imóvel sem foto pode ser publicado, mas quase ninguém clica nele.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {fotos.map((url, i) => (
            <figure
              key={url}
              draggable={podeEditar}
              onDragStart={() => setArrastando(i)}
              onDragOver={(e) => {
                if (arrastando === null) return
                e.preventDefault()
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (arrastando !== null) mover(arrastando, i)
                setArrastando(null)
              }}
              onDragEnd={() => setArrastando(null)}
              className={`relative rounded-lg overflow-hidden border ${
                i === 0
                  ? 'border-rose-400 dark:border-rose-600 ring-1 ring-rose-400/40'
                  : 'border-gray-200 dark:border-gray-800'
              } ${arrastando === i ? 'opacity-40' : ''} ${podeEditar ? 'cursor-grab active:cursor-grabbing' : ''}`}
            >
              {/* next/image exigiria configurar o domínio do Supabase e não traz
                  ganho para miniatura em tela interna. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Foto ${i + 1}`} className="w-full h-28 object-cover block" />

              {i === 0 && (
                <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-medium">
                  <Star className="w-2.5 h-2.5" />
                  capa
                </span>
              )}

              {podeEditar && (
                <figcaption className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 px-1 py-1 bg-black/55">
                  {/* Setas além do arraste: HTML5 drag-and-drop não funciona em
                      toque, e é o teclado de quem usa leitor de tela. */}
                  <span className="flex items-center gap-0.5">
                    <button
                      type="button"
                      disabled={ocupado || i === 0}
                      onClick={() => mover(i, i - 1)}
                      title="Mover para a esquerda"
                      className="p-1 rounded text-white/90 hover:bg-white/20 disabled:opacity-30"
                    >
                      <ArrowLeft className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      disabled={ocupado || i === fotos.length - 1}
                      onClick={() => mover(i, i + 1)}
                      title="Mover para a direita"
                      className="p-1 rounded text-white/90 hover:bg-white/20 disabled:opacity-30"
                    >
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </span>

                  <span className="flex items-center gap-0.5">
                    {i !== 0 && (
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => mover(i, 0)}
                        title="Definir como capa"
                        className="p-1 rounded text-white/90 hover:bg-white/20 disabled:opacity-30"
                      >
                        <Star className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={() => remover(i)}
                      title="Remover"
                      className="p-1 rounded text-white/90 hover:bg-red-500/70 disabled:opacity-30"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </span>
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      )}
    </section>
  )
}

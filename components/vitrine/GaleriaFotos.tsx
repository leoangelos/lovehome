'use client'

import { useState } from 'react'
import Image from 'next/image'
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react'

/* Galeria da página do imóvel. Placeholder quando não há foto — a base atual
   (seed e imóveis vindos por chat) ainda não tem, e uma área vazia pareceria
   erro de carregamento. */

export function GaleriaFotos({ fotos, titulo }: { fotos: string[]; titulo: string }) {
  const [atual, setAtual] = useState(0)

  if (fotos.length === 0) {
    return (
      <div className="aspect-[16/10] rounded-xl bg-gradient-to-br from-rose-100 to-rose-200 dark:from-gray-800 dark:to-gray-700 flex flex-col items-center justify-center gap-2">
        <ImageOff className="w-8 h-8 text-rose-300 dark:text-gray-600" />
        <span className="text-xs text-rose-400 dark:text-gray-500">
          Fotos em breve — fale com a gente para conhecer
        </span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="relative aspect-[16/10] rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800">
        <Image
          src={fotos[atual]}
          alt={`${titulo} — foto ${atual + 1} de ${fotos.length}`}
          fill
          sizes="(max-width: 768px) 100vw, 800px"
          className="object-cover"
          priority={atual === 0}
        />

        {fotos.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => setAtual((i) => (i - 1 + fotos.length) % fotos.length)}
              aria-label="Foto anterior"
              className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/80 dark:bg-gray-900/80 text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-900 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setAtual((i) => (i + 1) % fotos.length)}
              aria-label="Próxima foto"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-white/80 dark:bg-gray-900/80 text-gray-700 dark:text-gray-200 hover:bg-white dark:hover:bg-gray-900 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/60 text-white text-[11px] tnum">
              {atual + 1}/{fotos.length}
            </span>
          </>
        )}
      </div>

      {fotos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {fotos.map((f, i) => (
            <button
              key={f}
              type="button"
              onClick={() => setAtual(i)}
              aria-label={`Ver foto ${i + 1}`}
              aria-current={i === atual}
              className={`relative w-20 h-14 rounded-lg overflow-hidden flex-shrink-0 border-2 transition-colors ${
                i === atual ? 'border-rose-500' : 'border-transparent hover:border-gray-300'
              }`}
            >
              <Image src={f} alt="" fill sizes="80px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

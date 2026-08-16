import type { Metadata } from 'next'
import { PropertyGrid } from '@/components/vitrine/PropertyGrid'
import { listarImoveisPublicos } from '@/lib/queries/properties'

export const metadata: Metadata = {
  title: 'Imóveis em São Paulo — LoveHome',
  description:
    'Apartamentos, casas e studios para comprar ou alugar em São Paulo com a LoveHome.',
}

/* Vitrine e pagina de SEO: vale servir do cache e revalidar de minuto em minuto,
   em vez de consultar o banco a cada visita. Um imovel aprovado leva ate 60s
   para aparecer, o que e aceitavel — a aprovacao ja e um processo humano. */
export const revalidate = 60

export default async function VitrinePage() {
  /* A query ja filtra status='disponivel': imovel em analise nao vai ao ar antes
     da aprovacao humana (PRD 10.4), e reservado/alugado/vendido saiu do mercado. */
  const disponiveis = await listarImoveisPublicos()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
          Imóveis disponíveis
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Encontrou algo? Fale com a gente pelo WhatsApp e agende uma visita.
        </p>
      </div>

      <PropertyGrid imoveis={disponiveis} />
    </div>
  )
}

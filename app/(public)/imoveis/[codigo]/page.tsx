import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Bath, BedDouble, Car, MapPin, Ruler } from 'lucide-react'
import { GaleriaFotos } from '@/components/vitrine/GaleriaFotos'
import { buscarImovelPublico, imoveisSemelhantes } from '@/lib/queries/imovel'
import { area, brl } from '@/lib/utils/format'
import { getConfiguracoes } from '@/lib/config/app'

/* Página do imóvel na vitrine (PRD 8 e 17.3).
   É a peça que faz o link circular: alguém recebe o código no WhatsApp e abre
   direto, sem precisar estar na conversa. */

export const revalidate = 60

/* Número do WhatsApp do atendimento. Sem ele o link abre o WhatsApp sem
   destinatário e a pessoa precisa escolher o contato na mão — funciona, mas
   perde a maior parte de quem clicou.
   Vem das Configurações do painel; a variável de ambiente é o fallback de
   quem já a tinha preenchida antes desta tela existir. */
async function numeroWhatsapp(): Promise<string> {
  const { whatsapp_numero } = await getConfiguracoes()
  return whatsapp_numero || process.env.NEXT_PUBLIC_WHATSAPP_NUMERO?.replace(/\D/g, '') || ''
}

function precoDe(imovel: { operation: string; price_cents: number | null; rent_price_cents: number | null }) {
  const aluguel = imovel.rent_price_cents
  const venda = imovel.price_cents
  if (imovel.operation === 'aluguel') return { valor: aluguel, sufixo: '/mês' }
  if (imovel.operation === 'venda') return { valor: venda, sufixo: '' }
  return venda ? { valor: venda, sufixo: '' } : { valor: aluguel, sufixo: '/mês' }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ codigo: string }>
}): Promise<Metadata> {
  const { codigo } = await params
  const resultado = await buscarImovelPublico(codigo)

  if (!resultado) return { title: 'Imóvel não encontrado — LoveHome' }

  const { imovel } = resultado
  const { valor } = precoDe(imovel)

  const descricao = [
    imovel.bedrooms ? `${imovel.bedrooms} dormitórios` : null,
    imovel.area_m2 ? area(imovel.area_m2) : null,
    imovel.region,
    valor ? brl(valor) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const fotos = (imovel.photos ?? []) as string[]

  return {
    title: `${imovel.title} — LoveHome`,
    description: descricao,
    // Compartilhamento por WhatsApp é o caso principal: sem estas tags o link
    // aparece como texto cru no chat, sem foto nem preço.
    openGraph: {
      title: imovel.title,
      description: descricao,
      type: 'website',
      images: fotos.length > 0 ? [{ url: fotos[0] }] : undefined,
    },
  }
}

export default async function ImovelPage({ params }: { params: Promise<{ codigo: string }> }) {
  const NUMERO_WHATSAPP = await numeroWhatsapp()
  const { codigo } = await params
  const resultado = await buscarImovelPublico(codigo)

  if (!resultado) notFound()

  const { imovel, disponivel } = resultado
  const { valor, sufixo } = precoDe(imovel)
  const fotos = (imovel.photos ?? []) as string[]
  const comodidades = (imovel.amenities ?? []) as string[]
  const semelhantes = disponivel ? await imoveisSemelhantes(imovel) : []

  const caracteristicas = [
    imovel.bedrooms != null && { icone: BedDouble, valor: `${imovel.bedrooms}`, rotulo: imovel.bedrooms === 1 ? 'dormitório' : 'dormitórios' },
    imovel.suites ? { icone: BedDouble, valor: `${imovel.suites}`, rotulo: imovel.suites === 1 ? 'suíte' : 'suítes' } : null,
    imovel.bathrooms != null && { icone: Bath, valor: `${imovel.bathrooms}`, rotulo: imovel.bathrooms === 1 ? 'banheiro' : 'banheiros' },
    imovel.parking_spots != null && { icone: Car, valor: `${imovel.parking_spots}`, rotulo: imovel.parking_spots === 1 ? 'vaga' : 'vagas' },
    imovel.area_m2 != null && { icone: Ruler, valor: area(imovel.area_m2), rotulo: 'de área' },
  ].filter(Boolean) as { icone: typeof BedDouble; valor: string; rotulo: string }[]

  return (
    <div className="space-y-6">
      <Link
        href="/imoveis"
        className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Voltar para os imóveis
      </Link>

      {!disponivel && (
        /* Link compartilhado continua abrindo, com a verdade na frente. Some
           404 seria pior: a pessoa acharia que errou o endereço. */
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
          <p className="text-xs text-amber-800 dark:text-amber-300">
            Este imóvel não está mais disponível. Dá uma olhada nos outros — ou fale com a gente que
            procuramos algo parecido.
          </p>
        </div>
      )}

      <GaleriaFotos fotos={fotos} titulo={imovel.title} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div>
            <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400 uppercase tracking-wide">
              {imovel.property_type} · {imovel.reference_code}
            </p>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white mt-1 leading-snug">
              {imovel.title}
            </h1>
            <p className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 mt-1.5">
              <MapPin className="w-3.5 h-3.5" />
              {imovel.region}, {imovel.city}
            </p>
          </div>

          {caracteristicas.length > 0 && (
            <div className="flex flex-wrap gap-x-6 gap-y-3 py-4 border-y border-gray-200 dark:border-gray-800">
              {caracteristicas.map((c, i) => {
                const Icone = c.icone
                return (
                  <div key={i} className="flex items-center gap-2">
                    <Icone className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-800 dark:text-gray-200 tnum">
                      <strong className="font-semibold">{c.valor}</strong>{' '}
                      <span className="text-gray-500 dark:text-gray-400">{c.rotulo}</span>
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {imovel.description && (
            <div>
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                Sobre o imóvel
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-line">
                {imovel.description}
              </p>
            </div>
          )}

          {comodidades.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                O que tem
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {comodidades.map((c) => (
                  <span
                    key={c}
                    className="text-xs px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="lg:sticky lg:top-20 h-fit">
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5">
            <p className="text-2xl font-bold text-gray-900 dark:text-white tnum leading-tight">
              {brl(valor)}
              {sufixo && (
                <span className="text-sm font-normal text-gray-400 dark:text-gray-500">{sufixo}</span>
              )}
            </p>

            {imovel.condo_fee_cents != null && (
              <p className="text-xs text-gray-500 dark:text-gray-400 tnum mt-1">
                condomínio {brl(imovel.condo_fee_cents)}
              </p>
            )}

            {/* Endereço completo fica fora da vitrine de propósito: é dado do
                proprietário, e quem quer conhecer passa pelo atendimento. */}
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-3">
              O endereço exato é informado no agendamento da visita.
            </p>

            {disponivel && (
              <a
                href={`https://wa.me/${NUMERO_WHATSAPP}?text=${encodeURIComponent(
                  `Olá! Tenho interesse no imóvel ${imovel.reference_code} — ${imovel.title}.`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full text-center mt-4 px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium transition-colors"
              >
                Falar sobre este imóvel
              </a>
            )}
          </div>
        </aside>
      </div>

      {semelhantes.length > 0 && (
        <section className="pt-4 border-t border-gray-200 dark:border-gray-800">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            Outros em {imovel.region}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {semelhantes.map((s) => {
              const p = precoDe(s)
              return (
                <Link
                  key={s.id}
                  href={`/imoveis/${s.reference_code}`}
                  className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 hover:border-rose-300 dark:hover:border-rose-700 transition-colors"
                >
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 tnum">
                    {s.reference_code}
                  </p>
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-200 mt-1 line-clamp-2">
                    {s.title}
                  </p>
                  <p className="text-sm font-bold text-gray-900 dark:text-white tnum mt-2">
                    {brl(p.valor)}
                    {p.sufixo && (
                      <span className="text-[11px] font-normal text-gray-400">{p.sufixo}</span>
                    )}
                  </p>
                </Link>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

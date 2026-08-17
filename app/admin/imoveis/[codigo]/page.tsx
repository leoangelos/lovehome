import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ImovelForm } from '@/components/imoveis/ImovelForm'
import { GerenciadorFotos } from '@/components/imoveis/GerenciadorFotos'
import { VisitasDoImovel } from '@/components/imoveis/VisitasDoImovel'
import { listarVisitas } from '@/lib/queries/admin'
import { exigirAcesso } from '@/lib/auth/session'
import { escopoProprio } from '@/lib/auth/permissions'
import { createAdminClient } from '@/lib/supabase/admin'
import { opcoesProprietarios } from '@/lib/queries/proprietarios'
import type { Property } from '@/lib/types/domain'

export const metadata: Metadata = { title: 'Editar imóvel — LoveHome' }
export const dynamic = 'force-dynamic'

const COLUNAS = `
  id, reference_code, title, operation, property_type,
  price_cents, rent_price_cents, condo_fee_cents,
  bedrooms, suites, bathrooms, parking_spots, area_m2,
  region, city, address, description, amenities, photos,
  status, owner_registration_id, broker_id, created_at
`

export default async function EditarImovelPage({
  params,
}: {
  params: Promise<{ codigo: string }>
}) {
  const sessao = await exigirAcesso('imoveis', 'editar')
  const { codigo } = await params

  const supabase = createAdminClient()

  const { data } = await supabase
    .from('properties')
    .select(COLUNAS)
    .ilike('reference_code', codigo.trim())
    .maybeSingle()

  if (!data) notFound()
  const imovel = data as unknown as Property

  /* Corretor só edita o que é dele — mesmo recorte da policy da §9.3, aplicado
     aqui porque o painel lê pelo service_role e a RLS não barra nada dentro. */
  if (escopoProprio(sessao.role) && imovel.broker_id !== sessao.brokerId) {
    notFound()
  }

  const [proprietarios, { data: corretores }, visitas] = await Promise.all([
    opcoesProprietarios(),
    supabase.from('brokers').select('id, name').eq('is_active', true).order('name'),
    /* Agenda do imóvel — TODAS as visitas dele, de qualquer corretor. O
       recorte por carteira já foi feito acima (o corretor só chega aqui se o
       imóvel é dele), e ver quem mais vai ao apartamento é justamente o ponto. */
    listarVisitas(null, imovel.id),
  ])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
          {imovel.reference_code}
        </h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{imovel.title}</p>
      </div>

      <ImovelForm imovel={imovel} proprietarios={proprietarios} corretores={corretores ?? []} />

      <VisitasDoImovel visitas={visitas} agora={new Date()} />

      {/* Fotos ficam FORA do formulário: elas salvam sozinhas, uma ação por vez.
          Dentro do form, arrastar uma foto ficaria pendente até alguém clicar em
          "Salvar" — e reordenar sem ver o efeito não funciona. */}
      <GerenciadorFotos
        propertyId={imovel.id}
        fotosIniciais={(imovel.photos ?? []) as string[]}
        podeEditar
      />
    </div>
  )
}

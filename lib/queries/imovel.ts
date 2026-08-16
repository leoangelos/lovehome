import { createAdminClient } from '@/lib/supabase/admin'
import type { Property } from '@/lib/types/domain'

/* Leitura de um imóvel para a vitrine pública.

   A chave da URL é o `reference_code` (LH-1001), não o UUID: é o código que o
   agente cita na conversa ("Código do imóvel é LH-1001"), então a pessoa pode
   literalmente digitá-lo. UUID em URL de vitrine também é ruim de compartilhar
   e de indexar. O UUID continua aceito para links antigos não quebrarem. */

const COLUNAS = `
  id, reference_code, title, operation, property_type,
  price_cents, rent_price_cents, condo_fee_cents,
  bedrooms, suites, bathrooms, parking_spots, area_m2,
  region, city, address, description, amenities, photos,
  status, owner_registration_id, broker_id, created_at
`

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ImovelPublico {
  imovel: Property
  /** false quando saiu do mercado — a página mostra aviso em vez de 404. */
  disponivel: boolean
}

export async function buscarImovelPublico(chave: string): Promise<ImovelPublico | null> {
  const supabase = createAdminClient()

  const consulta = supabase.from('properties').select(COLUNAS)
  const { data } = UUID.test(chave)
    ? await consulta.eq('id', chave).maybeSingle()
    : await consulta.ilike('reference_code', chave.trim()).maybeSingle()

  if (!data) return null

  const imovel = data as unknown as Property

  /* Imóvel em análise nunca aparece: não foi aprovado, e o link seria um vazamento
     do que ainda está sendo revisado. Já reservado/alugado/vendido teve link
     compartilhado um dia — mostrar "saiu do mercado" é melhor do que sumir. */
  if (imovel.status === 'em_analise' || imovel.status === 'inativo') return null

  return { imovel, disponivel: imovel.status === 'disponivel' }
}

/** Outros imóveis da mesma região, para quem chegou por link e não gostou deste. */
export async function imoveisSemelhantes(imovel: Property, limite = 3): Promise<Property[]> {
  const supabase = createAdminClient()

  const { data } = await supabase
    .from('properties')
    .select(COLUNAS)
    .eq('status', 'disponivel')
    .eq('region', imovel.region)
    .neq('id', imovel.id)
    .in('operation', [imovel.operation, 'ambos'])
    .limit(limite)

  return (data ?? []) as unknown as Property[]
}

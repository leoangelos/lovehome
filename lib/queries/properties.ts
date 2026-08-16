import { createAdminClient } from '@/lib/supabase/admin'
import type { Property } from '@/lib/types/domain'

/* Colunas listadas uma a uma de proposito: select('*') traria `embedding`, um
   vetor de 1536 floats por linha, que nao serve para nenhuma tela e multiplica
   o payload por dezenas de vezes. */
const COLUNAS = `
  id, reference_code, title, operation, property_type,
  price_cents, rent_price_cents, condo_fee_cents,
  bedrooms, suites, bathrooms, parking_spots, area_m2,
  region, city, address, description, amenities, photos,
  status, owner_registration_id, broker_id, created_at
`

/** Vitrine publica — so 'disponivel' (PRD 17.3). */
export async function listarImoveisPublicos(): Promise<Property[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('properties')
    .select(COLUNAS)
    .eq('status', 'disponivel')
    .order('price_cents', { ascending: true, nullsFirst: false })

  if (error) throw new Error(`Falha ao listar imóveis públicos: ${error.message}`)
  return (data ?? []) as unknown as Property[]
}

/** Painel — base completa, incluindo o que ainda nao foi aprovado. */
export async function listarImoveisAdmin(): Promise<Property[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('properties')
    .select(COLUNAS)
    .order('reference_code', { ascending: true })

  if (error) throw new Error(`Falha ao listar imóveis: ${error.message}`)
  return (data ?? []) as unknown as Property[]
}

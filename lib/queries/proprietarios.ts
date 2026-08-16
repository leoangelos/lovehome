import { createAdminClient } from '@/lib/supabase/admin'

/* Proprietários — cadastros com o papel `proprietario` e os imóveis de cada um.
   Só `cpf_last4` sai daqui; o número inteiro fica no contrato (ver
   lib/leasing/contract-template.ts). */

export interface ProprietarioLinha {
  id: string
  full_name: string
  email: string | null
  cpf_last4: string
  criado_em: string
  imoveis: { reference_code: string; title: string; status: string; region: string }[]
  /** Também é interessado/inquilino — papéis não são exclusivos (§6.4). */
  outros_papeis: string[]
}

export async function listarProprietarios(): Promise<ProprietarioLinha[]> {
  const supabase = createAdminClient()

  const { data: papeis, error } = await supabase
    .from('contact_roles')
    .select('registration_id')
    .eq('role', 'proprietario')

  if (error) throw new Error(`Falha ao listar proprietários: ${error.message}`)

  const ids = [...new Set((papeis ?? []).map((p) => p.registration_id))]
  if (ids.length === 0) return []

  const [{ data: cadastros }, { data: imoveis }, { data: todosPapeis }] = await Promise.all([
    supabase
      .from('registrations')
      .select('id, full_name, email, cpf_last4, created_at')
      .in('id', ids)
      .order('full_name'),
    supabase
      .from('properties')
      .select('owner_registration_id, reference_code, title, status, region')
      .in('owner_registration_id', ids),
    supabase.from('contact_roles').select('registration_id, role').in('registration_id', ids),
  ])

  return (cadastros ?? []).map((c) => ({
    id: c.id,
    full_name: c.full_name,
    email: c.email,
    cpf_last4: c.cpf_last4,
    criado_em: c.created_at,
    imoveis: (imoveis ?? [])
      .filter((i) => i.owner_registration_id === c.id)
      .map(({ reference_code, title, status, region }) => ({
        reference_code,
        title,
        status,
        region,
      })),
    outros_papeis: (todosPapeis ?? [])
      .filter((p) => p.registration_id === c.id && p.role !== 'proprietario')
      .map((p) => p.role),
  }))
}

/** Opções para o seletor de proprietário na edição de imóvel. */
export async function opcoesProprietarios(): Promise<
  { id: string; nome: string; cpf_last4: string }[]
> {
  const supabase = createAdminClient()

  const { data: papeis } = await supabase
    .from('contact_roles')
    .select('registration_id')
    .eq('role', 'proprietario')

  const ids = [...new Set((papeis ?? []).map((p) => p.registration_id))]
  if (ids.length === 0) return []

  const { data } = await supabase
    .from('registrations')
    .select('id, full_name, cpf_last4')
    .in('id', ids)
    .order('full_name')

  return (data ?? []).map((r) => ({ id: r.id, nome: r.full_name, cpf_last4: r.cpf_last4 }))
}

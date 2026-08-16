import { createAdminClient } from '@/lib/supabase/admin'
import type {
  BrokerSpecialty,
  FunnelStage,
  Intent,
  RegistrationStatus,
  VisitStatus,
  VisitType,
} from '@/lib/types/domain'

/* Leituras das telas do painel. Todas passam pelo service_role no servidor —
   ver a seção "Banco" do CLAUDE.md.

   Nenhuma delas seleciona cpf_hash ou cpf_encrypted. O único formato de CPF que
   sai daqui é cpf_last4, para a UI mascarar (PRD 6.2). */

export interface LeadLinha {
  id: string
  name: string | null
  phone: string | null
  channel_default: string
  funnel_stage: FunnelStage
  intent: Intent | null
  registration_status: RegistrationStatus
  active_agent: string | null
  last_contact: string | null
  corretor: string | null
  cpf_last4: string | null
  nome_cadastro: string | null
  regiao: string | null
  preco_max_cents: number | null
}

/* `brokerId` não-nulo restringe às linhas do próprio corretor (PRD 9.3).
   Este filtro é a aplicação REAL do escopo por carteira: o painel lê pelo
   service_role, que ignora as policies de RLS. Passar null significa "vê tudo"
   e só deve vir de um papel que realmente pode. */
export async function listarLeads(brokerId?: string | null): Promise<LeadLinha[]> {
  const supabase = createAdminClient()

  let consulta = supabase
    .from('contacts')
    .select(
      `id, name, phone, channel_default, funnel_stage, intent, registration_status,
       active_agent, last_contact,
       brokers ( name ),
       registrations ( full_name, cpf_last4 ),
       lead_qualifications ( region, price_max_cents )`
    )
    .order('last_contact', { ascending: false, nullsFirst: false })
    .limit(200)

  if (brokerId) consulta = consulta.eq('assigned_broker_id', brokerId)

  const { data, error } = await consulta
  if (error) throw new Error(`Falha ao listar leads: ${error.message}`)

  return (data ?? []).map((c) => {
    const corretor = c.brokers as unknown as { name: string } | null
    const cadastro = c.registrations as unknown as {
      full_name: string
      cpf_last4: string
    } | null
    /* lead_qualifications tem UNIQUE(contact_id), mas o PostgREST devolve
       array porque a FK aponta na direção contrária. */
    const qual = (c.lead_qualifications as unknown as
      | { region: string | null; price_max_cents: number | null }[]
      | null)?.[0]

    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      channel_default: c.channel_default,
      funnel_stage: c.funnel_stage,
      intent: c.intent,
      registration_status: c.registration_status,
      active_agent: c.active_agent,
      last_contact: c.last_contact,
      corretor: corretor?.name ?? null,
      cpf_last4: cadastro?.cpf_last4 ?? null,
      nome_cadastro: cadastro?.full_name ?? null,
      regiao: qual?.region ?? null,
      preco_max_cents: qual?.price_max_cents ?? null,
    }
  })
}

export interface VisitaLinha {
  id: string
  scheduled_at: string
  status: VisitStatus
  type: VisitType
  lead: string | null
  lead_id: string
  imovel: string | null
  imovel_regiao: string | null
  corretor: string | null
  /** O calendário filtra por corretor no navegador; o recorte de acesso continua na consulta. */
  broker_id: string | null
}

export async function listarVisitas(brokerId?: string | null): Promise<VisitaLinha[]> {
  const supabase = createAdminClient()

  let consulta = supabase
    .from('property_visits')
    .select(
      `id, scheduled_at, status, type, contact_id,
       contacts ( name ),
       properties ( reference_code, region ),
       broker_id, brokers ( name )`
    )
    /* Janela em volta de hoje, e não "as 200 primeiras de sempre": ordenado
       ascendente sem recorte, o limite gastaria as 200 linhas em visitas
       antigas e o calendário abriria vazio no mês atual. */
    .gte('scheduled_at', new Date(Date.now() - 120 * 86400_000).toISOString())
    .lte('scheduled_at', new Date(Date.now() + 240 * 86400_000).toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(600)

  if (brokerId) consulta = consulta.eq('broker_id', brokerId)

  const { data, error } = await consulta
  if (error) throw new Error(`Falha ao listar visitas: ${error.message}`)

  return (data ?? []).map((v) => {
    const contato = v.contacts as unknown as { name: string | null } | null
    const imovel = v.properties as unknown as {
      reference_code: string
      region: string
    } | null
    const corretor = v.brokers as unknown as { name: string } | null

    return {
      id: v.id,
      scheduled_at: v.scheduled_at,
      status: v.status,
      type: v.type,
      lead: contato?.name ?? null,
      lead_id: v.contact_id,
      imovel: imovel?.reference_code ?? null,
      imovel_regiao: imovel?.region ?? null,
      corretor: corretor?.name ?? null,
      broker_id: v.broker_id ?? null,
    }
  })
}

export interface CorretorLinha {
  id: string
  name: string
  email: string | null
  phone: string | null
  specialty: BrokerSpecialty | null
  region_focus: string[] | null
  is_active: boolean
  imoveis: number
  visitas_futuras: number
  leads: number
  agenda: { weekday: number; start_time: string; end_time: string }[]
}

export async function listarCorretores(): Promise<CorretorLinha[]> {
  const supabase = createAdminClient()

  const [{ data: corretores, error }, { data: agenda }, { data: imoveis }, { data: visitas }, { data: leads }] =
    await Promise.all([
      supabase.from('brokers').select('*').order('name'),
      supabase.from('broker_availability').select('broker_id, weekday, start_time, end_time'),
      supabase.from('properties').select('broker_id').not('broker_id', 'is', null),
      supabase
        .from('property_visits')
        .select('broker_id')
        .in('status', ['agendada', 'confirmada'])
        .gte('scheduled_at', new Date().toISOString()),
      supabase.from('contacts').select('assigned_broker_id').not('assigned_broker_id', 'is', null),
    ])

  if (error) throw new Error(`Falha ao listar corretores: ${error.message}`)

  const contar = <T extends Record<string, unknown>>(linhas: T[] | null, chave: keyof T, id: string) =>
    (linhas ?? []).filter((l) => l[chave] === id).length

  return (corretores ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    specialty: c.specialty,
    region_focus: c.region_focus,
    is_active: c.is_active,
    imoveis: contar(imoveis, 'broker_id', c.id),
    visitas_futuras: contar(visitas, 'broker_id', c.id),
    leads: contar(leads, 'assigned_broker_id', c.id),
    agenda: (agenda ?? [])
      .filter((a) => a.broker_id === c.id)
      .map(({ weekday, start_time, end_time }) => ({ weekday, start_time, end_time }))
      .sort((a, b) => a.weekday - b.weekday),
  }))
}

export interface ResumoLinha {
  id: string
  created_at: string
  trigger: string
  summary_text: string
  lead: string | null
  lead_id: string
  corretor: string | null
  funnel_stage: string | null
}

export async function listarResumos(brokerId?: string | null): Promise<ResumoLinha[]> {
  const supabase = createAdminClient()

  let consulta = supabase
    .from('lead_summaries')
    .select(
      `id, created_at, trigger, summary_text, structured_data, contact_id,
       contacts ( name ),
       brokers ( name )`
    )
    .order('created_at', { ascending: false })
    .limit(100)

  if (brokerId) consulta = consulta.eq('broker_id', brokerId)

  const { data, error } = await consulta
  if (error) throw new Error(`Falha ao listar resumos: ${error.message}`)

  return (data ?? []).map((r) => {
    const contato = r.contacts as unknown as { name: string | null } | null
    const corretor = r.brokers as unknown as { name: string } | null
    const dados = r.structured_data as { funnel_stage?: string } | null

    return {
      id: r.id,
      created_at: r.created_at,
      trigger: r.trigger,
      summary_text: r.summary_text,
      lead: contato?.name ?? null,
      lead_id: r.contact_id,
      corretor: corretor?.name ?? null,
      funnel_stage: dados?.funnel_stage ?? null,
    }
  })
}

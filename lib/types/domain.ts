/* Tipos do dominio imobiliario — espelham os enums do schema (PRD 10).
   Vocabulario de negocio em portugues de proposito: os CHECK constraints do
   Postgres guardam exatamente estas strings, entao traduzir aqui criaria uma
   camada de mapeamento sem ganho nenhum. */

export type RegistrationStatus = 'none' | 'pending' | 'completo'

export type ContactRole = 'interessado' | 'proprietario' | 'inquilino_ativo'

export type FunnelStage =
  | 'novo'
  | 'qualificando'
  | 'qualificado'
  | 'visita_agendada'
  | 'em_negociacao'
  | 'convertido'
  | 'perdido'

export type Intent = 'compra' | 'aluguel' | 'investimento' | 'disponibilizar_imovel'

export type AgentName =
  | 'sdr'
  | 'investidor'
  | 'proprietario'
  | 'agendamento'
  | 'closer'
  | 'suporte'

export type PropertyOperation = 'venda' | 'aluguel' | 'ambos'

export type PropertyStatus =
  | 'em_analise'
  | 'disponivel'
  | 'reservado'
  | 'vendido'
  | 'alugado'
  | 'inativo'

export type DealType = 'locacao' | 'venda'

export type DealStatus =
  | 'proposta'
  | 'em_aprovacao'
  | 'aprovado'
  | 'ativo'
  | 'encerramento_solicitado'
  | 'encerrado'
  | 'concluido'
  | 'cancelado'

export type PaymentStatus = 'pendente' | 'pago' | 'atrasado' | 'cancelado'

export type DocumentStatus = 'pendente_revisao' | 'aprovado' | 'rejeitado'

export type ApprovalStatus = 'pendente' | 'aprovado' | 'rejeitado' | 'info_solicitada'

export type VisitStatus = 'agendada' | 'confirmada' | 'realizada' | 'cancelada' | 'no_show'

export type VisitType = 'visita' | 'reuniao_investidor' | 'call_apresentacao'

export type BrokerSpecialty = 'residencial' | 'investimento' | 'comercial' | 'geral'

export interface Contact {
  id: string
  phone: string | null
  phone_key: string | null
  name: string | null
  channel_default: Channel
  registration_id: string | null
  registration_status: RegistrationStatus
  funnel_stage: FunnelStage
  intent: Intent | null
  active_agent: AgentName | null
  assigned_broker_id: string | null
  blocked: boolean
  blocked_at: string | null
  blocked_reason: string | null
  last_contact: string | null
  created_at: string
  updated_at: string
}

export type Channel = 'zapi' | 'meta' | 'widget'

export interface Property {
  id: string
  reference_code: string
  title: string
  operation: PropertyOperation
  property_type: string
  price_cents: number | null
  rent_price_cents: number | null
  condo_fee_cents: number | null
  bedrooms: number | null
  suites: number | null
  bathrooms: number | null
  parking_spots: number | null
  area_m2: number | null
  region: string
  city: string
  address: string | null
  description: string | null
  amenities: string[]
  photos: string[]
  status: PropertyStatus
  owner_registration_id: string | null
  broker_id: string | null
  created_at: string
}

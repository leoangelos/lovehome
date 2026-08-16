-- ==========================================
-- Migration 004: Identidade conversacional + qualificacao
--
-- contacts e registrations sao camadas propositalmente diferentes (PRD 6.1):
-- contacts e chaveado por phone_key (8 ultimos digitos) e privilegia recall —
-- nunca perder o fio de uma conversa de WhatsApp com variacao de DDI/9o digito.
-- registrations e chaveado por CPF e exige precisao total, porque sustenta
-- contrato e cobranca. contacts.registration_id so aponta para um cadastro
-- depois que o CPF foi coletado e resolvido.
-- ==========================================

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone TEXT,
  phone_key TEXT UNIQUE,
  name TEXT,
  channel_default TEXT DEFAULT 'zapi' CHECK (channel_default IN ('zapi', 'meta', 'widget')),

  registration_id UUID REFERENCES registrations(id),
  registration_status TEXT NOT NULL DEFAULT 'none'
    CHECK (registration_status IN ('none', 'pending', 'completo')),

  funnel_stage TEXT NOT NULL DEFAULT 'novo'
    CHECK (funnel_stage IN ('novo', 'qualificando', 'qualificado', 'visita_agendada',
                            'em_negociacao', 'convertido', 'perdido')),
  intent TEXT CHECK (intent IN ('compra', 'aluguel', 'investimento', 'disponibilizar_imovel')),
  active_agent TEXT CHECK (active_agent IN ('sdr', 'investidor', 'proprietario',
                                            'agendamento', 'closer', 'suporte')),
  assigned_broker_id UUID REFERENCES brokers(id),

  last_contact TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_contacts_phone_key ON contacts(phone_key);
CREATE INDEX idx_contacts_funnel ON contacts(funnel_stage);
CREATE INDEX idx_contacts_registration ON contacts(registration_id)
  WHERE registration_id IS NOT NULL;
CREATE INDEX idx_contacts_broker ON contacts(assigned_broker_id)
  WHERE assigned_broker_id IS NOT NULL;

CREATE TABLE lead_qualifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  intent TEXT CHECK (intent IN ('compra', 'aluguel', 'investimento')),
  price_min_cents INTEGER,
  price_max_cents INTEGER,
  bedrooms INTEGER,
  region TEXT,
  city TEXT DEFAULT 'São Paulo',
  property_type TEXT,
  urgency TEXT CHECK (urgency IN ('imediata', 'ate_30_dias', 'ate_90_dias', 'sem_pressa')),
  investor_ticket_cents INTEGER,
  investor_return_expectation TEXT,
  investor_has_portfolio BOOLEAN,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contact_id)
);

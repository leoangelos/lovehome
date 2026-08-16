-- ==========================================
-- Migration 006: Visitas e formularios publicos tokenizados
-- ==========================================

CREATE TABLE property_visits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id),
  broker_id UUID REFERENCES brokers(id),
  scheduled_at TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL DEFAULT 'visita'
    CHECK (type IN ('visita', 'reuniao_investidor', 'call_apresentacao')),
  status TEXT NOT NULL DEFAULT 'agendada'
    CHECK (status IN ('agendada', 'confirmada', 'realizada', 'cancelada', 'no_show')),
  calendar_event_id TEXT,              -- reservado para sync opcional futuro (PRD 7.4)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Formularios de cadastro e de listagem de imovel (PRD 6.5). O link com token
-- e gerado por request_registration_form e enviado pelo agente na conversa.
CREATE TABLE form_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  form_type TEXT NOT NULL CHECK (form_type IN ('cadastro', 'listagem_imovel')),
  contact_id UUID REFERENCES contacts(id),
  registration_id UUID REFERENCES registrations(id),
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'preenchido', 'expirado')),
  payload JSONB DEFAULT '{}',
  expires_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_visits_contact ON property_visits(contact_id);
CREATE INDEX idx_visits_broker ON property_visits(broker_id);
CREATE INDEX idx_visits_scheduled ON property_visits(scheduled_at);
CREATE INDEX idx_form_submissions_token ON form_submissions(token);
CREATE INDEX idx_form_submissions_status ON form_submissions(status)
  WHERE status = 'pendente';

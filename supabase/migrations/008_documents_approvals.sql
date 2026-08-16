-- ==========================================
-- Migration 008: Documentos e aprovacao humana
--
-- approval_requests e o portao humano entre "documentos recebidos pelo Closer" e
-- "contrato gerado" (PRD 15.2). Nenhum contrato e gerado ou enviado para
-- assinatura sem essa aprovacao explicita — nao existe caminho automatizado que
-- pule esse humano.
-- ==========================================

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  registration_id UUID REFERENCES registrations(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('rg_cnh', 'comprovante_renda', 'comprovante_residencia',
                                     'escritura_imovel', 'outro')),
  storage_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente_revisao'
    CHECK (status IN ('pendente_revisao', 'aprovado', 'rejeitado')),
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE approval_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('aprovacao_listagem_imovel', 'aprovacao_locacao',
                                     'aprovacao_venda')),
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'aprovado', 'rejeitado', 'info_solicitada')),
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (property_id IS NOT NULL OR deal_id IS NOT NULL)
);

CREATE TABLE lead_summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  broker_id UUID REFERENCES brokers(id),
  trigger TEXT NOT NULL
    CHECK (trigger IN ('qualificacao_completa', 'visita_agendada', 'reengajamento', 'manual')),
  summary_text TEXT NOT NULL,
  structured_data JSONB DEFAULT '{}',
  sent_via TEXT CHECK (sent_via IN ('dashboard', 'whatsapp', 'email')),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_documents_registration ON documents(registration_id);
CREATE INDEX idx_documents_deal ON documents(deal_id);
CREATE INDEX idx_documents_pendentes ON documents(status) WHERE status = 'pendente_revisao';
CREATE INDEX idx_approval_status ON approval_requests(status) WHERE status = 'pendente';
CREATE INDEX idx_summaries_contact ON lead_summaries(contact_id);
CREATE INDEX idx_summaries_broker ON lead_summaries(broker_id);

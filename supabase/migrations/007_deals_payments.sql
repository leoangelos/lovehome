-- ==========================================
-- Migration 007: Negocios, contratos e cobranca
--
-- deals cobre venda E locacao na mesma tabela (PRD 10.7): o ciclo
-- aprovacao -> contrato -> assinatura e identico nos dois casos, so a parte
-- financeira diverge. Separar duplicaria approval_requests, documents e toda a
-- logica de contrato por tipo de negocio.
-- ==========================================

CREATE TABLE contract_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_type TEXT NOT NULL CHECK (deal_type IN ('locacao', 'venda')),
  name TEXT NOT NULL,
  body_template TEXT NOT NULL,         -- {{tenant_name}}, {{property_address}}, {{rent_price}}...
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_type TEXT NOT NULL CHECK (deal_type IN ('locacao', 'venda')),
  property_id UUID NOT NULL REFERENCES properties(id),
  client_registration_id UUID NOT NULL REFERENCES registrations(id),  -- locatario OU comprador
  owner_registration_id UUID REFERENCES registrations(id),
  broker_id UUID REFERENCES brokers(id),

  status TEXT NOT NULL DEFAULT 'em_aprovacao'
    CHECK (status IN ('em_aprovacao', 'aprovado', 'ativo', 'encerramento_solicitado',
                      'encerrado', 'concluido', 'cancelado')),

  -- Locacao — NULL quando deal_type = 'venda'
  rent_price_cents INTEGER,
  start_date DATE,
  end_date DATE,
  notice_period_days INTEGER DEFAULT 30,
  termination_requested_at TIMESTAMPTZ,
  termination_effective_date DATE,
  asaas_subscription_id TEXT,

  -- Venda — NULL quando deal_type = 'locacao'
  sale_price_cents INTEGER,
  down_payment_cents INTEGER,
  financing_type TEXT CHECK (financing_type IN ('a_vista', 'financiado', 'consorcio')),
  itbi_status TEXT CHECK (itbi_status IN ('pendente', 'pago')),

  -- Contrato e assinatura — comum aos dois tipos (PRD 15)
  contract_template_id UUID REFERENCES contract_templates(id),
  contract_document_url TEXT,          -- PDF gerado, nao assinado
  signature_method TEXT CHECK (signature_method IN ('manual', 'govbr')),
  signed_document_url TEXT,            -- PDF assinado, devolvido pelo cliente
  signed_returned_via TEXT CHECK (signed_returned_via IN ('whatsapp', 'email')),
  contract_signed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- O template tem que combinar com o tipo do negocio: contrato de venda tem
  -- clausula de sinal/ITBI, o de locacao tem aluguel e prazo de aviso.
  CHECK (deal_type <> 'locacao' OR sale_price_cents IS NULL),
  CHECK (deal_type <> 'venda' OR rent_price_cents IS NULL)
);

-- Cobranca recorrente — so existe para deal_type='locacao' (venda nao tem mensalidade)
CREATE TABLE lease_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  reference_month DATE NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'pago', 'atrasado', 'cancelado')),
  due_date DATE NOT NULL,
  paid_at TIMESTAMPTZ,
  asaas_payment_id TEXT,
  boleto_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(deal_id, reference_month)
);

CREATE INDEX idx_deals_client ON deals(client_registration_id);
CREATE INDEX idx_deals_property ON deals(property_id);
CREATE INDEX idx_deals_broker ON deals(broker_id);
CREATE INDEX idx_deals_type_status ON deals(deal_type, status);
CREATE INDEX idx_payments_deal ON lease_payments(deal_id);
CREATE INDEX idx_payments_asaas ON lease_payments(asaas_payment_id)
  WHERE asaas_payment_id IS NOT NULL;

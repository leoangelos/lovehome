-- ==========================================
-- Migration 005: Imoveis
--
-- Imovel cadastrado por proprietario via chat nasce 'em_analise', nunca
-- 'disponivel' (PRD 10.4) — so vai a vitrine depois de aprovado por um humano.
-- O seed do portfolio simulado nasce 'disponivel' direto.
-- ==========================================

CREATE TABLE properties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference_code TEXT UNIQUE,
  title TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('venda', 'aluguel', 'ambos')),
  property_type TEXT NOT NULL,

  price_cents INTEGER,
  rent_price_cents INTEGER,
  condo_fee_cents INTEGER,

  bedrooms INTEGER,
  suites INTEGER,
  bathrooms INTEGER,
  parking_spots INTEGER,
  area_m2 NUMERIC,

  region TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT 'São Paulo',
  address TEXT,

  description TEXT,
  amenities JSONB DEFAULT '[]',
  photos JSONB DEFAULT '[]',

  status TEXT NOT NULL DEFAULT 'disponivel'
    CHECK (status IN ('em_analise', 'disponivel', 'reservado', 'vendido', 'alugado', 'inativo')),
  owner_registration_id UUID REFERENCES registrations(id),
  broker_id UUID REFERENCES brokers(id),

  embedding vector(1536),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_properties_filters ON properties(operation, property_type, region, status);
CREATE INDEX idx_properties_price ON properties(price_cents);
CREATE INDEX idx_properties_owner ON properties(owner_registration_id)
  WHERE owner_registration_id IS NOT NULL;
CREATE INDEX idx_properties_broker ON properties(broker_id) WHERE broker_id IS NOT NULL;

-- ATENCAO: ivfflat particiona o espaco a partir dos dados existentes no momento
-- da criacao. Criado aqui com a tabela vazia, ele nasce sem centroides uteis e
-- a busca semantica fica ruim. Rodar REINDEX INDEX idx_properties_embedding
-- depois de popular os embeddings, e sempre que o volume crescer muito.
CREATE INDEX idx_properties_embedding ON properties
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

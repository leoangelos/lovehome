-- ==========================================
-- Migration 003: Cadastro formal (identidade legal)
--
-- CPF em tres colunas com papeis distintos (PRD 6.2) — nunca uma so:
--   cpf_hash      HMAC-SHA256 deterministico. E a chave de busca ("esse CPF ja
--                 existe?") sem guardar o numero em claro para consulta.
--   cpf_encrypted AES-256-GCM com IV aleatorio. Reversivel so server-side e so
--                 quando ha necessidade real (gerar contrato). Nao e pesquisavel
--                 por igualdade — dai o hash separado.
--   cpf_last4     Texto plano dos 4 ultimos, unico formato que aparece em tela.
--
-- Nao trocar por criptografia deterministica "para poder indexar": reduziria a
-- seguranca para ganhar o que o hash ja resolve.
-- ==========================================

CREATE TABLE registrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cpf_hash TEXT NOT NULL UNIQUE,
  cpf_encrypted TEXT NOT NULL,
  cpf_last4 TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  birth_date DATE,
  address JSONB,                       -- {street, number, complement, neighborhood, city, state, zip}
  income_declared_cents INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_registrations_cpf_hash ON registrations(cpf_hash);

-- Papeis multiplos, nao um enum exclusivo (PRD 6.4): a mesma pessoa pode estar
-- procurando imovel para alugar E ter um imovel proprio para disponibilizar.
CREATE TABLE contact_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  registration_id UUID NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('interessado', 'proprietario', 'inquilino_ativo')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(registration_id, role)
);

CREATE INDEX idx_contact_roles_registration ON contact_roles(registration_id);

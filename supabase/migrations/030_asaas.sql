-- ==========================================
-- 030 — Integração Asaas (PRD 14)
-- ==========================================

-- `registrations.asaas_customer_id` existe para o CPF ser descriptografado UMA
-- VEZ na vida do cadastro.
--
-- Criar cliente no Asaas exige `cpfCnpj` — cobranca no Brasil pede documento
-- por lei, nao ha como contornar. Isso faz de lib/asaas/customers.ts o SEGUNDO
-- (e ultimo) lugar autorizado a chamar decryptSecret sobre cpf_encrypted, ao
-- lado de lib/leasing/contract-template.ts. Guardar o id devolvido pelo Asaas e
-- o que impede a descriptografia de virar rotina: da segunda cobranca em
-- diante, o sistema so usa o id.
--
-- UNIQUE parcial: dois cadastros apontando para o mesmo cliente no Asaas
-- misturaria a cobranca de duas pessoas.

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS asaas_customer_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_asaas
  ON registrations(asaas_customer_id) WHERE asaas_customer_id IS NOT NULL;

-- ------------------------------------------------------------------
-- Dedup de webhook (PRD 14.2)
--
-- O Asaas REENTREGA em caso de timeout ou de resposta nao-2xx. Sem dedup, um
-- PAYMENT_RECEIVED reentregue marcaria como pago duas vezes — inofensivo aqui —,
-- mas um evento de estorno reprocessado desfaria o estado errado. A chave e
-- (event, asaas_payment_id) — o mesmo papel que
-- (platform, transaction_id) cumpre em integracoes de pagamento em geral.
--
-- O payload inteiro fica guardado: quando a conciliacao diverge, a pergunta e
-- sempre "o que o Asaas mandou mesmo?", e sem o cru nao ha resposta.
-- ------------------------------------------------------------------
CREATE TABLE asaas_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event TEXT NOT NULL,
  asaas_payment_id TEXT,
  asaas_event_id TEXT,
  payload JSONB NOT NULL,
  -- FALSE quando o evento chegou mas nao encontrou cobranca correspondente:
  -- e o sinal de que ha algo a conciliar, nao de que o webhook falhou.
  aplicado BOOLEAN NOT NULL DEFAULT FALSE,
  observacao TEXT,
  recebido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event, asaas_payment_id)
);

CREATE INDEX idx_asaas_events_recebido ON asaas_events(recebido_em DESC);

ALTER TABLE asaas_events ENABLE ROW LEVEL SECURITY;

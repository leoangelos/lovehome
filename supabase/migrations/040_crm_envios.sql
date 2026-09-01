-- ==========================================
-- Migration 040: registro dos envios do webhook de CRM, com reenvio.
--
-- Cada tentativa de POST para o CRM da casa vira uma linha: evento, payload
-- enviado, status HTTP e erro. E o que a tela de Canais mostra ("os ultimos
-- envios deram 200?") e o que permite REENVIAR um que falhou — o payload
-- guardado e reenviado fielmente, assinado com o segredo atual, para a URL
-- atual (o reparo tipico e "a URL estava errada, corrigi, reenvia").
--
-- O payload carrega dado pessoal (nome, telefone, e-mail — nunca CPF, por
-- construcao do lib/crm/webhook). Por isso contact_id CASCATEIA: apagar o
-- contato a pedido do titular apaga tambem o rastro de envio (migration 014,
-- mesma regra). Evento 'teste' nao tem contato.
-- ==========================================

CREATE TABLE crm_webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  evento TEXT NOT NULL CHECK (evento IN ('lead_novo', 'lead_cadastro_completo', 'teste')),
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  payload JSONB NOT NULL,
  sucesso BOOLEAN NOT NULL DEFAULT FALSE,
  http_status INTEGER,
  erro TEXT,
  tentativas INTEGER NOT NULL DEFAULT 1,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ultima_tentativa_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_crm_deliveries_recentes ON crm_webhook_deliveries(criado_em DESC);

-- Deny-all para anon, como toda tabela sensivel: o painel le pelo service_role.
ALTER TABLE crm_webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- Migration 039: webhook de leads para CRM externo.
--
-- A imobiliaria cadastra UMA URL propria e passa a receber POST assinado
-- (HMAC-SHA256 no header X-Lovehome-Assinatura) em dois momentos:
--   * lead_novo             — inicio de conversa (nome e telefone, se houver)
--   * lead_cadastro_completo — formulario preenchido/vinculado (dados atuais)
--
-- Mora em channel_configs porque o segredo de assinatura precisa do mesmo
-- armazenamento cifrado dos outros canais (mesma razao do 'asaas'). A URL nao
-- e segredo e ganha coluna propria. O payload NUNCA leva CPF — decisao
-- registrada na modelagem de ameacas (docs/MODELAGEM-DE-AMEACAS.md).
-- ==========================================

ALTER TABLE channel_configs DROP CONSTRAINT IF EXISTS channel_configs_channel_check;
ALTER TABLE channel_configs ADD CONSTRAINT channel_configs_channel_check
  CHECK (channel IN ('zapi', 'meta', 'widget', 'asaas', 'crm'));

ALTER TABLE channel_configs
  ADD COLUMN IF NOT EXISTS webhook_url TEXT;

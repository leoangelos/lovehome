-- ==========================================
-- Migration 012: Colunas que faltaram em channel_configs
--
-- Aqui entram
-- agora porque as duas ja tem uso previsto:
--
--   forwarder_secret_encrypted — segredo pre-compartilhado para autenticar
--     webhook. E onde vai o token do webhook do Asaas (PRD 14.2), pelo mesmo
--     mesmo padrao dos outros segredos de canal.
--
--   notification_group_id — grupo de WhatsApp que recebe alerta de escalacao,
--     para alguem assumir a conversa. Texto plano de proposito: e um id de
--     grupo, nao um segredo.
-- ==========================================

ALTER TABLE channel_configs
  ADD COLUMN forwarder_secret_encrypted TEXT,
  ADD COLUMN notification_group_id TEXT;

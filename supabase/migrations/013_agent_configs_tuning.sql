-- ==========================================
-- Migration 013: Parametros de tuning por agente
--
-- NULL significa "usar o default da OpenAI" — por isso sem DEFAULT na coluna.
-- O carregador so envia o parametro quando ha valor, em vez de mandar um numero
-- inventado que silenciosamente muda o comportamento do modelo.
-- ==========================================

ALTER TABLE agent_configs
  ADD COLUMN top_p NUMERIC(3,2),
  ADD COLUMN max_tokens INTEGER,
  ADD COLUMN frequency_penalty NUMERIC(3,2),
  ADD COLUMN presence_penalty NUMERIC(3,2);

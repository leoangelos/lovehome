-- ==========================================
-- Migration 036: cancelar e reagendar visita com rastro.
--
-- Cancelar e mudar status; reagendar e mover a MESMA linha (scheduled_at e,
-- se preciso, broker_id) — nao criar outra. Os indices unicos parciais da 035
-- ignoram visitas canceladas, entao cancelar ou mover libera a janela antiga
-- na hora, sem passo extra.
--
-- As tres colunas sao rastro, nao regra: quem cancelou pelo painel precisa do
-- motivo na tela; e "de quando foi remarcada" e a pergunta que aparece quando
-- o cliente diz "mas eu tinha marcado quinta".
-- ==========================================

ALTER TABLE property_visits
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS rescheduled_from TIMESTAMPTZ;

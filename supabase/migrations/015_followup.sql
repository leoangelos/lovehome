-- ==========================================
-- Migration 015: Controle de follow-up
--
-- O cron precisa saber a quem ja escreveu e quantas vezes, senao reengaja a
-- mesma pessoa a cada execucao — que e a diferenca entre lembrar e importunar.
--
-- Colunas em contacts, e nao tabela separada: sao dois contadores lidos e
-- escritos sempre junto com a linha do contato, e o historico do que foi dito
-- ja fica em messages.
-- ==========================================

ALTER TABLE contacts
  ADD COLUMN followup_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN last_followup_at TIMESTAMPTZ;

-- O cron varre por inatividade; o indice parcial cobre exatamente quem ainda
-- esta elegivel (fora dos estagios terminais e nao bloqueado).
CREATE INDEX idx_contacts_followup
  ON contacts (last_contact)
  WHERE blocked = FALSE
    AND funnel_stage NOT IN ('convertido', 'perdido');

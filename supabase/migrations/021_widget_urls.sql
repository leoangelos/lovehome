-- ==========================================
-- 021 — Widget: colunas de navegacao e exclusao em cascata
-- ==========================================

-- O adapter do widget (lib/channels/widget.ts) grava a pagina de
-- entrada, o referrer e a pagina atual do visitante. Essas colunas nasceram la
-- depois da migration 011 daqui, entao a tabela ficou sem elas e todo
-- createWidgetSession falhava com "Could not find the 'current_url' column".
--
-- Servem para o corretor saber DE ONDE a pessoa esta falando: quem abre a
-- conversa na pagina de um imovel especifico ja disse qual imovel interessa,
-- sem precisar perguntar.
ALTER TABLE widget_sessions
  ADD COLUMN IF NOT EXISTS landing_url  TEXT,
  ADD COLUMN IF NOT EXISTS referrer_url TEXT,
  ADD COLUMN IF NOT EXISTS current_url  TEXT;

-- ------------------------------------------------------------------
-- Exclusao de contato precisa levar a sessao junto.
--
-- widget_sessions guarda ip_hash, visitor_name e visitor_email — dado pessoal.
-- Com ON DELETE SET NULL, apagar o contato a pedido do titular deixava esses
-- campos orfaos na tabela: o vinculo sumia, o dado ficava. E o mesmo motivo da
-- migration 014, que ja cascateou routing_logs, message_traces e
-- form_submissions.
-- ------------------------------------------------------------------
ALTER TABLE widget_sessions
  DROP CONSTRAINT IF EXISTS widget_sessions_contact_id_fkey,
  ADD CONSTRAINT widget_sessions_contact_id_fkey
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE;

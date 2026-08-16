-- ==========================================
-- 029 — Um usuário precisa continuar deletável
-- ==========================================

-- Seis FKs para auth.users nasceram sem ON DELETE e bloqueavam a exclusao:
-- quem assumisse uma conversa, salvasse credencial de canal, editasse um
-- prompt, subisse um material ou tocasse nas Configuracoes ficava indeletavel
-- para sempre. Mesma classe do problema que a migration 014 resolveu para
-- `contacts` — e apareceu do mesmo jeito, com um teste falhando por nao
-- conseguir limpar o usuario que ele mesmo criou.
--
-- Por que SET NULL e nao CASCADE, em todas: apagar a pessoa NAO pode apagar a
-- conversa do cliente, o log de auditoria, a credencial do canal, o prompt em
-- producao nem o material indexado. O vinculo se perde; o registro fica.
--
-- A auditoria sobrevive porque `human_takeover_logs.note` ja guarda o e-mail de
-- quem agiu em texto — o ponteiro some, o nome permanece.
--
-- Continua valendo a pratica da §9: o caminho normal e DESATIVAR
-- (`is_active = false`), nao apagar, para as decisoes seguirem rastreaveis.
-- Apagar existe para pedido de exclusao de dados e para os scripts de teste.

ALTER TABLE conversations
  DROP CONSTRAINT conversations_taken_by_fkey,
  ADD CONSTRAINT conversations_taken_by_fkey
    FOREIGN KEY (taken_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE human_takeover_logs
  DROP CONSTRAINT human_takeover_logs_profile_id_fkey,
  ADD CONSTRAINT human_takeover_logs_profile_id_fkey
    FOREIGN KEY (profile_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE channel_configs
  DROP CONSTRAINT channel_configs_updated_by_fkey,
  ADD CONSTRAINT channel_configs_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE agent_configs
  DROP CONSTRAINT agent_configs_updated_by_fkey,
  ADD CONSTRAINT agent_configs_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE rag_documents
  DROP CONSTRAINT rag_documents_created_by_fkey,
  ADD CONSTRAINT rag_documents_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE app_settings
  DROP CONSTRAINT app_settings_atualizado_por_fkey,
  ADD CONSTRAINT app_settings_atualizado_por_fkey
    FOREIGN KEY (atualizado_por) REFERENCES auth.users(id) ON DELETE SET NULL;

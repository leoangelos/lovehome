-- ==========================================
-- Migration 014: Permitir apagar um contato
--
-- Tres FKs para contacts nasceram sem ON DELETE CASCADE (
-- onde routing_logs referenciava wa_users do mesmo jeito):
--   routing_logs.contact_id
--   message_traces.contact_id
--   form_submissions.contact_id
--
-- Efeito pratico: assim que a pessoa trocava a primeira mensagem, a linha em
-- contacts virava indeletavel — qualquer DELETE batia em violacao de FK. Isso
-- inviabiliza atender pedido de exclusao de dados (LGPD), e o supabase-js
-- devolve o erro no retorno em vez de lancar, entao a falha passava despercebida
-- em qualquer rotina de limpeza.
--
-- CASCADE e a regra certa nas tres: todas guardam dado pessoal do proprio
-- contato (mensagem de entrada em routing_logs, prompt e resposta crua em
-- message_traces, payload do formulario em form_submissions). Se o titular
-- some, esses registros nao deveriam sobreviver a ele.
--
-- message_traces ja cascateava por conversation_id — o vinculo por contact_id
-- barrando a exclusao era, alem de tudo, incoerente com isso.
-- ==========================================

ALTER TABLE routing_logs
  DROP CONSTRAINT routing_logs_contact_id_fkey,
  ADD CONSTRAINT routing_logs_contact_id_fkey
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE;

ALTER TABLE message_traces
  DROP CONSTRAINT message_traces_contact_id_fkey,
  ADD CONSTRAINT message_traces_contact_id_fkey
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE;

ALTER TABLE form_submissions
  DROP CONSTRAINT form_submissions_contact_id_fkey,
  ADD CONSTRAINT form_submissions_contact_id_fkey
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE;

-- ==========================================
-- Migration 010: Correcoes apontadas pelo linter do Supabase
--
-- 1. Helpers de RLS fora do schema exposto
--
-- tem_papel e e_o_corretor sao SECURITY DEFINER. Em `public`, o PostgREST as
-- publica como /rest/v1/rpc/<nome>, ou seja, qualquer um com a chave anon podia
-- chama-las diretamente.
--
-- Revogar EXECUTE nao serve: expressao de policy e avaliada com o privilegio de
-- quem faz a consulta, entao tirar EXECUTE de `authenticated` quebraria todas as
-- policies da migration 009. A saida e mover para um schema que o PostgREST nao
-- expoe, mantendo o EXECUTE — deixa de existir rota HTTP, e a policy continua
-- funcionando.
--
-- handle_new_user e diferente: e funcao de trigger, e o Postgres nao checa
-- EXECUTE do usuario que dispara o trigger. Ai revogar e seguro e suficiente.
--
-- 2. Extensao vector fora do public (recomendacao do Supabase).
-- ==========================================

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;

-- As policies dependem das funcoes; derrubar antes de recria-las noutro schema.
DROP POLICY IF EXISTS profiles_self_read ON profiles;
DROP POLICY IF EXISTS contacts_scope     ON contacts;
DROP POLICY IF EXISTS visits_scope       ON property_visits;
DROP POLICY IF EXISTS summaries_scope    ON lead_summaries;
DROP POLICY IF EXISTS deals_scope        ON deals;
DROP POLICY IF EXISTS properties_scope   ON properties;
DROP POLICY IF EXISTS brokers_read       ON brokers;

DROP FUNCTION IF EXISTS public.tem_papel(TEXT[]);
DROP FUNCTION IF EXISTS public.e_o_corretor(UUID);

CREATE OR REPLACE FUNCTION private.tem_papel(papeis TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = ANY(papeis)
  );
$$;

CREATE OR REPLACE FUNCTION private.e_o_corretor(broker UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT broker IS NOT NULL AND EXISTS (
    SELECT 1 FROM brokers b WHERE b.profile_id = auth.uid() AND b.id = broker
  );
$$;

CREATE POLICY profiles_self_read ON profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR private.tem_papel(ARRAY['admin']));

CREATE POLICY contacts_scope ON contacts
  FOR SELECT TO authenticated
  USING (private.tem_papel(ARRAY['admin', 'viewer']) OR private.e_o_corretor(assigned_broker_id));

CREATE POLICY visits_scope ON property_visits
  FOR SELECT TO authenticated
  USING (private.tem_papel(ARRAY['admin', 'viewer']) OR private.e_o_corretor(broker_id));

CREATE POLICY summaries_scope ON lead_summaries
  FOR SELECT TO authenticated
  USING (private.tem_papel(ARRAY['admin', 'viewer']) OR private.e_o_corretor(broker_id));

CREATE POLICY deals_scope ON deals
  FOR SELECT TO authenticated
  USING (private.tem_papel(ARRAY['admin', 'viewer']) OR private.e_o_corretor(broker_id));

CREATE POLICY properties_scope ON properties
  FOR ALL TO authenticated
  USING (private.tem_papel(ARRAY['admin', 'viewer', 'editor']) OR private.e_o_corretor(broker_id))
  WITH CHECK (private.tem_papel(ARRAY['admin', 'editor']) OR private.e_o_corretor(broker_id));

CREATE POLICY brokers_read ON brokers
  FOR SELECT TO authenticated
  USING (private.tem_papel(ARRAY['admin', 'viewer', 'editor', 'corretor']));

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

ALTER EXTENSION vector SET SCHEMA extensions;

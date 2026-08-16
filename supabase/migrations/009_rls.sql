-- ==========================================
-- Migration 009: RLS
--
-- Postura: todo acesso do servidor passa
-- pelo service_role, que ignora RLS. Habilitar RLS sem policy nenhuma equivale a
-- "deny all" para anon e authenticated — defesa em profundidade para o caso de a
-- chave anon vazar.
--
-- Por cima disso vem o escopo por corretor da secao 9.3 do PRD, para as tabelas
-- que um corretor autenticado consulta pelo painel. O Copiloto (PRD 12.8) usa
-- exatamente o mesmo escopo: assim, um bug de prompt nao vaza dado de outro
-- corretor, porque quem barra e o banco, nao o prompt.
-- ==========================================

ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE brokers               ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_availability   ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_blocked_slots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_roles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_qualifications   ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties            ENABLE ROW LEVEL SECURITY;
ALTER TABLE property_visits       ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_submissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_templates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE lease_payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents             ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_summaries        ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- Helpers
-- ==========================================

-- SECURITY DEFINER de proposito: as policies abaixo consultam profiles, e
-- profiles tambem tem RLS. Sem isso a checagem de papel recursaria na propria
-- policy de profiles.
CREATE OR REPLACE FUNCTION tem_papel(papeis TEXT[])
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

CREATE OR REPLACE FUNCTION e_o_corretor(broker UUID)
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

-- ==========================================
-- profiles — cada um le o proprio; admin le todos
-- ==========================================
CREATE POLICY profiles_self_read ON profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR tem_papel(ARRAY['admin']));

-- ==========================================
-- contacts / visitas / resumos / negocios — escopo por corretor (PRD 9.3)
-- ==========================================
CREATE POLICY contacts_scope ON contacts
  FOR SELECT TO authenticated
  USING (tem_papel(ARRAY['admin', 'viewer']) OR e_o_corretor(assigned_broker_id));

CREATE POLICY visits_scope ON property_visits
  FOR SELECT TO authenticated
  USING (tem_papel(ARRAY['admin', 'viewer']) OR e_o_corretor(broker_id));

CREATE POLICY summaries_scope ON lead_summaries
  FOR SELECT TO authenticated
  USING (tem_papel(ARRAY['admin', 'viewer']) OR e_o_corretor(broker_id));

CREATE POLICY deals_scope ON deals
  FOR SELECT TO authenticated
  USING (tem_papel(ARRAY['admin', 'viewer']) OR e_o_corretor(broker_id));

-- ==========================================
-- properties — editor tambem gerencia (PRD 9.2)
-- ==========================================
CREATE POLICY properties_scope ON properties
  FOR ALL TO authenticated
  USING (tem_papel(ARRAY['admin', 'viewer', 'editor']) OR e_o_corretor(broker_id))
  WITH CHECK (tem_papel(ARRAY['admin', 'editor']) OR e_o_corretor(broker_id));

-- ==========================================
-- brokers — o roster interno e visivel para toda a equipe autenticada
-- ==========================================
CREATE POLICY brokers_read ON brokers
  FOR SELECT TO authenticated
  USING (tem_papel(ARRAY['admin', 'viewer', 'editor', 'corretor']));

-- ==========================================
-- Sem policy de propósito (deny all, so service_role acessa):
--   registrations, contact_roles  — CPF e endereco; nunca via chave anon
--   documents, approval_requests  — anexos e decisao humana
--   lease_payments, form_submissions, lead_qualifications, contract_templates,
--   broker_availability, broker_blocked_slots
--
-- A vitrine publica NAO le properties com a chave anon: le no servidor via
-- service_role filtrando status='disponivel' (ver lib/queries/properties.ts).
-- Abrir SELECT anon em properties exporia todas as colunas das linhas visiveis
-- — RLS filtra linha, nao coluna — inclusive endereco completo e o vinculo com
-- o proprietario.
-- ==========================================

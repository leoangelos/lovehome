-- ==========================================
-- Migration 016: Gestão de perfis e convites (PRD 9)
--
-- Equipe interna entra por convite, não por cadastro aberto: quem entra no
-- painel enxerga dado de lead, contrato e cobrança.
--
-- `is_active` em vez de apagar o usuário: quem saiu da imobiliária precisa
-- perder o acesso, mas as decisões que tomou (documento aprovado, negócio
-- liberado) apontam para o profile e devem continuar rastreáveis.
-- ==========================================

ALTER TABLE profiles
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN phone TEXT,
  ADD COLUMN invited_by UUID REFERENCES profiles(id),
  ADD COLUMN invited_at TIMESTAMPTZ,
  ADD COLUMN last_sign_in_at TIMESTAMPTZ;

CREATE INDEX idx_profiles_role ON profiles(role) WHERE is_active = TRUE;

/* O trigger passa a ler o papel do metadata do convite.
   Sem isso o convidado nasce 'viewer' e só vira 'corretor' num UPDATE seguinte
   — uma janela em que ele pode logar com o papel errado. O papel é validado
   contra a mesma lista do CHECK: metadata vem do cliente da API de admin, e
   valor fora da lista deve cair no default, não passar direto. */
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  papel TEXT;
BEGIN
  papel := NEW.raw_user_meta_data->>'role';
  IF papel IS NULL OR papel NOT IN ('admin', 'corretor', 'editor', 'viewer') THEN
    papel := 'viewer';
  END IF;

  INSERT INTO profiles (id, email, full_name, role, phone, invited_at)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    papel,
    NEW.raw_user_meta_data->>'phone',
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

/* Corretor convidado precisa de linha em brokers para as tools de agenda e o
   escopo por corretor funcionarem. Vincula a um registro já existente com o
   mesmo e-mail (o time pode ter sido cadastrado antes de ter login) ou cria um. */
CREATE OR REPLACE FUNCTION vincular_corretor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role <> 'corretor' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM brokers WHERE profile_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  UPDATE brokers SET profile_id = NEW.id
  WHERE lower(email) = lower(NEW.email) AND profile_id IS NULL;

  IF NOT FOUND THEN
    INSERT INTO brokers (profile_id, name, email, specialty, is_active)
    VALUES (NEW.id, COALESCE(NEW.full_name, NEW.email), NEW.email, 'geral', TRUE);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_profile_corretor
  AFTER INSERT OR UPDATE OF role ON profiles
  FOR EACH ROW EXECUTE FUNCTION vincular_corretor();

REVOKE EXECUTE ON FUNCTION public.vincular_corretor() FROM PUBLIC, anon, authenticated;

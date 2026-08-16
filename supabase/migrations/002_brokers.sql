-- ==========================================
-- Migration 002: Corretores e agenda
-- Agenda e tabela interna, nao Google Calendar por corretor (PRD 7.4):
-- OAuth por corretor expira, e revogado e quebra na demonstracao ao vivo.
-- ==========================================

CREATE TABLE brokers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID REFERENCES profiles(id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  specialty TEXT CHECK (specialty IN ('residencial', 'investimento', 'comercial', 'geral')),
  region_focus TEXT[],
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Disponibilidade recorrente (ex: seg-sex 9h-18h) — lida por check_broker_availability
CREATE TABLE broker_availability (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  broker_id UUID NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (end_time > start_time)
);

-- Bloqueios pontuais (folga, compromisso especifico)
CREATE TABLE broker_blocked_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  broker_id UUID NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX idx_broker_availability_broker ON broker_availability(broker_id);
CREATE INDEX idx_broker_blocked_broker ON broker_blocked_slots(broker_id, starts_at);

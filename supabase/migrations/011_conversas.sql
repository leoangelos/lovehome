-- ==========================================
-- Migration 011: Mensageria e observabilidade
--
-- Consolida numa migration so o que poderia estar espalhado por varias:
-- 009, 011, 012, 017, 018 e 040 — aqui nasce de uma vez porque nao ha base
-- legada para migrar em etapas. A chave de conversa e contact_id (PRD 10.1),
-- nao um id de usuario por canal.
--
-- Duas divergencias em relacao ao texto do PRD, resolvidas a favor do codigo de
-- origem (que o proprio PRD manda usar como fonte de verdade, secao 23):
--   * A blacklist nao e uma tabela `contact_blocklist` — sao colunas em
--     contacts. Ver bloco no fim deste arquivo.
--   * channel_configs guarda tambem integracao que nao e canal de mensagem
--     (aqui, asaas), entao o CHECK cobre os dois tipos.
-- ==========================================

-- ==========================================
-- Conversas e mensagens
-- ==========================================
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'zapi' CHECK (channel IN ('zapi', 'meta', 'widget')),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  agent TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'closed', 'escalated', 'human')),

  -- Takeover humano: enquanto human_takeover = TRUE, o pipeline persiste a
  -- mensagem mas nao roda agente nenhum.
  human_takeover BOOLEAN DEFAULT FALSE,
  taken_by UUID REFERENCES auth.users(id),
  taken_at TIMESTAMPTZ,
  takeover_expires_at TIMESTAMPTZ,

  metadata JSONB DEFAULT '{}'
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'zapi' CHECK (channel IN ('zapi', 'meta', 'widget')),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  media_type TEXT CHECK (media_type IN ('text', 'image', 'audio', 'document')),
  media_url TEXT,
  agent TEXT,
  tokens_used INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- media_type inclui 'document': o PDF de contrato assinado
-- volta como anexo no WhatsApp (PRD 15.3), e o documento do cliente tambem
-- chega por ai (PRD 12.5).

-- ==========================================
-- Memoria por agente + log de roteamento
-- ==========================================
CREATE TABLE agent_histories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  agent TEXT NOT NULL CHECK (agent IN ('sdr', 'investidor', 'proprietario',
                                       'agendamento', 'closer', 'suporte')),
  messages JSONB NOT NULL DEFAULT '[]',
  token_total INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contact_id, agent)
);

CREATE TABLE routing_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID REFERENCES contacts(id),
  input_message TEXT NOT NULL,
  routed_to TEXT NOT NULL,
  reasoning TEXT,
  profile_snapshot JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- Observabilidade
-- ==========================================
CREATE TABLE message_traces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id),

  routed_to TEXT,
  routing_reasoning TEXT,
  routing_model TEXT,
  routing_tokens INTEGER,

  agent TEXT NOT NULL,
  agent_model TEXT,
  agent_tokens INTEGER,

  tool_calls JSONB DEFAULT '[]',
  prompt_messages JSONB,
  raw_response TEXT,

  total_duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE human_takeover_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL CHECK (action IN ('claim', 'release', 'expire', 'message_sent')),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE webhook_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone TEXT,
  event_type TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- Identidade multi-canal e widget
-- ==========================================
CREATE TABLE contact_identities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('zapi', 'meta', 'widget')),
  external_id TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (channel, external_id)
);

CREATE TABLE widget_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_token TEXT NOT NULL UNIQUE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  site_id TEXT,
  user_agent TEXT,
  ip_hash TEXT,
  visitor_name TEXT,
  visitor_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE widget_sites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id TEXT NOT NULL UNIQUE,
  origin TEXT NOT NULL,
  name TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- Configuracao de canais e de agentes
-- ==========================================
CREATE TABLE channel_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- 'asaas' nao e canal de mensagem: e integracao de cobranca guardada aqui
  -- porque o segredo do webhook
  -- precisa de armazenamento cifrado, e este ja e o lugar que tem isso.
  channel TEXT NOT NULL UNIQUE CHECK (channel IN ('zapi', 'meta', 'widget', 'asaas')),
  is_active BOOLEAN DEFAULT FALSE,

  display_name TEXT,
  phone_id TEXT,
  business_id TEXT,

  -- AES-256-GCM (lib/crypto/encrypt.ts) — nunca texto plano
  access_token_encrypted TEXT,
  app_secret_encrypted TEXT,
  verify_token_encrypted TEXT,
  client_token_encrypted TEXT,

  notes TEXT,
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE agent_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'gpt-4o',
  temperature NUMERIC(3,2) DEFAULT 0.7,
  wa_display_name TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- Blacklist de contato (origem: migration 040)
--
-- Sao colunas em contacts, nao uma tabela `contact_blocklist` como o texto do
-- PRD sugere. Contato bloqueado nao gasta token nenhum: sem Vision, sem
-- transcricao, sem rodada de agente, sem resposta. A mensagem recebida continua
-- sendo gravada para o historico manter registro do que a pessoa mandou.
-- ==========================================
ALTER TABLE contacts
  ADD COLUMN blocked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN blocked_at TIMESTAMPTZ,
  ADD COLUMN blocked_reason TEXT;

CREATE INDEX idx_contacts_blocked ON contacts (blocked) WHERE blocked = TRUE;

-- ==========================================
-- Indices
-- ==========================================
CREATE INDEX idx_conversations_contact ON conversations(contact_id);
CREATE INDEX idx_conversations_channel ON conversations(channel);
CREATE INDEX idx_conversations_last_message ON conversations(last_message_at DESC);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_contact ON messages(contact_id);
CREATE INDEX idx_agent_histories_contact ON agent_histories(contact_id);
CREATE INDEX idx_traces_conversation ON message_traces(conversation_id);
CREATE INDEX idx_contact_identities_contact ON contact_identities(contact_id);
CREATE INDEX idx_widget_sessions_token ON widget_sessions(session_token);
CREATE INDEX idx_widget_sessions_contact ON widget_sessions(contact_id);

-- ==========================================
-- RLS — mesma postura da migration 009: deny-all, acesso via service_role.
-- Logs sao os mais sensiveis: payload cru de webhook pode conter dado pessoal.
-- ==========================================
ALTER TABLE conversations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_histories     ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_traces      ENABLE ROW LEVEL SECURITY;
ALTER TABLE human_takeover_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_identities  ENABLE ROW LEVEL SECURITY;
ALTER TABLE widget_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE widget_sites        ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_configs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_configs       ENABLE ROW LEVEL SECURITY;

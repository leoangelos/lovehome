-- ==========================================
-- 027 — Registro de uso e custo de LLM
-- ==========================================

-- O sistema tem 13 pontos que chamam a OpenAI: cinco agentes, orquestrador,
-- copiloto, resumo, follow-up, tres tipos de embedding, Whisper e Vision.
-- Antes desta tabela, SO os tokens do agente eram registrados
-- (message_traces.agent_tokens). Orquestrador, embeddings, transcricao, visao,
-- copiloto, resumo e follow-up eram invisiveis.
--
-- Um painel montado sobre message_traces mostraria a maior parte do gasto e
-- pareceria completo — que e a forma mais cara de errar um numero de custo.
--
-- Por que `custo_usd NUMERIC(12,6)` e nao centavos, contra a convencao do
-- projeto: a convencao existe para valor de negocio em BRL (aluguel, venda).
-- Aqui o custo de uma chamada e da ordem de USD 0,0002 — em centavos toda
-- linha viraria zero e o total do mes tambem. Seis casas decimais em dolar
-- guardam o valor real; a conversao para BRL, se for necessaria, e decisao de
-- apresentacao.
--
-- `contact_id` e `conversation_id` sao ON DELETE SET NULL, nao CASCADE: apagar
-- um contato a pedido do titular NAO pode apagar o historico de custo, que e
-- dado financeiro da imobiliaria e nao dado pessoal dele. A linha perde o
-- vinculo e o gasto continua contabilizado.
CREATE TABLE llm_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ocorrido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  operacao TEXT NOT NULL CHECK (operacao IN (
    'agente', 'roteamento', 'copiloto', 'resumo', 'followup',
    'embedding_imovel', 'embedding_rag', 'embedding_busca',
    'transcricao', 'visao'
  )),
  modelo TEXT NOT NULL,

  tokens_entrada INTEGER NOT NULL DEFAULT 0,
  tokens_saida INTEGER NOT NULL DEFAULT 0,
  tokens_total INTEGER NOT NULL DEFAULT 0,
  -- Whisper cobra por duracao de audio, nao por token.
  segundos_audio NUMERIC(10,2),

  custo_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  duracao_ms INTEGER,

  agente TEXT,
  canal TEXT,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  profile_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  sucesso BOOLEAN NOT NULL DEFAULT TRUE,
  erro TEXT
);

CREATE INDEX idx_llm_usage_data ON llm_usage(ocorrido_em DESC);
CREATE INDEX idx_llm_usage_operacao ON llm_usage(operacao, ocorrido_em DESC);
CREATE INDEX idx_llm_usage_contato ON llm_usage(contact_id) WHERE contact_id IS NOT NULL;

-- Deny-all: custo e dado de gestao, lido pelo painel via service_role.
ALTER TABLE llm_usage ENABLE ROW LEVEL SECURITY;

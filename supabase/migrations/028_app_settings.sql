-- ==========================================
-- 028 — Configurações da aplicação (linha única)
-- ==========================================

-- Parametros que estavam fixos no codigo e que a operacao precisa ajustar sem
-- deploy: janela de follow-up, horario de atendimento, janela de takeover,
-- debounce, e os dados da imobiliaria que aparecem na vitrine.
--
-- `id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id)` e o truque de linha unica:
-- so o valor TRUE passa no CHECK, entao a tabela nao consegue ter duas linhas.
-- Mais simples do que um `singleton` por convencao, que depende de todo codigo
-- lembrar de filtrar.
--
-- ATENCAO ao acrescentar campo aqui: configuracao que a tela grava e ninguem le
-- e pior do que valor fixo no codigo, porque cria a impressao de que mexer nela
-- muda alguma coisa. Todo campo abaixo tem consumidor, e check:configuracoes
-- verifica isso rodando.
CREATE TABLE app_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),

  -- Dados da imobiliaria (vitrine, contrato, prompts)
  nome_fantasia TEXT NOT NULL DEFAULT 'LoveHome',
  whatsapp_numero TEXT,
  email_contato TEXT,
  endereco TEXT,
  creci TEXT,

  -- Follow-up (lib/followup/runner.ts)
  followup_ativo BOOLEAN NOT NULL DEFAULT TRUE,
  followup_horas INTEGER[] NOT NULL DEFAULT ARRAY[24, 72],
  followup_hora_inicio INTEGER NOT NULL DEFAULT 9 CHECK (followup_hora_inicio BETWEEN 0 AND 23),
  followup_hora_fim INTEGER NOT NULL DEFAULT 20 CHECK (followup_hora_fim BETWEEN 1 AND 24),
  followup_max_por_execucao INTEGER NOT NULL DEFAULT 20 CHECK (followup_max_por_execucao BETWEEN 1 AND 200),

  -- Atendimento humano e agrupamento de mensagens
  takeover_horas INTEGER NOT NULL DEFAULT 48 CHECK (takeover_horas BETWEEN 1 AND 720),
  debounce_segundos INTEGER NOT NULL DEFAULT 20 CHECK (debounce_segundos BETWEEN 0 AND 120),

  atualizado_por UUID REFERENCES auth.users(id),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Janela invertida deixaria o follow-up sem hora nenhuma para rodar.
  CONSTRAINT followup_janela_coerente CHECK (followup_hora_fim > followup_hora_inicio)
);

-- A linha nasce com os defaults: o carregador nunca precisa lidar com ausencia.
INSERT INTO app_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

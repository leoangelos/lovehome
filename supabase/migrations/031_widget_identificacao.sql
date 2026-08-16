-- ==========================================
-- 031 — Telefone do visitante do widget
-- ==========================================

-- Fecha a divida registrada no CLAUDE.md: "widget e WhatsApp nao unificam
-- identidade conversacional". O visitante do site nascia como contato separado
-- porque nao havia telefone, e `resolveContact` unifica pelos ultimos 8 digitos.
--
-- Com o formulario pre-chat coletando nome e telefone, o widget passa a entrar
-- no pipeline com a MESMA chave que o WhatsApp — quem conversou no site e depois
-- escreve no WhatsApp cai no mesmo contato, com a mesma memoria de agente.
--
-- Vale registrar por que isto NAO contraria a §6.3 ("conversar nao exige
-- cadastro"): aquela regra e sobre CADASTRO FORMAL — CPF, endereco, papeis. Nome
-- e telefone sao identidade CONVERSACIONAL, que no WhatsApp o sistema ja recebe
-- de graca na primeira mensagem. Pedir no widget deixa os dois canais
-- equivalentes; nao torna o widget mais exigente que o WhatsApp.

ALTER TABLE widget_sessions
  ADD COLUMN IF NOT EXISTS visitor_phone TEXT;

CREATE INDEX IF NOT EXISTS idx_widget_sessions_phone
  ON widget_sessions(visitor_phone) WHERE visitor_phone IS NOT NULL;

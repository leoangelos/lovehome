-- ==========================================
-- 033 — O que aconteceu dentro de cada chamada paga
--
-- `llm_usage` respondia QUANTO custou. Nao respondia POR QUE custou aquilo, e
-- essa e a pergunta que alguem faz ao ver uma requisicao de 12 mil tokens.
--
-- A resposta nao podia vir de um join: `message_traces` so existe para o
-- caminho de agente, e o gasto se espalha por 13 pontos (embeddings, Whisper,
-- Vision, copiloto, resumo, follow-up) que nao geram trace nenhum. Casar por
-- proximidade de tempo dentro da conversa funcionaria quase sempre, e "quase
-- sempre" num painel de custo significa atribuir o gasto de uma conversa a
-- outra sem ninguem perceber.
--
-- Entao o detalhe e capturado NO MOMENTO da chamada, onde a informacao esta,
-- e guardado junto. Sem join, sem heuristica, sem como divergir.
-- ==========================================

ALTER TABLE llm_usage ADD COLUMN IF NOT EXISTS detalhe JSONB;

COMMENT ON COLUMN llm_usage.detalhe IS
  'O que entrou na chamada: tamanho do historico, tools acionadas, o que foi indexado. Preenchido no ponto da chamada.';

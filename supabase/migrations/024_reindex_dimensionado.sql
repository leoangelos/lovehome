-- ==========================================
-- 024 — REINDEX dimensionado ao volume de dados
-- ==========================================

-- Substitui a funcao da 023, que fazia REINDEX puro. Dois problemas apareceram
-- ao rodar de verdade:
--
-- 1. MEMORIA. Reconstruir o indice com lists=100 pede 61 MB e o
--    maintenance_work_mem da instancia e 32 MB — o REINDEX simplesmente
--    falhava. Resolvido com o SET no proprio corpo da funcao.
--
-- 2. LISTS ERRADO, que e o problema de verdade. A migration 005 criou o indice
--    com lists=100 e a tabela vazia. Com 24 imoveis, isso deixa quase toda
--    particao vazia — e ivfflat so sonda algumas particoes por consulta, entao
--    o recall despenca. Um indice assim nao e neutro: ele responde, ordena, e
--    esconde resultados bons.
--
-- Por isso a rotina passou de "reindexar" para "reconstruir dimensionado ao que
-- existe hoje": lists = ceil(linhas/1000), com piso 1 e teto no numero de
-- linhas. Rodar depois de cada repovoamento (npm run embeddings ja chama).
CREATE OR REPLACE FUNCTION public.reindexar_embeddings_imoveis()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
SET maintenance_work_mem = '128MB'
AS $$
DECLARE
  n INT;
  listas INT;
BEGIN
  SELECT count(*) INTO n FROM properties WHERE embedding IS NOT NULL;

  IF n = 0 THEN
    RETURN 'nenhum embedding gravado — nada a reindexar';
  END IF;

  listas := GREATEST(1, LEAST(n, CEIL(n / 1000.0)::INT));

  EXECUTE 'DROP INDEX IF EXISTS idx_properties_embedding';
  EXECUTE format(
    'CREATE INDEX idx_properties_embedding ON properties USING ivfflat (embedding vector_cosine_ops) WITH (lists = %s)',
    listas
  );

  RETURN format('indice reconstruido com lists=%s para %s embeddings', listas, n);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reindexar_embeddings_imoveis() FROM anon, authenticated;

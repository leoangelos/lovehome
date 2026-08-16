-- ==========================================
-- 023 — REINDEX do indice de embeddings como rotina
-- ==========================================

-- O indice ivfflat de properties.embedding foi criado na migration 005 com a
-- tabela VAZIA. ivfflat aprende centroides a partir dos dados existentes no
-- momento da criacao — sem linhas, ele nasce sem particionamento util e a busca
-- semantica fica ruim de um jeito silencioso: responde, ordena, e ordena mal.
--
-- Isso precisa acontecer toda vez que os embeddings sao repovoados (o seed
-- recria o portfolio inteiro), entao vira funcao em vez de instrucao numa
-- documentacao que alguem tem que lembrar de seguir.
--
-- SECURITY DEFINER porque REINDEX exige ser dono do indice. A funcao nao aceita
-- parametro nenhum e tem o nome do indice fixo no corpo — nao ha superficie
-- para injecao.
CREATE OR REPLACE FUNCTION public.reindexar_embeddings_imoveis()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  REINDEX INDEX idx_properties_embedding;
  RETURN 'idx_properties_embedding reindexado';
END;
$$;

-- Rotina de manutencao: so o service_role chama, do script de backfill.
REVOKE EXECUTE ON FUNCTION public.reindexar_embeddings_imoveis() FROM anon, authenticated;

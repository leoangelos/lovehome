-- ==========================================
-- 034 — Funções em `public` não são chamáveis pela chave anon
--
-- O PostgREST publica toda função de `public` em `/rest/v1/rpc/<nome>`, e o
-- EXECUTE nasce concedido a PUBLIC. A chave anon está no bundle do navegador
-- por desenho (NEXT_PUBLIC_SUPABASE_ANON_KEY) — então qualquer pessoa podia
-- chamar `reindexar_embeddings_imoveis()` e `reindexar_chunks_rag()` em laço:
-- as duas são SECURITY DEFINER, sobem maintenance_work_mem e reconstroem
-- índice. Numa instância pequena isso é negação de serviço com um curl.
--
-- O app chama as quatro pelo service_role, que continua com EXECUTE.
-- `search_path` fixo nas duas de leitura fecha o WARN do linter
-- (function_search_path_mutable).
-- ==========================================

REVOKE EXECUTE ON FUNCTION public.reindexar_embeddings_imoveis() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reindexar_chunks_rag() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reordenar_imoveis_por_similaridade(uuid[], extensions.vector, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.buscar_chunks_rag(extensions.vector, double precision, integer, text) FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.reordenar_imoveis_por_similaridade(uuid[], extensions.vector, integer)
  SET search_path = public, extensions;
ALTER FUNCTION public.buscar_chunks_rag(extensions.vector, double precision, integer, text)
  SET search_path = public, extensions;

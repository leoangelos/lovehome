-- ==========================================
-- 022 — Reordenacao semantica de imoveis (PRD 11.2)
-- ==========================================

-- A regra da 11.2: o filtro estruturado (preco/quartos/regiao/operacao) SEMPRE
-- roda primeiro e define o conjunto elegivel; a busca semantica so REORDENA
-- dentro dele, nunca substitui o filtro. Sem isso o agente passa a oferecer
-- imovel fora da faixa de preco que a pessoa pediu, porque a descricao "casava
-- melhor" com o texto da busca.
--
-- Esta funcao existe com essa assinatura de proposito: ela recebe uma LISTA DE
-- IDS ja filtrados e devolve os mesmos ids ordenados por distancia. Nao tem
-- clausula de filtro nenhuma, entao nao ha como ela alargar o conjunto — a
-- regra vira estrutura em vez de convencao. O filtro continua morando em um
-- lugar so (lib/agents/tools/properties.ts), sem duplicacao em SQL.
--
-- `extensions.vector`, e nao `vector`: a extensao mora no schema `extensions`
-- neste projeto, entao o tipo precisa ser qualificado conforme o search_path.
CREATE OR REPLACE FUNCTION public.reordenar_imoveis_por_similaridade(
  ids UUID[],
  consulta extensions.vector(1536),
  limite INT DEFAULT 5
)
RETURNS TABLE (id UUID, distancia FLOAT)
LANGUAGE sql
STABLE
AS $$
  SELECT p.id, (p.embedding <=> consulta) AS distancia
  FROM properties p
  WHERE p.id = ANY(ids)
    AND p.embedding IS NOT NULL
  ORDER BY p.embedding <=> consulta
  LIMIT limite;
$$;

-- O PostgREST publica funcoes de `public` como /rest/v1/rpc/<nome>. Aqui isso e
-- aceitavel — a funcao nao devolve dado sensivel, so id e distancia, e so
-- alcanca linhas cujos ids o chamador ja conhece. Ainda assim, `anon` nao
-- precisa dela: o painel e o pipeline leem pelo service_role.
REVOKE EXECUTE ON FUNCTION public.reordenar_imoveis_por_similaridade(UUID[], extensions.vector, INT) FROM anon;

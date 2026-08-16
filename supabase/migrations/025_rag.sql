-- ==========================================
-- 025 — RAG institucional (PRD 11.1)
-- ==========================================

-- Conteudo indexado: condicoes de financiamento, documentacao necessaria,
-- glossario (ITBI, escritura, caucao, aviso previo) e politicas da imobiliaria.
-- Usado pelo Suporte e, ocasionalmente, pelo SDR/Proprietario quando surge
-- duvida de processo no meio da conversa.
--
-- O recorte do RAG e por CATEGORIA: o recorte
-- util nao e por turma, e por assunto — quem pergunta de ITBI nao quer receber
-- a politica de visitas.

CREATE TABLE rag_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'geral'
    CHECK (categoria IN ('financiamento', 'documentacao', 'glossario', 'politicas', 'geral')),

  file_name TEXT,
  file_type TEXT,
  file_size INTEGER,
  storage_path TEXT,

  status TEXT NOT NULL DEFAULT 'processando'
    CHECK (status IN ('processando', 'indexado', 'erro')),
  error_message TEXT,
  chunk_count INTEGER DEFAULT 0,

  created_by UUID REFERENCES auth.users(id),
  indexed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE rag_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  token_count INTEGER,
  metadata JSONB DEFAULT '{}',
  embedding extensions.vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rag_chunks_document ON rag_chunks(document_id);
CREATE INDEX idx_rag_documents_categoria ON rag_documents(categoria, status);

-- ATENCAO: NAO existe indice ivfflat aqui, e e de proposito.
--
-- Foi a licao da migration 005: indice ivfflat criado com a tabela vazia nasce
-- sem centroides uteis e a busca fica ruim em silencio. Pior, ivfflat e uma
-- busca APROXIMADA — abaixo de alguns milhares de chunks a varredura sequencial
-- e mais rapida E exata. Criar o indice cedo demais troca resultado correto por
-- resultado aproximado sem ganho nenhum.
--
-- Quando o volume justificar, `reindexar_chunks_rag()` cria o indice
-- dimensionado ao que existir (mesma rotina de properties).

-- ------------------------------------------------------------------
-- Busca semantica
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buscar_chunks_rag(
  consulta extensions.vector(1536),
  limiar FLOAT DEFAULT 0.5,
  quantidade INT DEFAULT 5,
  filtro_categoria TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  documento TEXT,
  categoria TEXT,
  similaridade FLOAT,
  metadata JSONB
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    c.id,
    c.content,
    d.title AS documento,
    d.categoria,
    1 - (c.embedding <=> consulta) AS similaridade,
    c.metadata
  FROM rag_chunks c
  JOIN rag_documents d ON d.id = c.document_id
  WHERE c.embedding IS NOT NULL
    AND d.status = 'indexado'
    AND (filtro_categoria IS NULL OR d.categoria = filtro_categoria)
    AND 1 - (c.embedding <=> consulta) > limiar
  ORDER BY c.embedding <=> consulta
  LIMIT quantidade;
$$;

REVOKE EXECUTE ON FUNCTION public.buscar_chunks_rag(extensions.vector, FLOAT, INT, TEXT) FROM anon;

-- ------------------------------------------------------------------
-- Manutencao do indice, dimensionada ao volume (ver 024)
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reindexar_chunks_rag()
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
  SELECT count(*) INTO n FROM rag_chunks WHERE embedding IS NOT NULL;

  -- Abaixo deste volume a varredura sequencial e exata e mais rapida. Manter o
  -- indice fora do caminho e a decisao certa, nao uma pendencia.
  IF n < 2000 THEN
    EXECUTE 'DROP INDEX IF EXISTS idx_rag_chunks_embedding';
    RETURN format('%s chunks — varredura sequencial (exata) e melhor; nenhum indice criado', n);
  END IF;

  listas := GREATEST(1, LEAST(n, CEIL(n / 1000.0)::INT));

  EXECUTE 'DROP INDEX IF EXISTS idx_rag_chunks_embedding';
  EXECUTE format(
    'CREATE INDEX idx_rag_chunks_embedding ON rag_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = %s)',
    listas
  );

  RETURN format('indice criado com lists=%s para %s chunks', listas, n);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reindexar_chunks_rag() FROM anon, authenticated;

-- ------------------------------------------------------------------
-- RLS deny-all: o painel e o pipeline leem pelo service_role.
-- Material institucional pode conter politica interna e tabela de comissao —
-- nao e conteudo de vitrine.
-- ------------------------------------------------------------------
ALTER TABLE rag_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag_chunks    ENABLE ROW LEVEL SECURITY;

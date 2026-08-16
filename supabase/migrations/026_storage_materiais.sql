-- ==========================================
-- Migration 026: Bucket dos materiais institucionais (RAG)
--
-- PRIVADO. Material institucional nao e conteudo de vitrine: politica interna,
-- tabela de comissao e regra de excecao entram aqui junto com o glossario. O
-- que o cliente ve e a RESPOSTA do agente, redigida a partir do trecho — nunca
-- o arquivo.
--
-- 20 MB: PDF de manual com imagem passa dos 10 MB do bucket de documentos.
-- Tipos aceitos batem com lib/rag/extrair.ts — o que o extrator nao le, o
-- bucket nao guarda, para nao existir material que sobe e nunca indexa.
-- ==========================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'materiais',
  'materiais',
  FALSE,
  20971520,  -- 20 MB
  ARRAY['application/pdf', 'text/plain', 'text/markdown']
)
ON CONFLICT (id) DO NOTHING;

-- Sem policy: nem anon nem authenticated leem. So o service_role.

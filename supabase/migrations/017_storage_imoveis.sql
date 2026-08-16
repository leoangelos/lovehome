-- ==========================================
-- Migration 017: Bucket de fotos de imóvel
--
-- Público para leitura porque as fotos aparecem na vitrine, que não tem login —
-- servir por URL assinada exigiria assinar cada foto a cada visita, sem ganho:
-- o conteúdo é justamente o que queremos que circule.
--
-- Escrita SÓ pelo service_role. O upload passa por /api/public/property-listing,
-- que valida token, tipo e tamanho antes de gravar. Deixar `anon` escrever
-- transformaria o bucket em hospedagem aberta de arquivo.
-- ==========================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'imoveis',
  'imoveis',
  TRUE,
  5242880,  -- 5 MB por arquivo; foto de celular cabe, vídeo não
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Leitura pública das fotos.
CREATE POLICY "fotos de imovel sao publicas"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'imoveis');

-- Sem policy de INSERT/UPDATE/DELETE: anon e authenticated ficam de fora, e o
-- service_role ignora RLS por padrão.

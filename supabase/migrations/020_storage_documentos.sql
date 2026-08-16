-- ==========================================
-- Migration 020: Bucket de documentos do cliente
--
-- PRIVADO, como o de contratos: aqui entram RG, CNH, comprovante de renda e de
-- residência. É o material mais sensível que o sistema guarda depois do CPF.
--
-- Existe porque a URL de mídia do Z-API EXPIRA. Sem baixar e guardar no momento
-- em que a mensagem chega, o documento que a pessoa enviou some — e ela teria
-- de reenviar, ou o negócio trava na conferência com um link morto.
-- ==========================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documentos',
  'documentos',
  FALSE,
  10485760,  -- 10 MB: foto de RG e PDF de comprovante cabem
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Sem policy: nem anon nem authenticated leem. Só o service_role, e apenas
-- para gerar URL assinada de vida curta no painel.

-- ==========================================
-- Migration 038: via assinada recebida pelo WhatsApp + documento anexado pelo painel.
--
-- 1. O contrato assinado devolvido pelo cliente no WhatsApp caia na fila de
--    documentos como "outro" e o corretor tinha que baixar e subir de novo em
--    Contratos. Agora o PDF que chega de um negocio 'aprovado' com contrato
--    gerado e sem via assinada vira CANDIDATO (signed_candidate_*): fica no
--    bucket `contratos`, aparece no cartao do negocio para uma pessoa
--    confirmar (ou dizer "nao e o contrato"). contract_signed_at continua
--    sendo gravado so na confirmacao humana.
--
-- 2. documents.received_via diz por onde o arquivo entrou: 'whatsapp' (webhook)
--    ou 'painel' (corretor anexou porque o cliente mandou por e-mail ou
--    entregou em maos). E o que deixa o agente saber que nao precisa pedir.
-- ==========================================

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS signed_candidate_url TEXT,
  ADD COLUMN IF NOT EXISTS signed_candidate_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signed_candidate_via TEXT
    CHECK (signed_candidate_via IN ('whatsapp', 'email'));

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS received_via TEXT
    CHECK (received_via IN ('whatsapp', 'painel', 'email'));

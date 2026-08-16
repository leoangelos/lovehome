-- ==========================================
-- Migration 018: Checklist de documentos do negócio
--
-- `documents` guarda ARQUIVO recebido — storage_path é NOT NULL, e criar linha
-- para documento ainda não enviado exigiria afrouxar isso e inventar um estado
-- "pedido mas inexistente" que polui a fila de revisão.
--
-- A lista do que foi PEDIDO é atributo do negócio: muda conforme o tipo
-- (locação pede comprovante de residência; venda à vista dispensa aprovação de
-- financiamento). Comparar o pedido com o recebido dá o que falta, sem
-- linha-fantasma em lugar nenhum.
-- ==========================================

ALTER TABLE deals
  ADD COLUMN documentos_solicitados JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN documentos_solicitados_em TIMESTAMPTZ;

COMMENT ON COLUMN deals.documentos_solicitados IS
  'Tipos de documento pedidos ao cliente, nos mesmos valores do CHECK de documents.type';

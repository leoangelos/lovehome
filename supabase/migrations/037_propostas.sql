-- ==========================================
-- Migration 037: proposta nao trava o imovel; fila por ordem de chegada.
--
-- O create_deal reservava o imovel no momento da proposta — qualquer oferta,
-- por mais baixa, tirava o imovel da vitrine antes de o proprietario saber.
-- Agora o negocio nasce como 'proposta' (imovel continua 'disponivel'); so o
-- ACEITE no painel reserva o imovel e abre a coleta de documentos. Varias
-- pessoas podem ter proposta no mesmo imovel ao mesmo tempo — e a fila.
--
-- proposta_avaliada_em marca quando uma proposta saiu da fila (aceita ou
-- recusada). E o que sustenta a regra de ordenacao: enquanto NENHUMA proposta
-- do imovel foi avaliada, a de maior valor aparece primeiro; depois da
-- primeira avaliacao, vale a ordem de chegada (created_at).
--
-- recusa_motivo guarda por que uma proposta foi recusada ou um negocio aceito
-- foi desfeito (financiamento negado, desistencia) — e o que o cliente recebe.
-- ==========================================

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_status_check;
ALTER TABLE deals ADD CONSTRAINT deals_status_check
  CHECK (status IN ('proposta', 'em_aprovacao', 'aprovado', 'ativo',
                    'encerramento_solicitado', 'encerrado', 'concluido', 'cancelado'));

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS proposta_avaliada_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recusa_motivo TEXT;

-- A fila e consultada por imovel; parcial porque so proposta pendente importa.
CREATE INDEX IF NOT EXISTS idx_deals_propostas
  ON deals(property_id, created_at)
  WHERE status = 'proposta';

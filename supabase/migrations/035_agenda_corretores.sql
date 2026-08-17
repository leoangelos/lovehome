-- ==========================================
-- Migration 035: agenda editavel do corretor + sem choque de horario
--
-- 1. Intervalo de almoco na janela recorrente. Uma coluna e nao "duas janelas
--    por dia" porque e assim que a tela edita e que o corretor pensa: "atendo
--    das 9 as 18, almoco meio-dia a uma". Uma linha por dia da semana.
--
-- 2. Indices unicos parciais em property_visits para visitas ativas: por
--    (broker_id, scheduled_at) e por (property_id, scheduled_at). O segundo e
--    o que impede duas pessoas no mesmo imovel no mesmo horario com corretores
--    diferentes — a agenda por corretor sozinha nao enxerga isso.
--
--    O create_visit ja recheca os dois conflitos antes de gravar, mas duas
--    confirmacoes simultaneas passam pela checagem juntas e as duas gravam.
--    Com o indice, a segunda falha com 23505 e o agente oferece outro horario.
--    As janelas sao de 1h alinhadas na hora cheia, entao "mesmo instante" e o
--    que define choque.
-- ==========================================

ALTER TABLE broker_availability
  ADD COLUMN IF NOT EXISTS break_start TIME,
  ADD COLUMN IF NOT EXISTS break_end TIME;

ALTER TABLE broker_availability
  DROP CONSTRAINT IF EXISTS broker_availability_break_valida;

ALTER TABLE broker_availability
  ADD CONSTRAINT broker_availability_break_valida CHECK (
    (break_start IS NULL AND break_end IS NULL)
    OR (
      break_start IS NOT NULL AND break_end IS NOT NULL
      AND break_start < break_end
      AND break_start >= start_time
      AND break_end <= end_time
    )
  );

-- Um corretor, um horario. Parcial: visita cancelada/realizada libera o slot.
CREATE UNIQUE INDEX IF NOT EXISTS uq_property_visits_broker_slot
  ON property_visits(broker_id, scheduled_at)
  WHERE status IN ('agendada', 'confirmada');

-- Um imovel, uma visita por vez — com qualquer corretor.
CREATE UNIQUE INDEX IF NOT EXISTS uq_property_visits_property_slot
  ON property_visits(property_id, scheduled_at)
  WHERE status IN ('agendada', 'confirmada');

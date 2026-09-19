-- Orden de imputación real, según el histórico de observaciones de pago del
-- Excel de la cooperativa: los gastos puntuales (p. ej. "GASTOS DE
-- NOTIFICACIÓN") se cobran junto con o antes de completar la cuota
-- ("SALDA $91.800 CUOTA 4 + $100.000 DE GASTOS DE NOTIFICACIÓN"), no después
-- del capital. El esquema ya tenía el concepto GASTOS en payment_allocations
-- pero nunca se usaba porque no había manera de saber cuánto de un ajuste
-- (credit_adjustments) seguía pendiente de cobro.

ALTER TABLE credit_adjustments
  ADD COLUMN paid_amount DECIMAL(16,2) NOT NULL DEFAULT 0;

ALTER TABLE payment_allocations
  ALTER COLUMN installment_id DROP NOT NULL,
  ADD COLUMN adjustment_id INT NULL REFERENCES credit_adjustments(id);

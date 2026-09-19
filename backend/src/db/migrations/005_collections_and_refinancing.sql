-- Hallazgos de la revisión del Excel real de la cooperativa (COOMULNISSI):
-- gestor/vendedor asignado por crédito, compromisos de pago, ajustes
-- (interés por cambio de fecha, descuentos autorizados) y refinanciación.

ALTER TABLE credits
  ADD COLUMN assigned_collector_id INT NULL REFERENCES users(id),
  ADD COLUMN assigned_seller_id INT NULL REFERENCES users(id),
  ADD COLUMN refinanced_from_credit_id INT NULL REFERENCES credits(id),
  ADD COLUMN refinanced_to_credit_id INT NULL REFERENCES credits(id);

ALTER TABLE credits DROP CONSTRAINT chk_credits_status;
ALTER TABLE credits ADD CONSTRAINT chk_credits_status
  CHECK (status IN ('VIGENTE','EN_MORA','PAGADO','ANULADO','REFINANCIADO'));

-- Compromisos de pago (FECHAS DE COMPROMISOS en el Excel original)
ALTER TABLE collection_actions
  ADD COLUMN promise_date DATE NULL,
  ADD COLUMN promise_status VARCHAR(20) NULL CHECK (promise_status IN ('PENDIENTE','CUMPLIDA','INCUMPLIDA'));

-- Ajustes manuales por crédito: interés por cambio de fecha, descuentos, etc.
-- (VALOR INTERES POR CAMBIO DE FECHA / VALOR DESCONTADO en el Excel original)
CREATE TABLE IF NOT EXISTS credit_adjustments (
  id SERIAL PRIMARY KEY,
  credit_id INT NOT NULL REFERENCES credits(id),
  installment_id INT NULL REFERENCES credit_schedule_installments(id),
  type VARCHAR(30) NOT NULL CHECK (type IN ('INTERES_CAMBIO_FECHA','DESCUENTO','GASTO_NOTIFICACION','OTRO')),
  amount DECIMAL(16,2) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  approved_by INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_credits_collector ON credits (assigned_collector_id);
CREATE INDEX idx_collection_actions_promise ON collection_actions (promise_date);

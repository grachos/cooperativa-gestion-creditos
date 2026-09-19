-- Hallazgos de la revisión del Excel real de la cooperativa (COOMULNISSI):
-- gestor/vendedor asignado por crédito, compromisos de pago, ajustes
-- (interés por cambio de fecha, descuentos autorizados) y refinanciación.

ALTER TABLE credits
  ADD COLUMN assigned_collector_id INT NULL AFTER titular_society_id,
  ADD COLUMN assigned_seller_id INT NULL AFTER assigned_collector_id,
  ADD COLUMN refinanced_from_credit_id INT NULL AFTER assigned_seller_id,
  ADD COLUMN refinanced_to_credit_id INT NULL AFTER refinanced_from_credit_id,
  ADD CONSTRAINT fk_credits_collector FOREIGN KEY (assigned_collector_id) REFERENCES users(id),
  ADD CONSTRAINT fk_credits_seller FOREIGN KEY (assigned_seller_id) REFERENCES users(id),
  ADD CONSTRAINT fk_credits_refinanced_from FOREIGN KEY (refinanced_from_credit_id) REFERENCES credits(id),
  ADD CONSTRAINT fk_credits_refinanced_to FOREIGN KEY (refinanced_to_credit_id) REFERENCES credits(id);

ALTER TABLE credits
  MODIFY COLUMN status ENUM('VIGENTE','EN_MORA','PAGADO','ANULADO','REFINANCIADO') NOT NULL DEFAULT 'VIGENTE';

-- Compromisos de pago (FECHAS DE COMPROMISOS en el Excel original)
ALTER TABLE collection_actions
  ADD COLUMN promise_date DATE NULL AFTER description,
  ADD COLUMN promise_status ENUM('PENDIENTE','CUMPLIDA','INCUMPLIDA') NULL AFTER promise_date;

-- Ajustes manuales por crédito: interés por cambio de fecha, descuentos, etc.
-- (VALOR INTERES POR CAMBIO DE FECHA / VALOR DESCONTADO en el Excel original)
CREATE TABLE IF NOT EXISTS credit_adjustments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_id INT NOT NULL,
  installment_id INT NULL,
  type ENUM('INTERES_CAMBIO_FECHA','DESCUENTO','GASTO_NOTIFICACION','OTRO') NOT NULL,
  amount DECIMAL(16,2) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  approved_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (credit_id) REFERENCES credits(id),
  FOREIGN KEY (installment_id) REFERENCES credit_schedule_installments(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

CREATE INDEX idx_credits_collector ON credits (assigned_collector_id);
CREATE INDEX idx_collection_actions_promise ON collection_actions (promise_date);

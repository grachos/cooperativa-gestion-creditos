-- Pagos, imputación, mora, alertas, parámetros, auditoría e integración contable

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_id INT NOT NULL,
  received_date DATE NOT NULL,
  effective_date DATE NULL,
  amount DECIMAL(16,2) NOT NULL,
  payment_method VARCHAR(60) NOT NULL,
  reference VARCHAR(120) NULL,
  notes VARCHAR(255) NULL,
  status ENUM('CONFIRMADO','REVERSADO') NOT NULL DEFAULT 'CONFIRMADO',
  reversal_reason VARCHAR(255) NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (credit_id) REFERENCES credits(id)
);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payment_id INT NOT NULL,
  installment_id INT NOT NULL,
  concept ENUM('GASTOS','MORA','INTERES','CAPITAL') NOT NULL,
  amount DECIMAL(16,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
  FOREIGN KEY (installment_id) REFERENCES credit_schedule_installments(id)
);

CREATE TABLE IF NOT EXISTS delinquency_calculations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_id INT NOT NULL,
  installment_id INT NOT NULL,
  calculation_date DATE NOT NULL,
  overdue_days INT NOT NULL,
  base_amount DECIMAL(16,2) NOT NULL,
  rate_or_value DECIMAL(10,4) NOT NULL,
  policy_version VARCHAR(40) NOT NULL,
  result_amount DECIMAL(16,2) NOT NULL,
  generated_by VARCHAR(40) NOT NULL DEFAULT 'SYSTEM',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (credit_id) REFERENCES credits(id),
  FOREIGN KEY (installment_id) REFERENCES credit_schedule_installments(id)
);

CREATE TABLE IF NOT EXISTS collection_actions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_id INT NOT NULL,
  action_type ENUM('NOTIFICACION','GESTION_COBRO','PREPARACION_JURIDICA') NOT NULL,
  description VARCHAR(255) NULL,
  status ENUM('PENDIENTE','EN_PROCESO','COMPLETADA') NOT NULL DEFAULT 'PENDIENTE',
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (credit_id) REFERENCES credits(id)
);

CREATE TABLE IF NOT EXISTS alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_id INT NULL,
  installment_id INT NULL,
  type VARCHAR(60) NOT NULL,
  priority ENUM('BAJA','MEDIA','ALTA') NOT NULL DEFAULT 'MEDIA',
  message VARCHAR(255) NOT NULL,
  status ENUM('ABIERTA','ATENDIDA','DESCARTADA') NOT NULL DEFAULT 'ABIERTA',
  assigned_to INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  FOREIGN KEY (credit_id) REFERENCES credits(id),
  FOREIGN KEY (installment_id) REFERENCES credit_schedule_installments(id)
);

CREATE TABLE IF NOT EXISTS parameters (
  id INT AUTO_INCREMENT PRIMARY KEY,
  `key` VARCHAR(80) NOT NULL UNIQUE,
  value JSON NOT NULL,
  description VARCHAR(255) NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entity VARCHAR(60) NOT NULL,
  entity_id VARCHAR(40) NOT NULL,
  action VARCHAR(60) NOT NULL,
  old_value JSON NULL,
  new_value JSON NULL,
  user_id INT NULL,
  ip_address VARCHAR(64) NULL,
  reason VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS integration_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(60) NOT NULL,
  idempotency_key VARCHAR(120) NOT NULL UNIQUE,
  payload JSON NOT NULL,
  status ENUM('PENDIENTE','ENVIADO','CONFIRMADO','FALLIDO','REINTENTANDO') NOT NULL DEFAULT 'PENDIENTE',
  attempts INT NOT NULL DEFAULT 0,
  last_error VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS integration_attempts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  integration_event_id INT NOT NULL,
  attempt_number INT NOT NULL,
  response_summary VARCHAR(500) NULL,
  success BOOLEAN NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (integration_event_id) REFERENCES integration_events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(160) NOT NULL,
  body VARCHAR(500) NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_payments_credit ON payments (credit_id);
CREATE INDEX idx_alerts_status ON alerts (status, priority);
CREATE INDEX idx_integration_events_status ON integration_events (status);

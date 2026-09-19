-- Pagos, imputación, mora, alertas, parámetros, auditoría e integración contable

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  credit_id INT NOT NULL REFERENCES credits(id),
  received_date DATE NOT NULL,
  effective_date DATE NULL,
  amount DECIMAL(16,2) NOT NULL,
  payment_method VARCHAR(60) NOT NULL,
  reference VARCHAR(120) NULL,
  notes VARCHAR(255) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMADO' CHECK (status IN ('CONFIRMADO','REVERSADO')),
  reversal_reason VARCHAR(255) NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id SERIAL PRIMARY KEY,
  payment_id INT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  installment_id INT NOT NULL REFERENCES credit_schedule_installments(id),
  concept VARCHAR(20) NOT NULL CHECK (concept IN ('GASTOS','MORA','INTERES','CAPITAL')),
  amount DECIMAL(16,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delinquency_calculations (
  id SERIAL PRIMARY KEY,
  credit_id INT NOT NULL REFERENCES credits(id),
  installment_id INT NOT NULL REFERENCES credit_schedule_installments(id),
  calculation_date DATE NOT NULL,
  overdue_days INT NOT NULL,
  base_amount DECIMAL(16,2) NOT NULL,
  rate_or_value DECIMAL(10,4) NOT NULL,
  policy_version VARCHAR(40) NOT NULL,
  result_amount DECIMAL(16,2) NOT NULL,
  generated_by VARCHAR(40) NOT NULL DEFAULT 'SYSTEM',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collection_actions (
  id SERIAL PRIMARY KEY,
  credit_id INT NOT NULL REFERENCES credits(id),
  action_type VARCHAR(30) NOT NULL CHECK (action_type IN ('NOTIFICACION','GESTION_COBRO','PREPARACION_JURIDICA')),
  description VARCHAR(255) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' CHECK (status IN ('PENDIENTE','EN_PROCESO','COMPLETADA')),
  created_by INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  credit_id INT NULL REFERENCES credits(id),
  installment_id INT NULL REFERENCES credit_schedule_installments(id),
  type VARCHAR(60) NOT NULL,
  priority VARCHAR(10) NOT NULL DEFAULT 'MEDIA' CHECK (priority IN ('BAJA','MEDIA','ALTA')),
  message VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ABIERTA' CHECK (status IN ('ABIERTA','ATENDIDA','DESCARTADA')),
  assigned_to INT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS parameters (
  id SERIAL PRIMARY KEY,
  "key" VARCHAR(80) NOT NULL UNIQUE,
  value JSONB NOT NULL,
  description VARCHAR(255) NULL,
  updated_by INT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_parameters_updated_at BEFORE UPDATE ON parameters
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  entity VARCHAR(60) NOT NULL,
  entity_id VARCHAR(40) NOT NULL,
  action VARCHAR(60) NOT NULL,
  old_value JSONB NULL,
  new_value JSONB NULL,
  user_id INT NULL,
  ip_address VARCHAR(64) NULL,
  reason VARCHAR(255) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_events (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(60) NOT NULL,
  idempotency_key VARCHAR(120) NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
    CHECK (status IN ('PENDIENTE','ENVIADO','CONFIRMADO','FALLIDO','REINTENTANDO')),
  attempts INT NOT NULL DEFAULT 0,
  last_error VARCHAR(500) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_integration_events_updated_at BEFORE UPDATE ON integration_events
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS integration_attempts (
  id SERIAL PRIMARY KEY,
  integration_event_id INT NOT NULL REFERENCES integration_events(id) ON DELETE CASCADE,
  attempt_number INT NOT NULL,
  response_summary VARCHAR(500) NULL,
  success BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(160) NOT NULL,
  body VARCHAR(500) NULL,
  read_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_credit ON payments (credit_id);
CREATE INDEX idx_alerts_status ON alerts (status, priority);
CREATE INDEX idx_integration_events_status ON integration_events (status);

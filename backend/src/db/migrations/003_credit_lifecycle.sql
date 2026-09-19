-- Solicitudes, aprobación, desembolso, créditos y cronograma

CREATE TABLE IF NOT EXISTS credit_applications (
  id SERIAL PRIMARY KEY,
  titular_associate_id INT NULL REFERENCES associates(id),
  titular_society_id INT NULL REFERENCES societies(id),
  requested_amount DECIMAL(16,2) NOT NULL,
  term_value INT NOT NULL,
  term_unit VARCHAR(10) NOT NULL DEFAULT 'MESES' CHECK (term_unit IN ('MESES')),
  interest_rate DECIMAL(8,4) NOT NULL,
  rate_type VARCHAR(20) NOT NULL DEFAULT 'NOMINAL_MENSUAL' CHECK (rate_type IN ('NOMINAL_MENSUAL','EFECTIVA_ANUAL')),
  payment_frequency VARCHAR(10) NOT NULL DEFAULT 'MENSUAL' CHECK (payment_frequency IN ('MENSUAL')),
  expected_disbursement_date DATE NULL,
  due_day_rule VARCHAR(60) NULL,
  purpose VARCHAR(255) NULL,
  notes TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'BORRADOR'
    CHECK (status IN ('BORRADOR','RADICADA','EN_REVISION','APROBADA','RECHAZADA','CANCELADA','DESEMBOLSADA')),
  rejection_reason VARCHAR(255) NULL,
  created_by INT NOT NULL,
  decided_by INT NULL,
  decided_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_credit_applications_updated_at BEFORE UPDATE ON credit_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS credit_application_status_history (
  id SERIAL PRIMARY KEY,
  credit_application_id INT NOT NULL REFERENCES credit_applications(id) ON DELETE CASCADE,
  from_status VARCHAR(30) NULL,
  to_status VARCHAR(30) NOT NULL,
  reason VARCHAR(255) NULL,
  user_id INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credits (
  id SERIAL PRIMARY KEY,
  credit_number VARCHAR(30) NOT NULL UNIQUE,
  credit_application_id INT NOT NULL REFERENCES credit_applications(id),
  titular_associate_id INT NULL REFERENCES associates(id),
  titular_society_id INT NULL REFERENCES societies(id),
  disbursed_amount DECIMAL(16,2) NOT NULL,
  principal_balance DECIMAL(16,2) NOT NULL,
  interest_rate DECIMAL(8,4) NOT NULL,
  rate_type VARCHAR(20) NOT NULL CHECK (rate_type IN ('NOMINAL_MENSUAL','EFECTIVA_ANUAL')),
  term_value INT NOT NULL,
  payment_frequency VARCHAR(10) NOT NULL DEFAULT 'MENSUAL' CHECK (payment_frequency IN ('MENSUAL')),
  disbursement_date DATE NOT NULL,
  first_installment_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'VIGENTE' CONSTRAINT chk_credits_status CHECK (status IN ('VIGENTE','EN_MORA','PAGADO','ANULADO')),
  delinquency_policy_snapshot JSONB NULL,
  parameters_snapshot JSONB NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_credits_updated_at BEFORE UPDATE ON credits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS credit_schedule_installments (
  id SERIAL PRIMARY KEY,
  credit_id INT NOT NULL REFERENCES credits(id) ON DELETE CASCADE,
  installment_number INT NOT NULL,
  due_date DATE NOT NULL,
  principal_due DECIMAL(16,2) NOT NULL,
  interest_due DECIMAL(16,2) NOT NULL,
  other_due DECIMAL(16,2) NOT NULL DEFAULT 0,
  total_due DECIMAL(16,2) NOT NULL,
  principal_paid DECIMAL(16,2) NOT NULL DEFAULT 0,
  interest_paid DECIMAL(16,2) NOT NULL DEFAULT 0,
  late_fee_paid DECIMAL(16,2) NOT NULL DEFAULT 0,
  other_paid DECIMAL(16,2) NOT NULL DEFAULT 0,
  balance DECIMAL(16,2) NOT NULL,
  overdue_days INT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
    CHECK (status IN ('PENDIENTE','PAGADA','PARCIAL','VENCIDA','EN_MORA','ANULADA')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_credit_installment UNIQUE (credit_id, installment_number)
);
CREATE TRIGGER trg_installments_updated_at BEFORE UPDATE ON credit_schedule_installments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_installments_due_date ON credit_schedule_installments (due_date);
CREATE INDEX idx_installments_status ON credit_schedule_installments (status);
CREATE INDEX idx_credits_status ON credits (status);
CREATE INDEX idx_applications_status ON credit_applications (status);

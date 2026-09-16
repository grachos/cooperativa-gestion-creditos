-- Solicitudes, aprobación, desembolso, créditos y cronograma

CREATE TABLE IF NOT EXISTS credit_applications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  titular_associate_id INT NULL,
  titular_society_id INT NULL,
  requested_amount DECIMAL(16,2) NOT NULL,
  term_value INT NOT NULL,
  term_unit ENUM('MESES') NOT NULL DEFAULT 'MESES',
  interest_rate DECIMAL(8,4) NOT NULL,
  rate_type ENUM('NOMINAL_MENSUAL','EFECTIVA_ANUAL') NOT NULL DEFAULT 'NOMINAL_MENSUAL',
  payment_frequency ENUM('MENSUAL') NOT NULL DEFAULT 'MENSUAL',
  expected_disbursement_date DATE NULL,
  due_day_rule VARCHAR(60) NULL,
  purpose VARCHAR(255) NULL,
  notes TEXT NULL,
  status ENUM('BORRADOR','RADICADA','EN_REVISION','APROBADA','RECHAZADA','CANCELADA','DESEMBOLSADA') NOT NULL DEFAULT 'BORRADOR',
  rejection_reason VARCHAR(255) NULL,
  created_by INT NOT NULL,
  decided_by INT NULL,
  decided_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (titular_associate_id) REFERENCES associates(id),
  FOREIGN KEY (titular_society_id) REFERENCES societies(id)
);

CREATE TABLE IF NOT EXISTS credit_application_status_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_application_id INT NOT NULL,
  from_status VARCHAR(30) NULL,
  to_status VARCHAR(30) NOT NULL,
  reason VARCHAR(255) NULL,
  user_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (credit_application_id) REFERENCES credit_applications(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS credits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_number VARCHAR(30) NOT NULL UNIQUE,
  credit_application_id INT NOT NULL,
  titular_associate_id INT NULL,
  titular_society_id INT NULL,
  disbursed_amount DECIMAL(16,2) NOT NULL,
  principal_balance DECIMAL(16,2) NOT NULL,
  interest_rate DECIMAL(8,4) NOT NULL,
  rate_type ENUM('NOMINAL_MENSUAL','EFECTIVA_ANUAL') NOT NULL,
  term_value INT NOT NULL,
  payment_frequency ENUM('MENSUAL') NOT NULL DEFAULT 'MENSUAL',
  disbursement_date DATE NOT NULL,
  first_installment_date DATE NOT NULL,
  status ENUM('VIGENTE','EN_MORA','PAGADO','ANULADO') NOT NULL DEFAULT 'VIGENTE',
  delinquency_policy_snapshot JSON NULL,
  parameters_snapshot JSON NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (credit_application_id) REFERENCES credit_applications(id),
  FOREIGN KEY (titular_associate_id) REFERENCES associates(id),
  FOREIGN KEY (titular_society_id) REFERENCES societies(id)
);

CREATE TABLE IF NOT EXISTS credit_schedule_installments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_id INT NOT NULL,
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
  status ENUM('PENDIENTE','PAGADA','PARCIAL','VENCIDA','EN_MORA','ANULADA') NOT NULL DEFAULT 'PENDIENTE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (credit_id) REFERENCES credits(id) ON DELETE CASCADE,
  UNIQUE KEY uq_credit_installment (credit_id, installment_number)
);

CREATE INDEX idx_installments_due_date ON credit_schedule_installments (due_date);
CREATE INDEX idx_installments_status ON credit_schedule_installments (status);
CREATE INDEX idx_credits_status ON credits (status);
CREATE INDEX idx_applications_status ON credit_applications (status);

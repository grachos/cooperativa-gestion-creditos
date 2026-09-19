-- Asociados (personas naturales), sociedades y participantes de crédito

CREATE TABLE IF NOT EXISTS associates (
  id SERIAL PRIMARY KEY,
  id_type VARCHAR(20) NOT NULL,
  id_number VARCHAR(40) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  birth_date DATE NULL,
  phone VARCHAR(40) NULL,
  email VARCHAR(160) NULL,
  address VARCHAR(255) NULL,
  municipality VARCHAR(100) NULL,
  department VARCHAR(100) NULL,
  country VARCHAR(100) NOT NULL DEFAULT 'Colombia',
  income_info VARCHAR(255) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVO' CHECK (status IN ('ACTIVO','INACTIVO')),
  notes TEXT NULL,
  data_consent BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_associate_identification UNIQUE (id_type, id_number)
);
CREATE TRIGGER trg_associates_updated_at BEFORE UPDATE ON associates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS societies (
  id SERIAL PRIMARY KEY,
  tax_id_type VARCHAR(20) NOT NULL,
  tax_id_number VARCHAR(40) NOT NULL,
  legal_name VARCHAR(160) NOT NULL,
  trade_name VARCHAR(160) NULL,
  legal_representative_associate_id INT NULL REFERENCES associates(id),
  phone VARCHAR(40) NULL,
  email VARCHAR(160) NULL,
  address VARCHAR(255) NULL,
  economic_activity VARCHAR(160) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVA' CHECK (status IN ('ACTIVA','INACTIVA')),
  notes TEXT NULL,
  created_by INT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_society_tax_id UNIQUE (tax_id_type, tax_id_number)
);
CREATE TRIGGER trg_societies_updated_at BEFORE UPDATE ON societies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Relación genérica de participantes de un crédito: titular, codeudor, avalista
CREATE TABLE IF NOT EXISTS credit_participants (
  id SERIAL PRIMARY KEY,
  credit_application_id INT NULL,
  credit_id INT NULL,
  associate_id INT NULL REFERENCES associates(id),
  society_id INT NULL REFERENCES societies(id),
  role VARCHAR(20) NOT NULL CHECK (role IN ('TITULAR','CODEUDOR','AVALISTA')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_associates_names ON associates (last_name, first_name);
CREATE INDEX idx_credit_participants_app ON credit_participants (credit_application_id);
CREATE INDEX idx_credit_participants_credit ON credit_participants (credit_id);

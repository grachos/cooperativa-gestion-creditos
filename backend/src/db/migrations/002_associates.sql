-- Asociados (personas naturales), sociedades y participantes de crédito

CREATE TABLE IF NOT EXISTS associates (
  id INT AUTO_INCREMENT PRIMARY KEY,
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
  status ENUM('ACTIVO','INACTIVO') NOT NULL DEFAULT 'ACTIVO',
  notes TEXT NULL,
  data_consent BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_associate_identification (id_type, id_number)
);

CREATE TABLE IF NOT EXISTS societies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tax_id_type VARCHAR(20) NOT NULL,
  tax_id_number VARCHAR(40) NOT NULL,
  legal_name VARCHAR(160) NOT NULL,
  trade_name VARCHAR(160) NULL,
  legal_representative_associate_id INT NULL,
  phone VARCHAR(40) NULL,
  email VARCHAR(160) NULL,
  address VARCHAR(255) NULL,
  economic_activity VARCHAR(160) NULL,
  status ENUM('ACTIVA','INACTIVA') NOT NULL DEFAULT 'ACTIVA',
  notes TEXT NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_society_tax_id (tax_id_type, tax_id_number),
  FOREIGN KEY (legal_representative_associate_id) REFERENCES associates(id)
);

-- Relación genérica de participantes de un crédito: titular, codeudor, avalista
CREATE TABLE IF NOT EXISTS credit_participants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_application_id INT NULL,
  credit_id INT NULL,
  associate_id INT NULL,
  society_id INT NULL,
  role ENUM('TITULAR','CODEUDOR','AVALISTA') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (associate_id) REFERENCES associates(id),
  FOREIGN KEY (society_id) REFERENCES societies(id)
);

CREATE INDEX idx_associates_names ON associates (last_name, first_name);
CREATE INDEX idx_credit_participants_app ON credit_participants (credit_application_id);
CREATE INDEX idx_credit_participants_credit ON credit_participants (credit_id);

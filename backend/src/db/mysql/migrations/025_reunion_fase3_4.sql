-- Reunión con la cooperativa (2026-10-16), Fases 3 y 4 (docs/plan-reunion-2026-10-16.md).
--
--  Fase 3 (asesores externos que venden el crédito; no entran al sistema):
--   1. credit_applications.assigned_seller_id: el asesor se registra al radicar la solicitud (antes solo
--      se podía al desembolsar). Al desembolsar se copia al crédito (credits.assigned_seller_id ya existía).
--   2. Índice en credits.assigned_seller_id para filtrar y reportar créditos por asesor.
--  Fase 4 (documentos físicos y cobro jurídico):
--   3. associate_documents: lista de chequeo "lo tenemos en físico: sí/no" por asociado.
--   4. credit_legal_documents: lo mismo para los documentos del cobro jurídico de un crédito.
--   5. Parámetros con las listas de documentos (editables en Parámetros).
--  Los archivos NO se suben al servidor (costo de espacio, decisión de la reunión): solo se marca si el
--  documento está en poder de la cooperativa, quién lo marcó y cuándo.
--
-- Repetible: ver 021_multiprocess_guards.sql.
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_applications' AND COLUMN_NAME = 'assigned_seller_id') = 0,
  'ALTER TABLE credit_applications ADD COLUMN assigned_seller_id INT NULL, ADD CONSTRAINT fk_applications_seller FOREIGN KEY (assigned_seller_id) REFERENCES users(id)',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credits' AND INDEX_NAME = 'idx_credits_seller') = 0,
  'ALTER TABLE credits ADD KEY idx_credits_seller (assigned_seller_id)',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

CREATE TABLE IF NOT EXISTS associate_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  associate_id INT NOT NULL,
  document_type VARCHAR(120) NOT NULL,
  held TINYINT(1) NOT NULL DEFAULT 0,
  notes VARCHAR(255) NULL,
  checked_by INT NULL,
  checked_at TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY uq_associate_document (associate_id, document_type),
  FOREIGN KEY (associate_id) REFERENCES associates(id) ON DELETE CASCADE,
  FOREIGN KEY (checked_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS credit_legal_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_id INT NOT NULL,
  document_type VARCHAR(120) NOT NULL,
  held TINYINT(1) NOT NULL DEFAULT 0,
  notes VARCHAR(255) NULL,
  checked_by INT NULL,
  checked_at TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY uq_credit_legal_document (credit_id, document_type),
  FOREIGN KEY (credit_id) REFERENCES credits(id) ON DELETE CASCADE,
  FOREIGN KEY (checked_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Listas iniciales (propuestas: la cooperativa las ajusta en Parámetros). No pisa lo ya editado.
INSERT IGNORE INTO parameters (`key`, value, description) VALUES
  ('documentos_asociado',
   '["Cédula de ciudadanía", "Certificación laboral", "Desprendibles de pago", "Referencias personales", "Referencias laborales", "Autorización de tratamiento de datos"]',
   'Documentos que la cooperativa debe tener (en físico o digital) de cada asociado. En la ficha del asociado se marca cuáles se tienen.'),
  ('documentos_juridicos',
   '["Pagaré firmado", "Notificación de mora", "Notificación de embargo", "Orden de embargo", "Respuesta del pagador o empleador", "Poder para demanda"]',
   'Documentos del cobro jurídico de un crédito. En el crédito se marca cuáles se tienen.');

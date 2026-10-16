-- Reunión con la cooperativa (2026-10-16), Fase 1 (docs/plan-reunion-2026-10-16.md).
--
--  1. collection_actions.observation: segunda nota del compromiso de pago (p. ej.
--     "el titular se retiró de la empresa, pasa a PU"), distinta de la nota del compromiso.
--  2. payments.verified*: el pago se carga SOLO después de verificarlo en el banco y archivar el
--     soporte; la casilla deja constancia de quién y cuándo (los pagos anteriores quedan sin marcar).
--  3. credits.disbursement_*: cuenta destino del asociado, cuenta de la cooperativa de la que salió
--     el desembolso y si el soporte quedó archivado (el archivo NO se sube al servidor: costo de espacio).
--  4. credit_application_documents.credit_participant_id: los documentos se revisan por participante
--     (titular y cada codeudor). Las filas anteriores quedan con NULL (documentos "de la solicitud").
--     La llave única pasa a (solicitud, participante, documento); la nueva se crea ANTES de borrar la
--     vieja porque la llave foránea necesita un índice que empiece por credit_application_id.
--  5. Parámetros: listas de documentos para titular y codeudor (se copian de documentos_requeridos)
--     y lista de cuentas bancarias de la cooperativa.
--
-- Repetible: ver 021_multiprocess_guards.sql.

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'collection_actions' AND COLUMN_NAME = 'observation') = 0,
  'ALTER TABLE collection_actions ADD COLUMN observation VARCHAR(500) NULL',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'verified') = 0,
  'ALTER TABLE payments ADD COLUMN verified TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'verified_by') = 0,
  'ALTER TABLE payments ADD COLUMN verified_by INT NULL',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND COLUMN_NAME = 'verified_at') = 0,
  'ALTER TABLE payments ADD COLUMN verified_at TIMESTAMP NULL DEFAULT NULL',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credits' AND COLUMN_NAME = 'disbursement_to_account') = 0,
  'ALTER TABLE credits ADD COLUMN disbursement_to_account VARCHAR(255) NULL',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credits' AND COLUMN_NAME = 'disbursement_from_account') = 0,
  'ALTER TABLE credits ADD COLUMN disbursement_from_account VARCHAR(255) NULL',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credits' AND COLUMN_NAME = 'disbursement_proof_filed') = 0,
  'ALTER TABLE credits ADD COLUMN disbursement_proof_filed TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_application_documents' AND COLUMN_NAME = 'credit_participant_id') = 0,
  'ALTER TABLE credit_application_documents ADD COLUMN credit_participant_id INT NULL',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_application_documents' AND INDEX_NAME = 'uq_application_participant_document') = 0,
  'ALTER TABLE credit_application_documents ADD UNIQUE KEY uq_application_participant_document (credit_application_id, credit_participant_id, document_type)',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'credit_application_documents' AND INDEX_NAME = 'uq_application_document') > 0,
  'ALTER TABLE credit_application_documents DROP INDEX uq_application_document',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

INSERT IGNORE INTO parameters (`key`, value, description)
SELECT 'documentos_requeridos_titular', value,
  'Documentos que se revisan al titular de una solicitud de crédito (se aprueban uno por uno antes de aprobar la solicitud).'
FROM parameters WHERE `key` = 'documentos_requeridos';

INSERT IGNORE INTO parameters (`key`, value, description)
SELECT 'documentos_requeridos_codeudor', value,
  'Documentos que se revisan a cada codeudor de una solicitud de crédito (se aprueban uno por uno antes de aprobar la solicitud).'
FROM parameters WHERE `key` = 'documentos_requeridos';

INSERT INTO parameters (`key`, value, description) VALUES (
  'cuentas_bancarias_cooperativa',
  '[]',
  'Cuentas bancarias de la cooperativa desde las que se hacen los desembolsos (una por línea, p. ej. "Bancolombia ahorros 123-456").'
) ON DUPLICATE KEY UPDATE `key` = `key`;

-- La lista única queda solo como respaldo si faltaran las listas por participante.
UPDATE parameters
SET description = 'Lista antigua (una sola para toda la solicitud). Ya no se usa si existen documentos_requeridos_titular y documentos_requeridos_codeudor: edite esas dos.'
WHERE `key` = 'documentos_requeridos';

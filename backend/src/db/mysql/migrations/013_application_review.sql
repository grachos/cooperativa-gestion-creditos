-- Convierte "Solicitudes de crédito" en una pantalla de revisión funcional:
-- el revisor debe poder confirmar los documentos requeridos y a cada
-- codeudor/titular antes de aprobar la solicitud (antes solo existía un
-- botón "Aprobar" sin ninguna verificación real).
--
-- MySQL: las llaves foráneas van declaradas aparte (el REFERENCES en línea se
-- ignora) y el índice por solicitud lo cubre la llave única, por eso no se
-- repite el idx_application_documents_app de Postgres.

CREATE TABLE IF NOT EXISTS credit_application_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_application_id INT NOT NULL,
  document_type VARCHAR(80) NOT NULL,
  status ENUM('PENDIENTE','APROBADO','RECHAZADO') NOT NULL DEFAULT 'PENDIENTE',
  notes VARCHAR(255) NULL,
  reviewed_by INT NULL,
  reviewed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_application_document (credit_application_id, document_type),
  FOREIGN KEY (credit_application_id) REFERENCES credit_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE credit_participants
  ADD COLUMN status ENUM('PENDIENTE','APROBADO','RECHAZADO') NOT NULL DEFAULT 'PENDIENTE',
  ADD COLUMN notes VARCHAR(255) NULL,
  ADD COLUMN reviewed_by INT NULL,
  ADD COLUMN reviewed_at TIMESTAMP NULL DEFAULT NULL,
  ADD CONSTRAINT fk_credit_participants_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id);

INSERT INTO parameters (`key`, value, description) VALUES (
  'documentos_requeridos',
  '["Cedula de ciudadania", "Certificado laboral o de ingresos", "Desprendibles de pago", "Extractos bancarios", "Referencias personales"]',
  'Lista de documentos que el revisor debe verificar antes de aprobar una solicitud de crédito.'
) ON DUPLICATE KEY UPDATE `key` = `key`;

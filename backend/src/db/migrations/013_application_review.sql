-- Convierte "Solicitudes de crédito" en una pantalla de revisión funcional:
-- el revisor debe poder confirmar los documentos requeridos y a cada
-- codeudor/titular antes de aprobar la solicitud (antes solo existía un
-- botón "Aprobar" sin ninguna verificación real).

CREATE TABLE IF NOT EXISTS credit_application_documents (
  id SERIAL PRIMARY KEY,
  credit_application_id INT NOT NULL REFERENCES credit_applications(id) ON DELETE CASCADE,
  document_type VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' CHECK (status IN ('PENDIENTE', 'APROBADO', 'RECHAZADO')),
  notes VARCHAR(255) NULL,
  reviewed_by INT NULL REFERENCES users(id),
  reviewed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (credit_application_id, document_type)
);
CREATE INDEX idx_application_documents_app ON credit_application_documents (credit_application_id);

ALTER TABLE credit_participants
  ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' CHECK (status IN ('PENDIENTE', 'APROBADO', 'RECHAZADO')),
  ADD COLUMN notes VARCHAR(255) NULL,
  ADD COLUMN reviewed_by INT NULL REFERENCES users(id),
  ADD COLUMN reviewed_at TIMESTAMPTZ NULL;

INSERT INTO parameters ("key", value, description) VALUES (
  'documentos_requeridos',
  '["Cedula de ciudadania", "Certificado laboral o de ingresos", "Desprendibles de pago", "Extractos bancarios", "Referencias personales"]',
  'Lista de documentos que el revisor debe verificar antes de aprobar una solicitud de crédito.'
) ON CONFLICT ("key") DO NOTHING;

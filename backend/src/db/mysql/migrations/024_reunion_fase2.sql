-- Reunión con la cooperativa (2026-10-16), Fase 2 (docs/plan-reunion-2026-10-16.md).
--
--  1. user_permissions: permisos por usuario encima de los de sus roles. granted = 1 agrega un
--     permiso que el rol no da; granted = 0 quita uno que el rol sí da. Se guardan SOLO las
--     diferencias contra los roles, así un cambio posterior en un rol sigue aplicando. Es lo que
--     permite la pantalla de casillas ("qué puede hacer cada usuario").
--  2. application_reference_checks: verificación de referencias de una solicitud (quién llamó,
--     si contestaron y si fueron positivas o negativas).
--  El permiso nuevo `applications:review` (separa "revisar" de "aprobar/rechazar") se crea en
--  seed_base.sql, que corre en cada arranque.
--
-- Repetible (CREATE TABLE IF NOT EXISTS): ver 021_multiprocess_guards.sql.
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id INT NOT NULL,
  permission_id INT NOT NULL,
  granted TINYINT(1) NOT NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, permission_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS application_reference_checks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_application_id INT NOT NULL,
  reference_type ENUM('PERSONAL','LABORAL') NOT NULL,
  reference_name VARCHAR(160) NOT NULL,
  phone VARCHAR(40) NULL,
  contacted TINYINT(1) NOT NULL DEFAULT 0,
  result ENUM('POSITIVA','NEGATIVA','SIN_RESPUESTA') NULL,
  notes VARCHAR(500) NULL,
  checked_by INT NOT NULL,
  checked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_reference_checks_application (credit_application_id),
  FOREIGN KEY (credit_application_id) REFERENCES credit_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (checked_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- El reporte "Actividad por usuario" filtra audit_logs por usuario y fechas.
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND INDEX_NAME = 'idx_audit_logs_user_created') = 0,
  'ALTER TABLE audit_logs ADD KEY idx_audit_logs_user_created (user_id, created_at)',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

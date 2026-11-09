-- Anti-bots (docs/escalabilidad.md §3.19): límites de intentos en la base de datos y auditoría de accesos.
--
--  auth_attempts: una fila por intento a login / forgot-password / reset-password. Sirve para limitar por IP y por
--     identificador (usuario o correo escrito, guardado como SHA-256: no se guarda lo que la persona tecleó, que a
--     veces es una contraseña puesta en el campo equivocado). Vive en la base y no en memoria: el hosting corre varios
--     procesos y cada uno contaba aparte. Las filas se insertan ANTES de verificar la contraseña y se marcan
--     `success = 1` si salió bien, así una ráfaga de intentos simultáneos no se cuela por encima del límite. Se purgan
--     a los 2 días.
--  auth_audit: una fila por petición (fecha, IP, agente de usuario, acción, resultado de Turnstile y del acceso, usuario
--     si se conoce). Nunca contraseñas ni tokens. Sin llave foránea a users: el rastro sobrevive a la baja del usuario.
--     Se purga al año.
--
-- Repetible: solo CREATE TABLE IF NOT EXISTS (ver 021_multiprocess_guards.sql).
CREATE TABLE IF NOT EXISTS auth_attempts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  action VARCHAR(30) NOT NULL,
  ip_address VARCHAR(64) NOT NULL,
  identifier_hash CHAR(64) NULL,
  success TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_auth_attempts_ip (action, ip_address, created_at),
  KEY idx_auth_attempts_identifier (action, identifier_hash, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auth_audit (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  action VARCHAR(30) NOT NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  identifier_hash CHAR(64) NULL,
  user_id INT NULL,
  turnstile_result VARCHAR(20) NOT NULL,
  turnstile_reason VARCHAR(60) NULL,
  outcome VARCHAR(30) NOT NULL,
  http_status SMALLINT NULL,
  KEY idx_auth_audit_created (created_at),
  KEY idx_auth_audit_ip (ip_address, created_at),
  KEY idx_auth_audit_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

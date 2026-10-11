-- Claves de idempotencia (header `Idempotency-Key`): evitan que un reintento de
-- red, un doble clic o un reenvío repita el efecto de una operación de
-- escritura (registrar un pago, crear un crédito, etc.).
--
-- Una fila = una operación lógica de un usuario. La llave única
-- (user_id, operation, idempotency_key) es lo que serializa las peticiones
-- simultáneas: solo un INSERT gana y ejecuta el efecto.
--
--  - request_hash: SHA-256 de método + URL + cuerpo. Se guarda el hash, no el
--    cuerpo (puede traer datos personales). Misma clave con otro hash => 409.
--  - state IN_PROGRESS: la operación se está ejecutando o quedó en estado
--    incierto (p. ej. el proceso murió a mitad). Mientras no venza, NO se
--    vuelve a ejecutar.
--  - state COMPLETED: se guardan status y cuerpo de la respuesta para
--    reproducirla tal cual en los reintentos.
--  - expires_at: ver IDEMPOTENCY_TTL_HOURS. DATETIME (no TIMESTAMP) para no
--    depender de explicit_defaults_for_timestamp; el backend fija la sesión
--    en UTC.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  operation VARCHAR(80) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  state ENUM('IN_PROGRESS','COMPLETED') NOT NULL DEFAULT 'IN_PROGRESS',
  response_status SMALLINT NULL,
  response_body MEDIUMTEXT NULL,
  response_content_type VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL DEFAULT NULL,
  expires_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_idempotency_scope (user_id, operation, idempotency_key),
  KEY idx_idempotency_expires_at (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

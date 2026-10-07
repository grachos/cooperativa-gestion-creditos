-- Tokens de un solo uso para "¿Olvidaste tu contraseña?". Solo se guarda el
-- hash del token; el enlace con el token real viaja por correo.
--
-- MySQL: expires_at lleva DEFAULT explícito aunque el backend siempre lo
-- fija. Sin él, MariaDB (explicit_defaults_for_timestamp apagado) le asigna
-- en silencio DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, y el
-- vencimiento del token se reiniciaría al marcarlo como usado.
-- No lleva RLS (ver nota de la 012).
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_password_reset_tokens_user_id (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

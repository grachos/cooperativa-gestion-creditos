-- Protecciones para varios procesos Node y para el job de alertas
-- (ver docs/escalabilidad.md, hallazgos #7, #9 y #10):
--
--  1. job_runs: una fila por (trabajo, día). Quien la inserta primero ejecuta el
--     job diario; los demás procesos ven la fila y no lo repiten. Antes cada
--     proceso Node tenía su propio reloj y el job corría una vez POR proceso.
--  2. realtime_events: buzón de eventos para las alertas en vivo (SSE). Cada
--     proceso solo conoce las conexiones SSE que él mismo tiene abiertas; los
--     eventos se publican aquí y los demás procesos los reenvían a sus clientes.
--     Filas de corta vida (se purgan solas a los pocos minutos).
--  3. alerts.open_flag + llave única: impide dos alertas ABIERTAS iguales para la
--     misma cuota y tipo aunque dos ejecuciones del job coincidan (antes: SELECT
--     y luego INSERT sin protección). open_flag vale 1 mientras la alerta está
--     ABIERTA y NULL en cuanto se atiende o descarta (los NULL no chocan en la
--     llave única, así que el historial se conserva). Se mantiene desde el código
--     en lugar de una columna generada para no depender de la versión de MySQL.
CREATE TABLE IF NOT EXISTS job_runs (
  job_name VARCHAR(60) NOT NULL,
  run_date DATE NOT NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (job_name, run_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS realtime_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  origin VARCHAR(40) NOT NULL,
  event VARCHAR(60) NOT NULL,
  payload TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_realtime_events_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Los ALTER son condicionales: si esta migración se interrumpió a medias (p. ej. el
-- proceso se reinició durante el arranque), volver a ejecutarla no falla con
-- "Duplicate column name" ni "Duplicate key name".
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alerts' AND COLUMN_NAME = 'open_flag') = 0,
  'ALTER TABLE alerts ADD COLUMN open_flag TINYINT NULL DEFAULT NULL',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

UPDATE alerts SET open_flag = 1 WHERE status = 'ABIERTA';

-- Si ya hubiera alertas abiertas duplicadas, se conserva la más antigua y las
-- demás se descartan (así la llave única puede crearse sin error).
UPDATE alerts a
JOIN (
  SELECT installment_id, type, MIN(id) AS keep_id
  FROM alerts
  WHERE open_flag = 1 AND installment_id IS NOT NULL
  GROUP BY installment_id, type
  HAVING COUNT(*) > 1
) d ON d.installment_id = a.installment_id AND d.type = a.type
SET a.open_flag = NULL, a.status = 'DESCARTADA', a.resolved_at = NOW()
WHERE a.open_flag = 1 AND a.id <> d.keep_id;

SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alerts' AND INDEX_NAME = 'uq_alerts_open') = 0,
  'ALTER TABLE alerts ADD UNIQUE KEY uq_alerts_open (installment_id, type, open_flag)',
  'SELECT 1');
PREPARE ddl_stmt FROM @ddl;
EXECUTE ddl_stmt;
DEALLOCATE PREPARE ddl_stmt;

-- Protecciones de concurrencia (ver docs/escalabilidad.md, hallazgos P0/P1):
--
--  1. sequences: contador atómico por nombre. Reemplaza el `COUNT(*)+1` del
--     número de crédito, que con dos desembolsos simultáneos generaba el mismo
--     número (uno fallaba) y se repetía si se borraba un crédito. La fila del
--     contador se bloquea dentro de la transacción del desembolso, así que los
--     números salen consecutivos y sin duplicados; si la transacción falla,
--     no se consume el número.
--  2. application_disbursements: una fila por solicitud desembolsada. Su llave
--     primaria es la red de seguridad de la base de datos para que una misma
--     solicitud no genere dos créditos (la refinanciación reutiliza el
--     credit_application_id del crédito original, por eso no se puede poner un
--     UNIQUE directamente sobre credits.credit_application_id).
CREATE TABLE IF NOT EXISTS sequences (
  name VARCHAR(60) NOT NULL PRIMARY KEY,
  value BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Continúa la numeración existente (CR-AAAA-NNNNN): el contador de cada año
-- arranca en el mayor número ya usado.
INSERT INTO sequences (name, value)
SELECT CONCAT('credit_number:', SUBSTRING(credit_number, 4, 4)),
       MAX(CAST(SUBSTRING(credit_number, 9) AS UNSIGNED))
FROM credits
WHERE credit_number REGEXP '^CR-[0-9]{4}-[0-9]+$'
GROUP BY SUBSTRING(credit_number, 4, 4)
ON DUPLICATE KEY UPDATE value = GREATEST(value, VALUES(value));

CREATE TABLE IF NOT EXISTS application_disbursements (
  credit_application_id INT NOT NULL PRIMARY KEY,
  credit_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_application_disbursements_credit (credit_id),
  FOREIGN KEY (credit_application_id) REFERENCES credit_applications(id),
  FOREIGN KEY (credit_id) REFERENCES credits(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Créditos ya desembolsados (los que no vienen de una refinanciación). Si hubo
-- duplicados históricos, se conserva el más antiguo.
INSERT IGNORE INTO application_disbursements (credit_application_id, credit_id)
SELECT c.credit_application_id, MIN(c.id)
FROM credits c
WHERE c.refinanced_from_credit_id IS NULL AND c.credit_application_id IS NOT NULL
GROUP BY c.credit_application_id;

-- Un asociado que es rechazado como participante (titular o codeudor) al
-- revisar una solicitud de crédito debe quedar marcado como tal a nivel
-- global, para no poder volver a seleccionarlo como codeudor en una
-- solicitud nueva. El status de associates solo admitía ACTIVO/INACTIVO.
--
-- MySQL: la columna es un ENUM (ver 002), así que se amplía con MODIFY en vez
-- de reemplazar un CHECK como en Postgres.
ALTER TABLE associates
  MODIFY COLUMN status ENUM('ACTIVO','INACTIVO','RECHAZADO') NOT NULL DEFAULT 'ACTIVO';

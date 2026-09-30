-- Un asociado que es rechazado como participante (titular o codeudor) al
-- revisar una solicitud de crédito debe quedar marcado como tal a nivel
-- global, para no poder volver a seleccionarlo como codeudor en una
-- solicitud nueva. El status de associates solo admitía ACTIVO/INACTIVO.
ALTER TABLE associates DROP CONSTRAINT associates_status_check;
ALTER TABLE associates ADD CONSTRAINT associates_status_check CHECK (status IN ('ACTIVO', 'INACTIVO', 'RECHAZADO'));

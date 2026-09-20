-- Hallazgo del Excel real: el formulario de asociado no tenía dónde
-- registrar el empleador ("EMPRESA", "DIRECCION EMPRESA", "TELEFONOS
-- EMPRESA", "CORREO EMPRESA TIT"), usado para contactar al titular en su
-- trabajo durante la gestión de cobranza.
ALTER TABLE associates
  ADD COLUMN employer_name VARCHAR(160) NULL,
  ADD COLUMN employer_address VARCHAR(255) NULL,
  ADD COLUMN employer_phone VARCHAR(40) NULL,
  ADD COLUMN employer_email VARCHAR(160) NULL;

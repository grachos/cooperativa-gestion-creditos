-- Un usuario del sistema puede ser un Gestor de cartera o Vendedor asignado
-- a créditos (no solo alguien con acceso administrativo); para eso hacen
-- falta datos de identificación y contacto que no existían en `users`.
ALTER TABLE users
  ADD COLUMN id_type VARCHAR(20) NULL CHECK (id_type IN ('CC','CE','TI','PA','NIT')),
  ADD COLUMN id_number VARCHAR(40) NULL,
  ADD COLUMN phone VARCHAR(40) NULL,
  ADD COLUMN address VARCHAR(255) NULL;

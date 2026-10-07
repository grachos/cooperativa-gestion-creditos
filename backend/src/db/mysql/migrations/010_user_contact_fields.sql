-- Un usuario del sistema puede ser un Gestor de cartera o Vendedor asignado
-- a créditos (no solo alguien con acceso administrativo); para eso hacen
-- falta datos de identificación y contacto que no existían en `users`.
--
-- Diferencia con Postgres: allá esta migración creaba id_type con un CHECK
-- (CC, CE, TI, PA, NIT) y la 014 lo quitaba. Aquí se crea directamente sin
-- CHECK: la lista válida la gobierna el parámetro `tipos_identificacion`, y
-- quitar un CHECK tiene sintaxis distinta en MySQL (DROP CHECK) y MariaDB
-- (DROP CONSTRAINT), así que se evita crearlo.
ALTER TABLE users
  ADD COLUMN id_type VARCHAR(20) NULL,
  ADD COLUMN id_number VARCHAR(40) NULL,
  ADD COLUMN phone VARCHAR(40) NULL,
  ADD COLUMN address VARCHAR(255) NULL;

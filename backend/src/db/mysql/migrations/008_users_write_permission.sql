-- Permite crear usuarios del sistema desde la UI (necesario para dar de alta
-- un nuevo "Gestor de cartera" o "Vendedor": ambos son usuarios del sistema
-- asignables en el desembolso, `assigned_collector_id`/`assigned_seller_id`,
-- y hasta ahora solo se podían crear vía seed, sin endpoint ni UI).
--
-- MySQL: ON CONFLICT DO NOTHING de Postgres se traduce a INSERT IGNORE; los
-- dos INSERT chocan con la llave única (code) y la llave primaria
-- (role_id, permission_id), así que repetirlos no duplica nada.
INSERT IGNORE INTO permissions (code, description)
VALUES ('users:write', 'Crear y administrar usuarios del sistema');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'ADMIN' AND p.code = 'users:write';

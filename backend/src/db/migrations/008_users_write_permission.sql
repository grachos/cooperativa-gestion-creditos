-- Permite crear usuarios del sistema desde la UI (necesario para dar de alta
-- un nuevo "Gestor de cartera" o "Vendedor": ambos son usuarios del sistema
-- asignables en el desembolso, `assigned_collector_id`/`assigned_seller_id`,
-- y hasta ahora solo se podían crear vía seed, sin endpoint ni UI).
INSERT INTO permissions (code, description)
VALUES ('users:write', 'Crear y administrar usuarios del sistema')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'ADMIN' AND p.code = 'users:write'
ON CONFLICT (role_id, permission_id) DO NOTHING;

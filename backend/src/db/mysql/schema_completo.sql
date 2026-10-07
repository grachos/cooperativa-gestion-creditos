-- GENERADO por build-schema.mjs a partir de migrations/*.sql — no editar a mano.
-- Esquema completo de la aplicación para MySQL 8 / MariaDB 10.4+.
-- Ejecutar UNA sola vez sobre una base de datos vacía (no es repetible: las
-- migraciones con ALTER TABLE fallarían la segunda vez).
-- Después ejecutar seed_base.sql. Ver README.md.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ============================================================
-- 001_init.sql
-- ============================================================

-- Núcleo de usuarios, roles y permisos

CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(80) NOT NULL UNIQUE,
  description VARCHAR(255) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INT NOT NULL,
  permission_id INT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(160) NOT NULL UNIQUE,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(160) NOT NULL,
  status ENUM('ACTIVO','INACTIVO') NOT NULL DEFAULT 'ACTIVO',
  refresh_token_hash VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INT NOT NULL,
  role_id INT NOT NULL,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_activity (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  event_type ENUM('LOGIN','LOGOUT','LOGIN_FAILED') NOT NULL,
  ip_address VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 002_associates.sql
-- ============================================================

-- Asociados (personas naturales), sociedades y participantes de crédito

CREATE TABLE IF NOT EXISTS associates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_type VARCHAR(20) NOT NULL,
  id_number VARCHAR(40) NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  birth_date DATE NULL,
  phone VARCHAR(40) NULL,
  email VARCHAR(160) NULL,
  address VARCHAR(255) NULL,
  municipality VARCHAR(100) NULL,
  department VARCHAR(100) NULL,
  country VARCHAR(100) NOT NULL DEFAULT 'Colombia',
  income_info VARCHAR(255) NULL,
  status ENUM('ACTIVO','INACTIVO') NOT NULL DEFAULT 'ACTIVO',
  notes TEXT NULL,
  data_consent BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_associate_identification (id_type, id_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS societies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tax_id_type VARCHAR(20) NOT NULL,
  tax_id_number VARCHAR(40) NOT NULL,
  legal_name VARCHAR(160) NOT NULL,
  trade_name VARCHAR(160) NULL,
  legal_representative_associate_id INT NULL,
  phone VARCHAR(40) NULL,
  email VARCHAR(160) NULL,
  address VARCHAR(255) NULL,
  economic_activity VARCHAR(160) NULL,
  status ENUM('ACTIVA','INACTIVA') NOT NULL DEFAULT 'ACTIVA',
  notes TEXT NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_society_tax_id (tax_id_type, tax_id_number),
  FOREIGN KEY (legal_representative_associate_id) REFERENCES associates(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Relación genérica de participantes de un crédito: titular, codeudor, avalista
CREATE TABLE IF NOT EXISTS credit_participants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_application_id INT NULL,
  credit_id INT NULL,
  associate_id INT NULL,
  society_id INT NULL,
  role ENUM('TITULAR','CODEUDOR','AVALISTA') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (associate_id) REFERENCES associates(id),
  FOREIGN KEY (society_id) REFERENCES societies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_associates_names ON associates (last_name, first_name);
CREATE INDEX idx_credit_participants_app ON credit_participants (credit_application_id);
CREATE INDEX idx_credit_participants_credit ON credit_participants (credit_id);

-- ============================================================
-- 003_credit_lifecycle.sql
-- ============================================================

-- Solicitudes, aprobación, desembolso, créditos y cronograma

CREATE TABLE IF NOT EXISTS credit_applications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  titular_associate_id INT NULL,
  titular_society_id INT NULL,
  requested_amount DECIMAL(16,2) NOT NULL,
  term_value INT NOT NULL,
  term_unit ENUM('MESES') NOT NULL DEFAULT 'MESES',
  interest_rate DECIMAL(8,4) NOT NULL,
  rate_type ENUM('NOMINAL_MENSUAL','EFECTIVA_ANUAL') NOT NULL DEFAULT 'NOMINAL_MENSUAL',
  payment_frequency ENUM('MENSUAL') NOT NULL DEFAULT 'MENSUAL',
  expected_disbursement_date DATE NULL,
  due_day_rule VARCHAR(60) NULL,
  purpose VARCHAR(255) NULL,
  notes TEXT NULL,
  status ENUM('BORRADOR','RADICADA','EN_REVISION','APROBADA','RECHAZADA','CANCELADA','DESEMBOLSADA') NOT NULL DEFAULT 'BORRADOR',
  rejection_reason VARCHAR(255) NULL,
  created_by INT NOT NULL,
  decided_by INT NULL,
  decided_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (titular_associate_id) REFERENCES associates(id),
  FOREIGN KEY (titular_society_id) REFERENCES societies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS credit_application_status_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_application_id INT NOT NULL,
  from_status VARCHAR(30) NULL,
  to_status VARCHAR(30) NOT NULL,
  reason VARCHAR(255) NULL,
  user_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (credit_application_id) REFERENCES credit_applications(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS credits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_number VARCHAR(30) NOT NULL UNIQUE,
  credit_application_id INT NOT NULL,
  titular_associate_id INT NULL,
  titular_society_id INT NULL,
  disbursed_amount DECIMAL(16,2) NOT NULL,
  principal_balance DECIMAL(16,2) NOT NULL,
  interest_rate DECIMAL(8,4) NOT NULL,
  rate_type ENUM('NOMINAL_MENSUAL','EFECTIVA_ANUAL') NOT NULL,
  term_value INT NOT NULL,
  payment_frequency ENUM('MENSUAL') NOT NULL DEFAULT 'MENSUAL',
  disbursement_date DATE NOT NULL,
  first_installment_date DATE NOT NULL,
  status ENUM('VIGENTE','EN_MORA','PAGADO','ANULADO') NOT NULL DEFAULT 'VIGENTE',
  delinquency_policy_snapshot JSON NULL,
  parameters_snapshot JSON NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (credit_application_id) REFERENCES credit_applications(id),
  FOREIGN KEY (titular_associate_id) REFERENCES associates(id),
  FOREIGN KEY (titular_society_id) REFERENCES societies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS credit_schedule_installments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_id INT NOT NULL,
  installment_number INT NOT NULL,
  due_date DATE NOT NULL,
  principal_due DECIMAL(16,2) NOT NULL,
  interest_due DECIMAL(16,2) NOT NULL,
  other_due DECIMAL(16,2) NOT NULL DEFAULT 0,
  total_due DECIMAL(16,2) NOT NULL,
  principal_paid DECIMAL(16,2) NOT NULL DEFAULT 0,
  interest_paid DECIMAL(16,2) NOT NULL DEFAULT 0,
  late_fee_paid DECIMAL(16,2) NOT NULL DEFAULT 0,
  other_paid DECIMAL(16,2) NOT NULL DEFAULT 0,
  balance DECIMAL(16,2) NOT NULL,
  overdue_days INT NOT NULL DEFAULT 0,
  status ENUM('PENDIENTE','PAGADA','PARCIAL','VENCIDA','EN_MORA','ANULADA') NOT NULL DEFAULT 'PENDIENTE',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (credit_id) REFERENCES credits(id) ON DELETE CASCADE,
  UNIQUE KEY uq_credit_installment (credit_id, installment_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_installments_due_date ON credit_schedule_installments (due_date);
CREATE INDEX idx_installments_status ON credit_schedule_installments (status);
CREATE INDEX idx_credits_status ON credits (status);
CREATE INDEX idx_applications_status ON credit_applications (status);

-- ============================================================
-- 004_payments_delinquency.sql
-- ============================================================

-- Pagos, imputación, mora, alertas, parámetros, auditoría e integración contable

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_id INT NOT NULL,
  received_date DATE NOT NULL,
  effective_date DATE NULL,
  amount DECIMAL(16,2) NOT NULL,
  payment_method VARCHAR(60) NOT NULL,
  reference VARCHAR(120) NULL,
  notes VARCHAR(255) NULL,
  status ENUM('CONFIRMADO','REVERSADO') NOT NULL DEFAULT 'CONFIRMADO',
  reversal_reason VARCHAR(255) NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (credit_id) REFERENCES credits(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_allocations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payment_id INT NOT NULL,
  installment_id INT NOT NULL,
  concept ENUM('GASTOS','MORA','INTERES','CAPITAL') NOT NULL,
  amount DECIMAL(16,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
  FOREIGN KEY (installment_id) REFERENCES credit_schedule_installments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS delinquency_calculations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_id INT NOT NULL,
  installment_id INT NOT NULL,
  calculation_date DATE NOT NULL,
  overdue_days INT NOT NULL,
  base_amount DECIMAL(16,2) NOT NULL,
  rate_or_value DECIMAL(10,4) NOT NULL,
  policy_version VARCHAR(40) NOT NULL,
  result_amount DECIMAL(16,2) NOT NULL,
  generated_by VARCHAR(40) NOT NULL DEFAULT 'SYSTEM',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (credit_id) REFERENCES credits(id),
  FOREIGN KEY (installment_id) REFERENCES credit_schedule_installments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS collection_actions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_id INT NOT NULL,
  action_type ENUM('NOTIFICACION','GESTION_COBRO','PREPARACION_JURIDICA') NOT NULL,
  description VARCHAR(255) NULL,
  status ENUM('PENDIENTE','EN_PROCESO','COMPLETADA') NOT NULL DEFAULT 'PENDIENTE',
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (credit_id) REFERENCES credits(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_id INT NULL,
  installment_id INT NULL,
  type VARCHAR(60) NOT NULL,
  priority ENUM('BAJA','MEDIA','ALTA') NOT NULL DEFAULT 'MEDIA',
  message VARCHAR(255) NOT NULL,
  status ENUM('ABIERTA','ATENDIDA','DESCARTADA') NOT NULL DEFAULT 'ABIERTA',
  assigned_to INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  FOREIGN KEY (credit_id) REFERENCES credits(id),
  FOREIGN KEY (installment_id) REFERENCES credit_schedule_installments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS parameters (
  id INT AUTO_INCREMENT PRIMARY KEY,
  `key` VARCHAR(80) NOT NULL UNIQUE,
  value JSON NOT NULL,
  description VARCHAR(255) NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entity VARCHAR(60) NOT NULL,
  entity_id VARCHAR(40) NOT NULL,
  action VARCHAR(60) NOT NULL,
  old_value JSON NULL,
  new_value JSON NULL,
  user_id INT NULL,
  ip_address VARCHAR(64) NULL,
  reason VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS integration_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(60) NOT NULL,
  idempotency_key VARCHAR(120) NOT NULL UNIQUE,
  payload JSON NOT NULL,
  status ENUM('PENDIENTE','ENVIADO','CONFIRMADO','FALLIDO','REINTENTANDO') NOT NULL DEFAULT 'PENDIENTE',
  attempts INT NOT NULL DEFAULT 0,
  last_error VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS integration_attempts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  integration_event_id INT NOT NULL,
  attempt_number INT NOT NULL,
  response_summary VARCHAR(500) NULL,
  success BOOLEAN NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (integration_event_id) REFERENCES integration_events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(160) NOT NULL,
  body VARCHAR(500) NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_payments_credit ON payments (credit_id);
CREATE INDEX idx_alerts_status ON alerts (status, priority);
CREATE INDEX idx_integration_events_status ON integration_events (status);

-- ============================================================
-- 005_collections_and_refinancing.sql
-- ============================================================

-- Hallazgos de la revisión del Excel real de la cooperativa (COOMULNISSI):
-- gestor/vendedor asignado por crédito, compromisos de pago, ajustes
-- (interés por cambio de fecha, descuentos autorizados) y refinanciación.

ALTER TABLE credits
  ADD COLUMN assigned_collector_id INT NULL AFTER titular_society_id,
  ADD COLUMN assigned_seller_id INT NULL AFTER assigned_collector_id,
  ADD COLUMN refinanced_from_credit_id INT NULL AFTER assigned_seller_id,
  ADD COLUMN refinanced_to_credit_id INT NULL AFTER refinanced_from_credit_id,
  ADD CONSTRAINT fk_credits_collector FOREIGN KEY (assigned_collector_id) REFERENCES users(id),
  ADD CONSTRAINT fk_credits_seller FOREIGN KEY (assigned_seller_id) REFERENCES users(id),
  ADD CONSTRAINT fk_credits_refinanced_from FOREIGN KEY (refinanced_from_credit_id) REFERENCES credits(id),
  ADD CONSTRAINT fk_credits_refinanced_to FOREIGN KEY (refinanced_to_credit_id) REFERENCES credits(id);

ALTER TABLE credits
  MODIFY COLUMN status ENUM('VIGENTE','EN_MORA','PAGADO','ANULADO','REFINANCIADO') NOT NULL DEFAULT 'VIGENTE';

-- Compromisos de pago (FECHAS DE COMPROMISOS en el Excel original)
ALTER TABLE collection_actions
  ADD COLUMN promise_date DATE NULL AFTER description,
  ADD COLUMN promise_status ENUM('PENDIENTE','CUMPLIDA','INCUMPLIDA') NULL AFTER promise_date;

-- Ajustes manuales por crédito: interés por cambio de fecha, descuentos, etc.
-- (VALOR INTERES POR CAMBIO DE FECHA / VALOR DESCONTADO en el Excel original)
CREATE TABLE IF NOT EXISTS credit_adjustments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_id INT NOT NULL,
  installment_id INT NULL,
  type ENUM('INTERES_CAMBIO_FECHA','DESCUENTO','GASTO_NOTIFICACION','OTRO') NOT NULL,
  amount DECIMAL(16,2) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  approved_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (credit_id) REFERENCES credits(id),
  FOREIGN KEY (installment_id) REFERENCES credit_schedule_installments(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_credits_collector ON credits (assigned_collector_id);
CREATE INDEX idx_collection_actions_promise ON collection_actions (promise_date);

-- ============================================================
-- 006_gastos_imputation.sql
-- ============================================================

-- Orden de imputación real, según el histórico de observaciones de pago del
-- Excel de la cooperativa: los gastos puntuales (p. ej. "GASTOS DE
-- NOTIFICACIÓN") se cobran junto con o antes de completar la cuota
-- ("SALDA $91.800 CUOTA 4 + $100.000 DE GASTOS DE NOTIFICACIÓN"), no después
-- del capital. El esquema ya tenía el concepto GASTOS en payment_allocations
-- pero nunca se usaba porque no había manera de saber cuánto de un ajuste
-- (credit_adjustments) seguía pendiente de cobro.
--
-- MySQL: el REFERENCES en línea de una columna se ignora en silencio, por eso
-- la llave foránea se declara aparte con ADD CONSTRAINT.

ALTER TABLE credit_adjustments
  ADD COLUMN paid_amount DECIMAL(16,2) NOT NULL DEFAULT 0;

ALTER TABLE payment_allocations
  MODIFY COLUMN installment_id INT NULL,
  ADD COLUMN adjustment_id INT NULL,
  ADD CONSTRAINT fk_payment_allocations_adjustment FOREIGN KEY (adjustment_id) REFERENCES credit_adjustments(id);

-- ============================================================
-- 007_funder_rate.sql
-- ============================================================

-- Hallazgo del Excel real: algunos créditos se fondean con capital de un
-- tercero ("tomador") que recibe una tasa distinta (más baja) que la que
-- paga el asociado; la diferencia es el margen de la cooperativa. Patrón
-- verificado como general en el histórico (16 meses consecutivos, 4% al
-- asociado vs 1,9% al tomador, diferencia 2,1% exacta en todos los casos).
-- Se agrega como campos opcionales por crédito: si no aplica (fondeado con
-- capital propio de la cooperativa), quedan NULL.
ALTER TABLE credits
  ADD COLUMN funder_name VARCHAR(255) NULL,
  ADD COLUMN funder_rate_percent DECIMAL(8,4) NULL;

-- ============================================================
-- 008_users_write_permission.sql
-- ============================================================

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

-- ============================================================
-- 009_associate_employer_fields.sql
-- ============================================================

-- Hallazgo del Excel real: el formulario de asociado no tenía dónde
-- registrar el empleador ("EMPRESA", "DIRECCION EMPRESA", "TELEFONOS
-- EMPRESA", "CORREO EMPRESA TIT"), usado para contactar al titular en su
-- trabajo durante la gestión de cobranza.
ALTER TABLE associates
  ADD COLUMN employer_name VARCHAR(160) NULL,
  ADD COLUMN employer_address VARCHAR(255) NULL,
  ADD COLUMN employer_phone VARCHAR(40) NULL,
  ADD COLUMN employer_email VARCHAR(160) NULL;

-- ============================================================
-- 010_user_contact_fields.sql
-- ============================================================

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

-- ============================================================
-- 011_spanish_parameter_names.sql
-- ============================================================

-- Los parámetros se sembraron con llaves en inglés y una descripción
-- genérica de "demostración, pendiente de confirmación". La cooperativa ya
-- confirmó estos valores contra su Excel real (ver comentarios en
-- delinquency.service.ts), así que se renombran a español y se reemplaza
-- la descripción por una que explica cada parámetro en concreto (algunas
-- superan los 255 caracteres originales, de ahí el MODIFY).
--
-- MySQL: `key` es palabra reservada y va entre comillas invertidas.
ALTER TABLE parameters MODIFY COLUMN description VARCHAR(500) NULL;
UPDATE parameters SET
  `key` = 'tipos_ajuste',
  description = 'Tipos de ajuste manual que se pueden aplicar a un crédito (cambio de fecha con interés, descuento, gasto de notificación, u otro).'
WHERE `key` = 'adjustment_types';

UPDATE parameters SET
  `key` = 'orden_aplicacion_pago',
  description = 'Orden en que se aplica un pago recibido a un crédito: primero gastos, luego mora, luego interés y por último capital.'
WHERE `key` = 'allocation_order';

UPDATE parameters SET
  `key` = 'politica_mora',
  description = 'Política de mora vigente: hoy la cooperativa no cobra interés de mora automático (confirmado contra el histórico real, sin evidencia de cargos automáticos por mora); solo hace seguimiento por rangos de días de atraso y aplica cargos puntuales manuales cuando corresponde.'
WHERE `key` = 'delinquency_policy';

UPDATE parameters SET
  `key` = 'tipos_identificacion',
  description = 'Tipos de documento de identificación aceptados para asociados y usuarios del sistema.'
WHERE `key` = 'id_types';

UPDATE parameters SET
  `key` = 'modelo_interes',
  description = 'Modelo de interés usado para calcular las cuotas: interés fijo sobre el capital original repartido en partes iguales entre todas las cuotas (no es amortización francesa). Confirmado contra el histórico real de créditos de la cooperativa.'
WHERE `key` = 'interest_model';

UPDATE parameters SET
  `key` = 'rangos_mora',
  description = 'Rangos (buckets) de días de atraso usados para clasificar la mora de cada cuota, con los mismos códigos que usa hoy la cooperativa en su Excel.'
WHERE `key` = 'mora_buckets';

UPDATE parameters SET
  `key` = 'metodos_pago',
  description = 'Métodos de pago aceptados para registrar un abono a un crédito.'
WHERE `key` = 'payment_methods';

-- ============================================================
-- 012_enable_rls_and_fix_search_path.sql
-- ============================================================

-- SIN CAMBIOS PARA MYSQL.
--
-- En Postgres/Supabase esta migración activaba Row Level Security en las 25
-- tablas y fijaba el search_path de la función set_updated_at(), porque
-- Supabase expone un API REST público (PostgREST) sobre la base de datos.
--
-- MySQL no tiene Row Level Security ni ese API: el único acceso a la base es
-- el usuario con el que se conecta el backend. La protección equivalente es
-- de configuración, no de esquema:
--   * crear un usuario MySQL exclusivo para la app, con permisos solo sobre
--     esta base de datos (SELECT, INSERT, UPDATE, DELETE), sin GRANT ni DROP;
--   * no habilitar "Remote MySQL" en hPanel salvo que haga falta, y si se
--     habilita, limitarlo a las IP necesarias.
-- Tampoco hace falta la función set_updated_at(): las columnas updated_at ya
-- usan ON UPDATE CURRENT_TIMESTAMP.
--
-- La sentencia es un no-op para que el número de migración exista y quede
-- registrado igual que en Postgres.
DO 0;

-- ============================================================
-- 013_application_review.sql
-- ============================================================

-- Convierte "Solicitudes de crédito" en una pantalla de revisión funcional:
-- el revisor debe poder confirmar los documentos requeridos y a cada
-- codeudor/titular antes de aprobar la solicitud (antes solo existía un
-- botón "Aprobar" sin ninguna verificación real).
--
-- MySQL: las llaves foráneas van declaradas aparte (el REFERENCES en línea se
-- ignora) y el índice por solicitud lo cubre la llave única, por eso no se
-- repite el idx_application_documents_app de Postgres.

CREATE TABLE IF NOT EXISTS credit_application_documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  credit_application_id INT NOT NULL,
  document_type VARCHAR(80) NOT NULL,
  status ENUM('PENDIENTE','APROBADO','RECHAZADO') NOT NULL DEFAULT 'PENDIENTE',
  notes VARCHAR(255) NULL,
  reviewed_by INT NULL,
  reviewed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_application_document (credit_application_id, document_type),
  FOREIGN KEY (credit_application_id) REFERENCES credit_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE credit_participants
  ADD COLUMN status ENUM('PENDIENTE','APROBADO','RECHAZADO') NOT NULL DEFAULT 'PENDIENTE',
  ADD COLUMN notes VARCHAR(255) NULL,
  ADD COLUMN reviewed_by INT NULL,
  ADD COLUMN reviewed_at TIMESTAMP NULL DEFAULT NULL,
  ADD CONSTRAINT fk_credit_participants_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id);

INSERT INTO parameters (`key`, value, description) VALUES (
  'documentos_requeridos',
  '["Cedula de ciudadania", "Certificado laboral o de ingresos", "Desprendibles de pago", "Extractos bancarios", "Referencias personales"]',
  'Lista de documentos que el revisor debe verificar antes de aprobar una solicitud de crédito.'
) ON DUPLICATE KEY UPDATE `key` = `key`;

-- ============================================================
-- 014_dynamic_id_types.sql
-- ============================================================

-- SIN CAMBIOS PARA MYSQL.
--
-- En Postgres esta migración quitaba el CHECK de users.id_type (solo permitía
-- CC, CE, TI, PA, NIT) para que la lista de tipos de documento la gobierne
-- únicamente el parámetro `tipos_identificacion`. En MySQL la columna
-- users.id_type ya se crea sin ese CHECK (ver 010), y associates.id_type
-- nunca lo tuvo, así que no hay nada que quitar.
--
-- La sentencia es un no-op para que el número de migración exista y quede
-- registrado igual que en Postgres.
DO 0;

-- ============================================================
-- 015_dynamic_payment_and_adjustment_types.sql
-- ============================================================

-- Mismo caso que tipos_identificacion (014): "tipos_ajuste" en Parámetros
-- era solo de exhibición porque el formulario de ajustes de crédito traía
-- su propia lista fija, y aunque se hubiera leído del parámetro, la tabla
-- credit_adjustments solo permitía los 4 valores originales. Se abre para
-- que el parámetro gobierne la lista de verdad.
-- "metodos_pago" no necesita nada aquí: payments.payment_method nunca tuvo
-- restricción, solo el formulario traía la lista fija.
--
-- MySQL: en 005 la columna `type` se creó como ENUM (equivalente al CHECK de
-- Postgres); se convierte a VARCHAR conservando los valores ya guardados.
ALTER TABLE credit_adjustments MODIFY COLUMN type VARCHAR(30) NOT NULL;

-- ============================================================
-- 016_associate_rejected_status.sql
-- ============================================================

-- Un asociado que es rechazado como participante (titular o codeudor) al
-- revisar una solicitud de crédito debe quedar marcado como tal a nivel
-- global, para no poder volver a seleccionarlo como codeudor en una
-- solicitud nueva. El status de associates solo admitía ACTIVO/INACTIVO.
--
-- MySQL: la columna es un ENUM (ver 002), así que se amplía con MODIFY en vez
-- de reemplazar un CHECK como en Postgres.
ALTER TABLE associates
  MODIFY COLUMN status ENUM('ACTIVO','INACTIVO','RECHAZADO') NOT NULL DEFAULT 'ACTIVO';

-- ============================================================
-- 017_associate_employment_flag.sql
-- ============================================================

-- El formulario de Asociados necesita un campo explícito "¿Es empleado?"
-- (sí/no) que determine si los datos de la empresa son obligatorios, en vez
-- de inferirlo de si employer_name viene vacío o no.
ALTER TABLE associates ADD COLUMN is_employed BOOLEAN NOT NULL DEFAULT FALSE;

-- Asociados existentes que ya tenían datos de empresa cargados se marcan
-- como empleados para no perder esa información de vista.
UPDATE associates SET is_employed = TRUE WHERE employer_name IS NOT NULL AND employer_name <> '';

-- ============================================================
-- 018_password_reset_tokens.sql
-- ============================================================

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

-- ============================================================
-- Registro de migraciones aplicadas (mismas columnas que usa el runner de
-- Postgres, para poder usar un runner con MySQL más adelante sin repetirlas)
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
  name VARCHAR(160) NOT NULL PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO schema_migrations (name) VALUES
  ('001_init.sql'),
  ('002_associates.sql'),
  ('003_credit_lifecycle.sql'),
  ('004_payments_delinquency.sql'),
  ('005_collections_and_refinancing.sql'),
  ('006_gastos_imputation.sql'),
  ('007_funder_rate.sql'),
  ('008_users_write_permission.sql'),
  ('009_associate_employer_fields.sql'),
  ('010_user_contact_fields.sql'),
  ('011_spanish_parameter_names.sql'),
  ('012_enable_rls_and_fix_search_path.sql'),
  ('013_application_review.sql'),
  ('014_dynamic_id_types.sql'),
  ('015_dynamic_payment_and_adjustment_types.sql'),
  ('016_associate_rejected_status.sql'),
  ('017_associate_employment_flag.sql'),
  ('018_password_reset_tokens.sql');

import bcrypt from "bcryptjs";
import { pool } from "./pool.js";
import { buildAmortizationSchedule } from "../modules/credits/schedule.service.js";
import { DEFAULT_DELINQUENCY_POLICY, MORA_BUCKETS } from "../modules/delinquency/delinquency.service.js";

const PERMISSIONS = [
  "associates:write",
  "applications:write",
  "applications:approve",
  "disbursements:write",
  "payments:write",
  "alerts:write",
  "parameters:write",
  "audit:read",
  "integration:write",
  "reports:read",
  "adjustments:write",
  "collections:write"
];

const ROLES: Record<string, string[]> = {
  ADMIN: PERMISSIONS,
  OPERADOR: [
    "associates:write",
    "applications:write",
    "payments:write",
    "alerts:write",
    "reports:read",
    "collections:write"
  ],
  APROBADOR: ["applications:approve", "disbursements:write", "reports:read", "adjustments:write"],
  CONTADORA: ["integration:write", "reports:read", "audit:read"],
  CONSULTA: ["reports:read"]
};

async function upsertRolesAndPermissions() {
  const permissionIds: Record<string, number> = {};
  for (const code of PERMISSIONS) {
    await pool.query(`INSERT INTO permissions (code) VALUES (?) ON CONFLICT (code) DO NOTHING`, [code]);
    const [rows] = await pool.query<any[]>(`SELECT id FROM permissions WHERE code = ?`, [code]);
    permissionIds[code] = (rows as any[])[0].id;
  }

  const roleIds: Record<string, number> = {};
  for (const [code, name] of Object.entries({
    ADMIN: "Administrador",
    OPERADOR: "Operador de cartera",
    APROBADOR: "Aprobador",
    CONTADORA: "Contadora",
    CONSULTA: "Consulta"
  })) {
    await pool.query(
      `INSERT INTO roles (code, name) VALUES (?, ?) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
      [code, name]
    );
    const [rows] = await pool.query<any[]>(`SELECT id FROM roles WHERE code = ?`, [code]);
    roleIds[code] = (rows as any[])[0].id;
  }

  for (const [roleCode, perms] of Object.entries(ROLES)) {
    for (const perm of perms) {
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)
         ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [roleIds[roleCode], permissionIds[perm]]
      );
    }
  }

  return roleIds;
}

async function upsertUser(email: string, username: string, fullName: string, roleId: number | undefined) {
  if (roleId === undefined) throw new Error(`Rol no encontrado para el usuario ${email}`);
  const passwordHash = await bcrypt.hash("Demo1234*", 10);
  await pool.query(
    `INSERT INTO users (email, username, password_hash, full_name)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name`,
    [email, username, passwordHash, fullName]
  );
  const [rows] = await pool.query<any[]>(`SELECT id FROM users WHERE email = ?`, [email]);
  const userId = (rows as any[])[0].id;
  await pool.query(
    `INSERT INTO user_roles (user_id, role_id) VALUES (?, ?) ON CONFLICT (user_id, role_id) DO NOTHING`,
    [userId, roleId]
  );
  return userId;
}

async function seedParameters() {
  const params: Record<string, unknown> = {
    delinquency_policy: DEFAULT_DELINQUENCY_POLICY,
    mora_buckets: MORA_BUCKETS,
    allocation_order: ["GASTOS", "MORA", "INTERES", "CAPITAL"],
    payment_methods: ["EFECTIVO", "TRANSFERENCIA", "CONSIGNACION", "DESCUENTO_NOMINA"],
    id_types: ["CC", "CE", "TI", "PA", "NIT"],
    interest_model: {
      type: "FLAT_SIMPLE",
      description:
        "Interés fijo sobre el capital original, repartido en partes iguales entre todas las cuotas. Confirmado contra el histórico real de la cooperativa (créditos a ~4% mensual plano). No es amortización francesa.",
      defaultMonthlyRatePercent: 4
    },
    adjustment_types: ["INTERES_CAMBIO_FECHA", "DESCUENTO", "GASTO_NOTIFICACION", "OTRO"]
  };
  for (const [key, value] of Object.entries(params)) {
    await pool.query(
      `INSERT INTO parameters (\`key\`, value, description) VALUES (?, ?, ?)
       ON CONFLICT ("key") DO NOTHING`,
      [key, JSON.stringify(value), "Parámetro de demostración, pendiente de confirmación definitiva"]
    );
  }
}

async function run() {
  const roleIds = await upsertRolesAndPermissions();
  await seedParameters();

  const adminId = await upsertUser("admin@cooperativa.demo", "admin", "Administradora Demo", roleIds.ADMIN);
  const operadorId = await upsertUser("operador@cooperativa.demo", "operador", "Operador de Cartera", roleIds.OPERADOR);
  await upsertUser("aprobador@cooperativa.demo", "aprobador", "Aprobador de Créditos", roleIds.APROBADOR);
  await upsertUser("contadora@cooperativa.demo", "contadora", "Contadora Externa", roleIds.CONTADORA);
  await upsertUser("consulta@cooperativa.demo", "consulta", "Usuario de Consulta", roleIds.CONSULTA);

  await pool.query(
    `INSERT INTO associates (id_type, id_number, first_name, last_name, phone, email, municipality, department, data_consent, created_by)
     VALUES ('CC', '1000111222', 'Laura', 'Gómez Pérez', '3001234567', 'laura.gomez@demo.co', 'Bogotá', 'Bogotá D.C.', TRUE, ?)
     ON CONFLICT (id_type, id_number) DO UPDATE SET first_name = EXCLUDED.first_name`,
    [adminId]
  );
  const [assocRows] = await pool.query<any[]>(
    `SELECT id FROM associates WHERE id_type='CC' AND id_number='1000111222'`
  );
  const associateId = (assocRows as any[])[0].id;

  await pool.query(
    `INSERT INTO associates (id_type, id_number, first_name, last_name, phone, email, municipality, department, data_consent, created_by)
     VALUES ('CC', '1000333444', 'Carlos', 'Ramírez Ruiz', '3007654321', 'carlos.ramirez@demo.co', 'Medellín', 'Antioquia', TRUE, ?)
     ON CONFLICT (id_type, id_number) DO UPDATE SET first_name = EXCLUDED.first_name`,
    [adminId]
  );
  const [coDebtorSelect] = await pool.query<any[]>(
    `SELECT id FROM associates WHERE id_type='CC' AND id_number='1000333444'`
  );
  const coDebtorId = (coDebtorSelect as any[])[0].id;

  const [appResult] = await pool.query<any>(
    `INSERT INTO credit_applications
      (titular_associate_id, requested_amount, term_value, interest_rate, rate_type, expected_disbursement_date, purpose, status, created_by, decided_by, decided_at)
     VALUES (?, 5000000, 12, 4, 'NOMINAL_MENSUAL', CURRENT_DATE, 'Libre inversión', 'APROBADA', ?, ?, now())`,
    [associateId, adminId, adminId]
  );
  const applicationId = appResult.insertId;

  await pool.query(
    `INSERT INTO credit_participants (credit_application_id, associate_id, role) VALUES (?, ?, 'TITULAR')`,
    [applicationId, associateId]
  );
  await pool.query(
    `INSERT INTO credit_participants (credit_application_id, associate_id, role) VALUES (?, ?, 'CODEUDOR')`,
    [applicationId, coDebtorId]
  );
  await pool.query(
    `INSERT INTO credit_application_status_history (credit_application_id, from_status, to_status, reason, user_id)
     VALUES (?, 'RADICADA', 'APROBADA', 'Aprobación de demostración', ?)`,
    [applicationId, adminId]
  );

  const disbursementDate = new Date();
  disbursementDate.setMonth(disbursementDate.getMonth() - 2);
  const firstInstallmentDate = new Date(disbursementDate);
  firstInstallmentDate.setMonth(firstInstallmentDate.getMonth() + 1);

  const [creditResult] = await pool.query<any>(
    `INSERT INTO credits
      (credit_number, credit_application_id, titular_associate_id, assigned_collector_id, assigned_seller_id, disbursed_amount, principal_balance, interest_rate, rate_type, term_value, disbursement_date, first_installment_date, delinquency_policy_snapshot, parameters_snapshot, created_by)
     VALUES ('CR-DEMO-00001', ?, ?, ?, ?, 5000000, 5000000, 4, 'NOMINAL_MENSUAL', 12, ?, ?, ?, ?, ?)`,
    [
      applicationId,
      associateId,
      operadorId,
      adminId,
      disbursementDate.toISOString().slice(0, 10),
      firstInstallmentDate.toISOString().slice(0, 10),
      JSON.stringify(DEFAULT_DELINQUENCY_POLICY),
      JSON.stringify({ rateType: "NOMINAL_MENSUAL", termValue: 12 }),
      adminId
    ]
  );
  const creditId = creditResult.insertId;

  await pool.query(`UPDATE credit_applications SET status = 'DESEMBOLSADA' WHERE id = ?`, [applicationId]);
  await pool.query(`UPDATE credit_participants SET credit_id = ? WHERE credit_application_id = ?`, [
    creditId,
    applicationId
  ]);

  const schedule = buildAmortizationSchedule({
    principal: 5000000,
    monthlyRatePercent: 4,
    termMonths: 12,
    firstInstallmentDate
  });

  for (const row of schedule) {
    await pool.query(
      `INSERT INTO credit_schedule_installments
        (credit_id, installment_number, due_date, principal_due, interest_due, other_due, total_due, balance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [creditId, row.installmentNumber, row.dueDate, row.principalDue, row.interestDue, row.otherDue, row.totalDue, row.totalDue]
    );
  }

  // Pago puntual de la primera cuota (demo): simula pago ya recibido.
  const [firstInstallmentRows] = await pool.query<any[]>(
    `SELECT * FROM credit_schedule_installments WHERE credit_id = ? AND installment_number = 1`,
    [creditId]
  );
  const firstInstallment = (firstInstallmentRows as any[])[0];

  const [paymentResult] = await pool.query<any>(
    `INSERT INTO payments (credit_id, received_date, effective_date, amount, payment_method, reference, created_by)
     VALUES (?, ?, ?, ?, 'TRANSFERENCIA', 'DEMO-001', ?)`,
    [creditId, firstInstallment.due_date, firstInstallment.due_date, firstInstallment.total_due, adminId]
  );
  await pool.query(
    `INSERT INTO payment_allocations (payment_id, installment_id, concept, amount) VALUES
      (?, ?, 'INTERES', ?), (?, ?, 'CAPITAL', ?)`,
    [
      paymentResult.insertId,
      firstInstallment.id,
      firstInstallment.interest_due,
      paymentResult.insertId,
      firstInstallment.id,
      firstInstallment.principal_due
    ]
  );
  await pool.query(
    `UPDATE credit_schedule_installments SET principal_paid = principal_due, interest_paid = interest_due, balance = 0, status = 'PAGADA' WHERE id = ?`,
    [firstInstallment.id]
  );
  await pool.query(`UPDATE credits SET principal_balance = principal_balance - ? WHERE id = ?`, [
    firstInstallment.principal_due,
    creditId
  ]);

  // Compromiso de pago y ajuste de demostración (hallazgos del Excel real).
  await pool.query(
    `INSERT INTO collection_actions (credit_id, action_type, description, promise_date, promise_status, created_by)
     VALUES (?, 'GESTION_COBRO', 'Cliente promete pagar la cuota 2', CURRENT_DATE + INTERVAL '3 days', 'PENDIENTE', ?)`,
    [creditId, operadorId]
  );
  await pool.query(
    `INSERT INTO credit_adjustments (credit_id, type, amount, reason, approved_by)
     VALUES (?, 'GASTO_NOTIFICACION', 15000, 'Costo de notificación por atraso en cuota 2', ?)`,
    [creditId, adminId]
  );

  console.log("Datos de demostración creados.");
  console.log("Usuarios (contraseña Demo1234*): admin, operador, aprobador, contadora, consulta");
  console.log(`Crédito de demostración: CR-DEMO-00001 (id ${creditId})`);
  await pool.end();
}

run().catch((err) => {
  console.error("Error ejecutando seed", err);
  process.exit(1);
});

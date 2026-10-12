// Mide las consultas reales de la app: plan de EXPLAIN + tiempo (mediana). SOLO LECTURA (SELECT).
// Uso (contra una base de PRUEBAS con datos sembrados; ver docs/escalabilidad.md §6):
//   DB_HOST=127.0.0.1 DB_USER=… DB_PASSWORD=… DB_NAME=… node scripts/explain-bench.mjs [salida.json]
// Las consultas están copiadas de los archivos de rutas; si cambia una consulta, actualícela aquí.
import fs from "node:fs";
import mysql from "mysql2/promise";

const conn = await mysql.createConnection({
  host: process.env.DB_HOST ?? "127.0.0.1", user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, charset: "utf8mb4", dateStrings: true, decimalNumbers: false
});
await conn.query("SET SESSION sql_mode = CONCAT(@@sql_mode, ',ANSI_QUOTES,PIPES_AS_CONCAT')");

const read = (f) => fs.readFileSync(new URL(`../src/modules/${f}`, import.meta.url), "utf8");
// Extrae una consulta grande (plantilla de texto) de un archivo de rutas, por su inicio.
const extract = (file, start) => {
  const src = read(file); const i = src.indexOf(start);
  if (i < 0) throw new Error(`no se encontró ${start} en ${file}`);
  const j = src.indexOf("`", i);
  return src.slice(i, j);
};

const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7) + "-01";
const credit = 7000; // un crédito cualquiera con cuotas y pagos
const Q = [
  ["asociados: listado", "SELECT * FROM associates ORDER BY created_at DESC LIMIT 20 OFFSET 0"],
  ["asociados: conteo", "SELECT COUNT(*) as total FROM associates"],
  ["asociados: búsqueda por nombre", "SELECT * FROM associates WHERE (first_name LIKE '%mar%' OR last_name LIKE '%mar%' OR id_number LIKE '%mar%') ORDER BY created_at DESC LIMIT 20"],
  ["asociados: búsqueda por cédula", "SELECT * FROM associates WHERE (first_name LIKE '%1005007%' OR last_name LIKE '%1005007%' OR id_number LIKE '%1005007%') ORDER BY created_at DESC LIMIT 20"],
  ["asociados: selector (ACTIVO)", "SELECT * FROM associates WHERE status = 'ACTIVO' ORDER BY created_at DESC LIMIT 100"],
  ["créditos: listado", "SELECT c.*, a.first_name, a.last_name, s.legal_name, (SELECT MAX(GREATEST(DATEDIFF(CURRENT_DATE, csi.due_date), 0)) FROM credit_schedule_installments csi WHERE csi.credit_id = c.id AND csi.status NOT IN ('PAGADA','ANULADA')) AS max_overdue_days FROM credits c LEFT JOIN associates a ON a.id = c.titular_associate_id LEFT JOIN societies s ON s.id = c.titular_society_id ORDER BY c.created_at DESC LIMIT 20 OFFSET 0"],
  ["créditos: listado VIGENTE", "SELECT c.*, a.first_name, a.last_name, s.legal_name, (SELECT MAX(GREATEST(DATEDIFF(CURRENT_DATE, csi.due_date), 0)) FROM credit_schedule_installments csi WHERE csi.credit_id = c.id AND csi.status NOT IN ('PAGADA','ANULADA')) AS max_overdue_days FROM credits c LEFT JOIN associates a ON a.id = c.titular_associate_id LEFT JOIN societies s ON s.id = c.titular_society_id WHERE c.status = 'VIGENTE' ORDER BY c.created_at DESC LIMIT 20 OFFSET 0"],
  ["créditos: conteo VIGENTE", "SELECT COUNT(*) as total FROM credits c WHERE c.status = 'VIGENTE'"],
  ["solicitudes: listado RADICADA", "SELECT ca.*, a.first_name, a.last_name, s.legal_name FROM credit_applications ca LEFT JOIN associates a ON a.id = ca.titular_associate_id LEFT JOIN societies s ON s.id = ca.titular_society_id WHERE ca.status = 'RADICADA' ORDER BY ca.created_at DESC LIMIT 20 OFFSET 0"],
  ["solicitudes: listado (todas)", "SELECT ca.*, a.first_name, a.last_name, s.legal_name FROM credit_applications ca LEFT JOIN associates a ON a.id = ca.titular_associate_id LEFT JOIN societies s ON s.id = ca.titular_society_id ORDER BY ca.created_at DESC LIMIT 20 OFFSET 0"],
  ["alertas: listado ABIERTA", "SELECT a.*, c.credit_number FROM alerts a LEFT JOIN credits c ON c.id = a.credit_id WHERE a.status = 'ABIERTA' ORDER BY a.priority DESC, a.created_at DESC LIMIT 20 OFFSET 0"],
  ["alertas: listado ATENDIDA", "SELECT a.*, c.credit_number FROM alerts a LEFT JOIN credits c ON c.id = a.credit_id WHERE a.status = 'ATENDIDA' ORDER BY a.priority DESC, a.created_at DESC LIMIT 20 OFFSET 0"],
  ["auditoría: listado", "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 20 OFFSET 0"],
  ["auditoría: listado por entidad", "SELECT * FROM audit_logs WHERE entity = 'payment' ORDER BY created_at DESC LIMIT 20 OFFSET 0"],
  ["auditoría: conteo", "SELECT COUNT(*) as total FROM audit_logs"],
  ["dashboard: capital y vigentes", "SELECT COALESCE(SUM(principal_balance), 0) as capitalPendiente, COUNT(*) as creditosVigentes FROM credits WHERE status = 'VIGENTE'"],
  ["dashboard: créditos vencidos", "SELECT COUNT(DISTINCT credit_id) as creditosVencidos FROM credit_schedule_installments WHERE status IN ('VENCIDA','EN_MORA')"],
  ["dashboard: pagos 30 días", "SELECT COALESCE(SUM(amount), 0) as pagosPeriodo FROM payments WHERE status = 'CONFIRMADO' AND received_date >= CURRENT_DATE - INTERVAL 30 DAY"],
  ["dashboard: solicitudes pendientes", "SELECT COUNT(*) as solicitudesPendientes FROM credit_applications WHERE status IN ('RADICADA','EN_REVISION')"],
  ["dashboard: alertas por prioridad", "SELECT priority, COUNT(*) as total FROM alerts WHERE status = 'ABIERTA' GROUP BY priority"],
  ["reporte: vencen en fecha", `SELECT csi.*, c.credit_number, a.first_name, a.last_name, s.legal_name FROM credit_schedule_installments csi JOIN credits c ON c.id = csi.credit_id LEFT JOIN associates a ON a.id = c.titular_associate_id LEFT JOIN societies s ON s.id = c.titular_society_id WHERE csi.due_date = '${today}' AND csi.status NOT IN ('PAGADA','ANULADA')`],
  ["reporte: cartera vencida", "SELECT csi.*, c.credit_number, a.first_name, a.last_name FROM credit_schedule_installments csi JOIN credits c ON c.id = csi.credit_id LEFT JOIN associates a ON a.id = c.titular_associate_id WHERE csi.status IN ('VENCIDA','EN_MORA') ORDER BY csi.overdue_days DESC"],
  ["reporte: buckets de mora", "SELECT csi.overdue_days, (csi.total_due - csi.principal_paid - csi.interest_paid) AS outstanding FROM credit_schedule_installments csi JOIN credits c ON c.id = csi.credit_id WHERE csi.status NOT IN ('PAGADA','ANULADA') AND c.status NOT IN ('PAGADO','ANULADO') AND csi.overdue_days > 0"],
  ["reporte: resumen mensual", extract("reports/reports.routes.ts", "WITH disb AS").replace("${where}", "")],
  ["reporte: detalle mensual por crédito", extract("reports/reports.routes.ts", "WITH bounds AS").replaceAll("?", `'${month}'`)],
  ["reporte: pagos.csv", "SELECT p.id, p.credit_id, c.credit_number, p.received_date, p.amount, p.payment_method, p.status FROM payments p JOIN credits c ON c.id = p.credit_id ORDER BY p.received_date DESC"],
  ["login: conteo de fallos", "SELECT COUNT(*) AS total FROM login_activity WHERE user_id = 7 AND event_type = 'LOGIN_FAILED' AND created_at > NOW() - INTERVAL 15 MINUTE AND created_at > COALESCE((SELECT MAX(created_at) FROM login_activity WHERE user_id = 7 AND event_type = 'LOGIN'), '1970-01-01 00:00:01')"],
  ["detalle crédito: cuotas", `SELECT * FROM credit_schedule_installments WHERE credit_id = ${credit} ORDER BY installment_number ASC`],
  ["detalle crédito: pagos", `SELECT * FROM payments WHERE credit_id = ${credit} ORDER BY received_date DESC`],
  ["detalle crédito: alertas", `SELECT * FROM alerts WHERE credit_id = ${credit} ORDER BY created_at DESC`],
  ["job: cuotas abiertas", "SELECT csi.id, csi.credit_id, csi.installment_number, csi.due_date, csi.status, csi.overdue_days FROM credit_schedule_installments csi JOIN credits c ON c.id = csi.credit_id WHERE csi.status IN ('PENDIENTE','PARCIAL','VENCIDA','EN_MORA') AND c.status NOT IN ('PAGADO','ANULADO')"],
  ["job: alertas abiertas", "SELECT installment_id, type FROM alerts WHERE status = 'ABIERTA' AND installment_id IS NOT NULL"]
];

const only = process.env.ONLY;
const median = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
const out = [];
for (const [name, sql] of Q) {
  if (only && !name.includes(only)) continue;
  let plan = [];
  try { [plan] = await conn.query("EXPLAIN " + sql); } catch (e) { plan = [{ table: "ERROR", Extra: e.message }]; }
  const runs = Number(process.env.RUNS ?? 5);
  const times = [];
  let rows = 0;
  for (let i = 0; i < runs + 1; i++) {
    const t = process.hrtime.bigint();
    const [r] = await conn.query(sql);
    const ms = Number(process.hrtime.bigint() - t) / 1e6;
    rows = Array.isArray(r) ? r.length : 0;
    if (i > 0) times.push(ms); // la primera corrida calienta
  }
  const worst = plan.reduce((m, p) => (Number(p.rows ?? 0) > Number(m.rows ?? 0) ? p : m), plan[0] ?? {});
  out.push({
    name, ms: Math.round(median(times) * 10) / 10, returned: rows,
    scan: plan.map((p) => `${p.table}:${p.type}${p.key ? "/" + p.key : ""}`).join(" · "),
    estRows: Number(worst.rows ?? 0),
    filesort: plan.some((p) => /filesort/i.test(p.Extra ?? "")), temp: plan.some((p) => /temporary/i.test(p.Extra ?? ""))
  });
}
console.log("consulta".padEnd(38), "ms".padStart(8), "filas".padStart(7), "est.filas".padStart(10), "fs", "tmp", " plan");
for (const r of out) console.log(r.name.padEnd(38), String(r.ms).padStart(8), String(r.returned).padStart(7), String(r.estRows).padStart(10), r.filesort ? "SÍ" : " .", r.temp ? "SÍ " : " . ", " " + r.scan.slice(0, 120));
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
await conn.end();

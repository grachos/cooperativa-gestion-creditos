# Concurrencia y transacciones

## Qué buscar

| Síntoma en el código | Daño real observado |
|---|---|
| Leer saldo → calcular en JS → `UPDATE ... SET saldo = ?` sin bloqueo | Dos pagos simultáneos: uno se pierde (actualización perdida) |
| `SELECT status` y luego `UPDATE` sin `FOR UPDATE` ni condición | Un pago reversado dos veces; una solicitud desembolsada dos veces (dos créditos) |
| Número consecutivo con `COUNT(*)+1` o `MAX(id)+1` | Números de crédito repetidos bajo concurrencia |
| Bloqueos en distinto orden según el endpoint (pago → crédito en uno, crédito → pago en otro) | Deadlocks → 500 al usuario |
| Job masivo que lee estados y luego los escribe sin condición | El job devolvía a VENCIDA una cuota que se acababa de pagar |
| Job con `UPDATE ... WHERE EXISTS (subconsulta)` en REPEATABLE READ | Gap locks: deadlock entre el job y los reversos |
| Decisiones (aprobar, rechazar, cancelar) como dos sentencias sueltas | Dos personas deciden a la vez y ambas "ganan" |
| Llamadas a correo/HTTP/archivos dentro de la transacción | Si la transacción se reintenta, el correo sale dos veces; además alarga los bloqueos |

## Reglas

1. **Bloquear primero, en orden fijo.** En cada operación de dinero, la primera sentencia de la
   transacción es `SELECT ... FOR UPDATE` de la entidad raíz (p. ej. el crédito), luego las hijas (el
   pago). Mismo orden en TODOS los endpoints → no hay ciclos → no hay deadlocks entre ellos. Documenta el
   orden en el `CLAUDE.md` del proyecto.
2. **Validar el estado después de bloquear**, no antes: el estado leído sin bloqueo puede haber cambiado.
   Solo permite operar sobre estados válidos (p. ej. pagos solo a VIGENTE o EN_MORA; reversos solo si el
   crédito no está REFINANCIADO/ANULADO).
3. **Transiciones de estado condicionales:** `UPDATE t SET status = 'APROBADA' WHERE id = ? AND status = 'EN_REVISION'`;
   si `affectedRows = 0`, responde 409 ("otra persona ya lo decidió"). Útil incluso con bloqueo, como
   segunda barrera.
4. **Operaciones compuestas, en una sola transacción.** Ej.: radicar una solicitud con titular y
   codeudores: si falla un codeudor, antes quedaba una solicitud a medias. Crear como borrador y pasar a
   radicada al final, dentro de la misma transacción.
5. **Dentro de la transacción solo trabajo de base de datos.** Correos, colas externas, notificaciones y
   eventos en vivo van después del COMMIT (o en una tabla outbox que se procesa aparte).
6. **Reintento automático ante deadlock** (MySQL errno 1213, Postgres SQLSTATE 40P01/40001): el helper
   `withTransaction` repite la transacción completa (2 reintentos, espera aleatoria 20–100 ms). Por eso
   la regla 5: lo que está adentro debe poder repetirse.
7. **Jobs masivos sin bloquear al usuario:** escriben con sentencias condicionales
   (`UPDATE ... WHERE id IN (?) AND status = <el que leí>`) y en `READ COMMITTED` (sin gap locks). Así no
   pisan un pago concurrente ni lo bloquean. Procesa por lotes, no fila por fila (N+1).
8. **Consecutivos atómicos:** tabla `sequences (name PK, value)` y, dentro de la transacción,
   `INSERT INTO sequences (name, value) VALUES (?, LAST_INSERT_ID(1)) ON DUPLICATE KEY UPDATE value = LAST_INSERT_ID(value + 1)`
   seguido de `SELECT LAST_INSERT_ID()` (MySQL; por conexión, seguro con concurrencia). Postgres: `SEQUENCE`
   o `INSERT ... ON CONFLICT DO UPDATE ... RETURNING value`. Más llave única en la columna del número.
9. **Llaves únicas para lo que no puede repetirse:** un desembolso por solicitud, un documento por tipo y
   asociado, una alerta abierta por cuota y tipo (columna `open_flag` = 1 o NULL + llave única: los NULL no
   chocan y el historial se conserva).

## Helper de referencia (Node + mysql2)

```ts
const DEADLOCK_ERRNO = 1213, DEADLOCK_RETRIES = 2;
export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err: any) {
      await conn.rollback().catch(() => undefined);
      if (err?.errno === DEADLOCK_ERRNO && attempt < DEADLOCK_RETRIES) {
        await sleep(20 + Math.random() * 80);
        continue;
      }
      throw err;
    } finally {
      conn.release();
    }
  }
}

export async function withReadCommitted<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.query("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED");
    return await fn(conn);
  } finally {
    await conn.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ").catch(() => undefined);
    conn.release();
  }
}
```

## Cómo diagnosticar un deadlock

`SHOW ENGINE INNODB STATUS` → sección LATEST DETECTED DEADLOCK: muestra las dos sentencias y qué
bloqueo esperaba cada una (`lock_mode S/X`, `gap`). Así se encontró que el job tomaba gap locks S con un
`WHERE EXISTS`. Reprodúcelo en una prueba con dos transacciones cruzadas antes de arreglar.

## Portabilidad

- **Postgres:** `FOR UPDATE` igual; el nivel por defecto es READ COMMITTED (sin gap locks), pero la regla 3
  sigue siendo necesaria. Reintentar con SQLSTATE 40P01 (deadlock) y 40001 (serialización).
- **ORM (Prisma, TypeORM, Sequelize):** confirma que la transacción usa la MISMA conexión en todas las
  sentencias y que expone `FOR UPDATE` (`$queryRaw`, `lock: { mode: 'pessimistic_write' }`).
- **Serverless con pool externo (PgBouncer en modo transaction):** las sentencias de sesión (`SET SESSION`)
  no persisten; usa `SET LOCAL` dentro de la transacción.

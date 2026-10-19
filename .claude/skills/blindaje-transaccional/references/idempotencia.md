# Idempotencia y doble clic

Una misma acción del usuario (doble clic, Enter repetido, reintento de red, timeout del proxy, recarga)
no debe crear dos registros. Se resuelve en **dos capas**: el navegador evita enviar dos veces y el
servidor garantiza que repetir no duplica.

## Capa servidor: `Idempotency-Key`

Middleware `idempotent("operacion", { transactional })` en cada endpoint que **crea** algo cuyo duplicado
hace daño (pagos, desembolsos, refinanciaciones, solicitudes, ajustes, usuarios, asociados).
No hace falta en transiciones que el servidor ya rechaza por estado (aprobar dos veces da 409).

Tabla:

```sql
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL, operation VARCHAR(60) NOT NULL, idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,              -- sha256(método + URL + cuerpo canónico); el cuerpo no se guarda
  state ENUM('IN_PROGRESS','COMPLETED') NOT NULL,
  response_status SMALLINT NULL, response_body MEDIUMTEXT NULL, response_content_type VARCHAR(120) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME NULL, expires_at DATETIME NOT NULL,
  UNIQUE KEY uq_idem (user_id, operation, idempotency_key)
);
```

Comportamiento:

- Sin header → se ejecuta normal (compatibilidad).
- La llave única serializa: solo un `INSERT ... IN_PROGRESS` gana. Los demás esperan (hasta
  `IDEMPOTENCY_WAIT_MS`, ~8 s) y reciben la respuesta guardada, o 409 `IDEMPOTENCY_IN_PROGRESS` con
  `Retry-After`.
- Misma clave + misma petición tras éxito → se repite la respuesta guardada, cabecera
  `Idempotent-Replayed: true`, sin ejecutar.
- Misma clave + contenido distinto → 409 `IDEMPOTENCY_KEY_REUSED`.
- 4xx → se libera la clave (falló antes del efecto, se puede reintentar).
- 5xx → se libera solo si la operación es `transactional` (rollback = sin efecto). Si no lo es, queda
  IN_PROGRESS hasta vencer: el efecto es incierto y es preferible no repetirlo.
- Vigencia (`IDEMPOTENCY_TTL_HOURS`, 24 h) y purga periódica de las vencidas.
- Fingerprint con JSON canónico (llaves ordenadas): el mismo contenido da el mismo hash.

### El detalle que más se olvida: confirmar la clave DENTRO de la transacción

Si la clave se marca COMPLETED después del COMMIT (por ejemplo en el hook de `res.send`), un error entre
el COMMIT y esa escritura deja el pago guardado pero la clave liberada: **el reintento duplica el pago**.
Se comprobó con una prueba (error forzado después del COMMIT → dos pagos).

Arreglo: la ruta confirma la clave como última sentencia de su transacción:

```ts
export async function completeIdempotencyInTransaction(conn, res, status: number, body: unknown) {
  const id = res.locals.idempotencyKeyId;           // lo deja el middleware al reservar
  if (!id) return;                                   // petición sin Idempotency-Key
  await conn.query(
    `UPDATE idempotency_keys SET state='COMPLETED', response_status=?, response_body=?,
       response_content_type='application/json; charset=utf-8', completed_at=NOW() WHERE id=?`,
    [status, JSON.stringify(body), id]);
  res.locals.idempotencyCommitted = true;            // el hook de res.send ya no escribe
}
```

Y `release` borra solo filas `IN_PROGRESS`: si la transacción confirmó, la clave COMPLETED sobrevive al
500 posterior y el reintento recibe la respuesta original. Si hubo rollback, el UPDATE también se revirtió
y la clave se libera. Regla para el `CLAUDE.md`: toda ruta transaccional con `idempotent(...)` llama a
este helper.

## Capa navegador

1. **Hook `useIdempotentSubmit(scope)`**: `pending` pasa a true al instante (botón deshabilitado + "Registrando…")
   **y** un `ref` síncrono ignora cualquier envío mientras hay uno en curso. El `disabled` solo no basta:
   un doble clic o Enter repetido dispara dos envíos antes de que React vuelva a pintar.
2. **Una clave por operación lógica**, no por clic: se reutiliza en cada reintento del mismo contenido
   (incluido el reintento tras renovar el token) y se descarta al tener éxito. Contenido distinto → clave
   nueva. Guardarla en `sessionStorage` para que sobreviva a una recarga.
3. **Reintentos automáticos solo con clave**: fallo de red, 502/503/504 e `IDEMPOTENCY_IN_PROGRESS`, con
   espera creciente (400, 1200, 2500 ms). Sin clave, nunca reintentar un POST.
4. **Cotizar y confirmar** en operaciones con cálculo (cancelación anticipada, refinanciación): el
   formulario muestra el desglose y envía `expectedTotal`; si el servidor calcula otro total, responde
   409 "el valor cambió, revise y confirme de nuevo". Evita cobrar un monto que el usuario no vio.

## Si hay proveedores externos (pasarela de pago)

Propaga la misma `Idempotency-Key` al proveedor; nunca llames al proveedor dentro de la transacción de
base de datos (ver concurrencia, regla 5): usa outbox o un estado intermedio "PENDIENTE_PROVEEDOR".

## Portabilidad

- Postgres: `INSERT ... ON CONFLICT DO NOTHING RETURNING id` para reservar.
- Sin tabla propia (Redis): `SET key value NX PX ttl` reserva, pero la confirmación dentro de la
  transacción del negocio requiere que la clave viva en la MISMA base que el efecto. Con Redis solo, el
  hueco del commit ambiguo no se puede cerrar: dilo en el informe.

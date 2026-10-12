# Escalabilidad y rendimiento

Documento vivo. Registra el diagnóstico de escalabilidad (octubre 2026), qué se
ha corregido, cómo verificarlo y qué falta. **Cada cambio de rendimiento,
concurrencia o capacidad debe actualizarse aquí** (ver `CLAUDE.md`).

- Estado de cada hallazgo: ✅ hecho · 🔶 parcial · ⏳ pendiente · 🔍 requiere validación
- Tipo: **C** confirmado en el código · **R** riesgo probable (hay que medirlo) · **O** opcional

## 1. Resumen

Para la escala actual (decenas de funcionarios) la app funciona. No está lista
para cientos o miles de usuarios concurrentes. Riesgos principales detectados:

1. Carreras en operaciones de dinero (pagos, reversos, desembolsos, refinanciación).
2. Estado en memoria con varios procesos Node (SSE, rate limit, job diario) y pool de conexiones sin límites de espera.
3. CPU del hilo principal ocupada por bcrypt, y tablas que crecen sin índices.

## 2. Hallazgos y estado

| # | Pri. | Tipo | Hallazgo | Estado |
|---|---|---|---|---|
| 1 | P0 | C | Pagos concurrentes al mismo crédito: abonos perdidos/duplicados y deadlocks (500) | ✅ [§3.1](#31-bloqueos-de-filas-en-operaciones-de-dinero) |
| 2 | P0 | C | Un pago se puede reversar varias veces a la vez | ✅ §3.1 |
| 3 | P0 | C | Una solicitud se puede desembolsar dos veces (dos créditos) | ✅ §3.1 |
| 4 | P1 | C | Número de crédito con `COUNT(*)+1` (se repite bajo concurrencia) | ✅ §3.2 |
| 5 | P1 | C | Refinanciación doble del mismo crédito | ✅ §3.1 |
| 6 | P0 | C | bcryptjs (JS puro) bloquea el hilo principal en login/refresh/correo | ✅ [§3.3](#33-cpu-de-hashes-bcrypt-nativo-y-sha-256-en-tokens) |
| 7 | P0 | R | Varios procesos Node con estado en memoria (SSE, rate limit, job diario ×N) | 🔍 §5 |
| 8 | P0 | R | Pool de 10 conexiones sin `queueLimit` ni timeouts | ⏳ |
| 9 | P0 | R | SSE ocupa una conexión por pestaña, sin heartbeat | ⏳ |
| 10 | P1 | C | Job de alertas: N+1 y sin exclusión mutua (duplicados) | ⏳ |
| 11 | P1 | C | `audit_logs` sin índices; listados ordenados sin índice; búsqueda `LIKE '%x%'` | ⏳ (validar con EXPLAIN) |
| 12 | P1 | C | Reportes y exportaciones sin límite (cargan todo el histórico) | ⏳ |
| 13 | P1 | C | Correo de restablecimiento dentro de la petición, sin timeout SMTP | ⏳ |
| 14 | P1 | C | Sin logs de peticiones, métricas ni alertas; `/health` no toca la base | ⏳ |
| 15 | P1 | R | Respuestas de la API sin `Cache-Control` (riesgo con CDN/LiteSpeed cache) | ⏳ |
| 16 | P2 | C | `COUNT(*)` en cada listado; `parameters` se lee en casi cada operación | ⏳ |

El detalle de índices recomendados, de caché, de tareas asíncronas y el plan de
pruebas de carga está en las secciones 6 a 8.

## 3. Cambios realizados

### 3.1 Bloqueos de filas en operaciones de dinero

**Problema (confirmado con pruebas antes del arreglo):** ninguna transacción
bloqueaba filas. Resultados medidos contra MariaDB con el código anterior:

| Escenario | Antes | Ahora |
|---|---|---|
| 8 pagos simultáneos al mismo crédito | 1 correcto, **7 con error 500** (deadlock) | 8 correctos, saldos consistentes |
| 3 reversos simultáneos del mismo pago | **3 aplicados** (cuotas con abonos negativos) | 1 aplicado, 2 con 409 |
| 3 refinanciaciones simultáneas del mismo crédito | **3 aplicadas** | 1 aplicada, 2 con 409 |
| 5 desembolsos simultáneos (solicitudes distintas) | **4 fallan** (número de crédito repetido) | 5 correctos, números distintos |
| 4 desembolsos de la misma solicitud | pasaba por casualidad (choque de número) | 1 correcto, 3 con 409 |

**Solución:** `SELECT … FOR UPDATE` como **primera sentencia** de cada
transacción, siempre en el mismo orden (crédito → pago):

| Operación | Fila bloqueada | Archivo |
|---|---|---|
| Registrar pago | `credits` del pago | `modules/payments/payments.routes.ts` |
| Reversar pago | `credits` y luego `payments` | `modules/payments/payments.routes.ts` |
| Desembolsar | `credit_applications` | `modules/credits/credits.routes.ts` |
| Refinanciar | `credits` | `modules/credits/credits.routes.ts` |

**Regla para quien programe una operación nueva sobre dinero** (importante):

1. El bloqueo debe ser la primera sentencia de la transacción. InnoDB (REPEATABLE
   READ) fija la "foto" de los datos en la primera lectura NORMAL; si se lee algo
   antes de bloquear, las lecturas posteriores verían datos viejos aunque el
   bloqueo ya se haya concedido. Por eso el reverso averigua el `credit_id` con
   una consulta **fuera** de la transacción y luego bloquea.
2. Orden de bloqueo único: crédito → pago. No invertirlo (deadlocks).
3. Mantener las transacciones cortas: el bloqueo se mantiene hasta el commit.

**Red de seguridad en la base de datos** (migración `020_concurrency_guards.sql`):
tabla `application_disbursements` con llave primaria `credit_application_id`;
si el bloqueo fallara, una segunda inserción da 409 "La solicitud ya fue
desembolsada". No se puso `UNIQUE` sobre `credits.credit_application_id` porque
la refinanciación reutiliza esa columna a propósito.

### 3.2 Número de crédito atómico

`nextCreditNumber(conn)` ahora usa la tabla `sequences`
(`INSERT … ON DUPLICATE KEY UPDATE value = LAST_INSERT_ID(value + 1)`) dentro de
la transacción del desembolso/refinanciación. Los números salen consecutivos, no se
repiten y un rollback no consume el número. La migración 020 inicializa el
contador de cada año con el mayor número ya usado (probado sobre una base con 40
créditos: el contador arrancó en 40).

### 3.3 CPU de hashes: bcrypt nativo y SHA-256 en tokens

**Problema:** `bcryptjs` es JavaScript puro y corre en el hilo principal. Cada
login hacía dos operaciones bcrypt (contraseña + hash del refresh token), cada
`/auth/refresh` una más, y cada correo de restablecimiento otra.

**Solución (dos partes):**

1. **Tokens con SHA-256** (`utils/tokenHash.ts`): el refresh token y el token de
   restablecer contraseña son aleatorios de alta entropía, no contraseñas; un hash
   lento no aporta seguridad y sí cuesta ~100 ms de CPU. Los hashes bcrypt ya
   guardados siguen funcionando: las sesiones antiguas se migran a SHA-256 en el
   primer `/auth/refresh`, y los enlaces de restablecimiento vigentes (1 h) siguen
   siendo válidos. El código de compatibilidad (`LEGACY_BCRYPT` en `tokenHash.ts` y la
   rama `check.legacy` de `/auth/refresh`) puede eliminarse pasados 7 días del despliegue.
2. **bcrypt nativo para contraseñas** (`utils/password.ts`): mismo algoritmo y
   formato (`$2a/$2b`, costo 10), por lo que los hashes existentes no se tocan; corre
   en el pool de hilos de libuv y no bloquea el servidor. Está en
   `optionalDependencies`: si no se puede instalar o cargar, se usa `bcryptjs`
   automáticamente (el arranque lo registra: `[password] hash de contraseñas: …`).

**Medición** (30 logins simultáneos, mismo equipo; `/health` consultado cada 5 ms
durante la prueba):

| Configuración | Tiempo total | p95 de /health durante el pico |
|---|---|---|
| Antes (bcryptjs, 2 hashes por login) | 5.323 ms | 1.385 ms |
| Solo SHA-256 en tokens (bcryptjs) | 2.904 ms | 1.384 ms |
| **Ahora (bcrypt nativo + SHA-256)** | **681 ms** | **9 ms** |

Un login aislado pasó de 248 ms a 134 ms. Script de medición: sección 4.

### 3.4 Otros arreglos hallados durante las pruebas

- `POST /auth/refresh` con un token manipulado o mal formado devolvía **500**; ahora devuelve 401.
- `AUTH_RATE_LIMIT` (por defecto 40 por 15 min por IP) es configurable para poder hacer pruebas de carga en un entorno de pruebas. **No subirlo en producción.**

## 4. Cómo verificar

Pruebas automáticas (carpeta `backend/src`). Las que necesitan base de datos son
opcionales y **crean datos de prueba: apúntelas a una base de pruebas, nunca a producción**.

```bash
cd backend
npm test                                   # sin base de datos: utilidades e idempotencia en memoria

DB="DB_HOST=127.0.0.1 DB_USER=… DB_PASSWORD=… DB_NAME=…"
env $DB CONCURRENCY_TEST_DB=1 npm test    # carreras: pagos, reversos, desembolsos, refinanciación
env $DB AUTH_TEST_DB=1 npm test           # tokens SHA-256 y compatibilidad con hashes bcrypt
env $DB IDEMPOTENCY_TEST_DB=1 npm test    # idempotencia contra MySQL real
```

Medición de bloqueo del servidor durante un pico de logins (usa el script de la
carpeta `scripts/`; requiere un usuario de prueba y `AUTH_RATE_LIMIT` alto):

```bash
AUTH_RATE_LIMIT=100000 PORT=4400 node dist/server.js &
BASE=http://127.0.0.1:4400 N=30 node scripts/bench-login.mjs
```

En producción: en los logs de Hostinger debe aparecer
`[password] hash de contraseñas: bcrypt (nativo)`. Si dice `bcryptjs (JavaScript)`,
el binario nativo no se pudo cargar (la app funciona igual, pero más lento bajo carga).

## 5. Información que falta (obtenerla antes de dimensionar)

1. **Usuarios reales esperados:** ¿solo funcionarios o también un portal de asociados? ¿concurrencia y pico (cierre de mes, fechas de pago)?
2. **Límites del plan de Hostinger:** hPanel → Avanzado → Uso de recursos (CPU, RAM, procesos). Preguntar a soporte cuántas instancias de Node arranca lsnode y si las conexiones largas (SSE) tienen tiempo límite. Pista: los logs muestran **dos** arranques por despliegue (`pid` ya se registra en el log de arranque).
3. **Límites de MySQL:** `SHOW VARIABLES WHERE Variable_name IN ('max_user_connections','max_connections','wait_timeout','innodb_buffer_pool_size'); SELECT VERSION();`
4. **Volumen por tabla:** `SELECT table_name, table_rows, ROUND((data_length+index_length)/1048576,1) AS mb FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY mb DESC;`
5. **Índices reales:** `SHOW INDEX FROM payments;` (y las demás tablas de la sección 6).
6. **Planes de ejecución:** `EXPLAIN` de cada consulta de la sección 6 sobre datos sembrados en un entorno de pruebas.

## 6. Índices recomendados (pendiente; validar con EXPLAIN antes de crearlos)

| Consulta | Índice | Motivo |
|---|---|---|
| `audit_logs [WHERE entity=?] ORDER BY created_at DESC LIMIT` | `(entity, created_at)`, `(created_at)` | Hoy recorre y ordena toda la tabla |
| Job: `alerts WHERE installment_id=? AND type=? AND status='ABIERTA'` | `(installment_id, type, status)`; idealmente una llave única que evite duplicados | Se ejecuta por cada cuota |
| `alerts WHERE status=? [AND priority=?] ORDER BY created_at DESC` | `(status, priority, created_at)` (reemplaza `idx_alerts_status`) | Evita filesort |
| `credits [WHERE status=?] ORDER BY created_at DESC` | `(status, created_at)`, `(created_at)` | Listado de cartera |
| `credit_applications [WHERE status…] ORDER BY created_at DESC` | `(status, created_at)` | Listado de solicitudes |
| `associates ORDER BY created_at DESC` y búsqueda | `(created_at)`; la búsqueda con `'%x%'` no usa índice: usar prefijo (`'x%'`) o FULLTEXT | Búsqueda |
| Reportes por `payments.received_date` | `(status, received_date)` | Dashboard y reportes mensuales |
| `payments WHERE credit_id=? ORDER BY received_date DESC` | `(credit_id, received_date)` (reemplaza `idx_payments_credit`) | Detalle del crédito |
| Cartera vencida | `credit_schedule_installments (status, overdue_days)`; reescribir `NOT IN (…)` como `IN (…)` | `NOT IN` impide usar el índice |
| `login_activity WHERE user_id=? AND event_type=? AND created_at>…` | `(user_id, event_type, created_at)` | Se ejecuta en cada login |

Evitar también `SELECT *` en listados (arrastra columnas JSON de auditoría y snapshots).

## 7. Caché y tareas asíncronas (pendiente)

- **Caché en memoria del proceso (TTL corto):** `parameters` (60 s; invalidar al editar), `/reports/dashboard` (30–60 s), `/reports/monthly-summary` (15 min o tabla resumen). Alcance global, solo datos agregados sin información personal.
- **No cachear:** detalle de crédito, asociados, pagos, auditoría y autenticación. Añadir `Cache-Control: no-store` a `/api/*`.
- **Redis:** no disponible en hosting compartido ni necesario hoy; solo al pasar a VPS/Cloud con varias instancias.
- **Asíncrono:** correo de restablecimiento (job con reintentos 1/5/15 min, SMTP con timeout de 10 s, respuesta 204 inmediata); recálculo de alertas con `GET_LOCK` para un único ejecutor y escritura por lotes; exportaciones en stream con tope por rango de fechas. Reutilizar el patrón de cola en base de datos de `integration_events`.

## 8. Plan de pruebas de carga (pendiente)

- **Herramienta:** k6. **Nunca contra `coomulnissi.cc`** (hosting compartido, usuarios reales, el rate limit bloquearía el login). Usar un sitio de pruebas con base propia, SMTP desactivado y `AUTH_RATE_LIMIT` alto.
- **Datos:** 10.000 asociados, 15.000 créditos (~180.000 cuotas), 300.000 pagos, 1.000.000 filas de auditoría, 50 usuarios.
- **Escenarios:** uso normal de oficina (listados 40 %, detalle 25 %, dashboard 15 %, pagos 10 %, solicitudes 5 %, reportes 5 %); pico de login; cierre de mes; carreras (varios usuarios sobre el mismo crédito: ya cubierto por `concurrency.test.ts`); job de alertas con la base grande.
- **Tipos:** carga normal (10→200 usuarios virtuales, escalones de 5 min), estrés (hasta >1 % de errores o p95 > 2 s), pico (0→300 en 30 s), larga duración (2–4 h al 50 %).
- **Métricas:** latencia p50/p95/p99 por endpoint, errores por código, CPU, memoria, lag del event loop, conexiones MySQL en uso, consultas lentas, deadlocks.
- **Aprobación:** p95 lecturas < 500 ms, escrituras < 1 s, p99 < 2 s, 5xx < 0,5 %; cero saldos inconsistentes y cero créditos duplicados.

## 9. Orden de trabajo restante

1. Confirmar el modelo de procesos y los límites de conexión (§5); job de alertas con `GET_LOCK` y alertas únicas; `queueLimit`/timeouts del pool; `no-store` en la API.
2. Índices de §6 validados con EXPLAIN; quitar `SELECT *`.
3. Observabilidad mínima (log de peticiones con id, `/health` que consulte la base, rastreo de errores) y retención de `audit_logs` y `login_activity`.
4. Pruebas de carga en entorno de pruebas (§8).
5. Según resultados: caché de parámetros y reportes, exportaciones en stream, sondeo en lugar de SSE, y salto a VPS/Cloud si se confirma escala de "miles".

## 10. Historial

| Fecha | Cambio |
|---|---|
| 2026-10-12 | Diagnóstico inicial. Corregidos #1–#6 (§3). Migración 020. `AUTH_RATE_LIMIT`. Refresh con token inválido: 500 → 401. |

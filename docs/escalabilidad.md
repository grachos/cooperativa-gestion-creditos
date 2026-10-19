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
| 7 | P0 | R | Varios procesos Node con estado en memoria (SSE, rate limit, job diario ×N) | 🔶 job diario y SSE ya funcionan con N procesos (§3.5, §3.7); rate limit sigue por proceso; falta confirmar cuántos procesos hay (§5) |
| 8 | P0 | R | Pool de 10 conexiones sin `queueLimit` ni timeouts | 🔶 cola limitada + 503, timeout de conexión y de petición (§3.8); falta fijar `DB_POOL_SIZE` con `max_user_connections` (§5) |
| 9 | P0 | R | SSE ocupa una conexión por pestaña, sin heartbeat | ✅ latido, topes por usuario y globales, limpieza de conexiones muertas (§3.7) |
| 10 | P1 | C | Job de alertas: N+1 y sin exclusión mutua (duplicados) | ✅ §3.5 y §3.6 |
| 11 | P1 | C | `audit_logs` sin índices; listados ordenados sin índice; búsqueda `LIKE '%x%'` | ✅ índices medidos con EXPLAIN (§3.10); la búsqueda `%x%` sigue igual (compromiso en §3.10) |
| 12 | P1 | C | Reportes y exportaciones sin límite (cargan todo el histórico) | 🔶 `pagos.csv` por tramos con filtros (§3.12) y reportes pesados con caché + coalescencia (§3.11); `/reports/overdue` paginado (`?page=&pageSize=`, la interfaz muestra 25 por página y el CSV sigue trayendo todo); falta `export/accounting` |
| 13 | P1 | C | Correo de restablecimiento dentro de la petición, sin timeout SMTP | ⏳ |
| 14 | P1 | C | Sin logs de peticiones, métricas ni alertas; `/health` no toca la base | 🔶 log estructurado con id de petición, consultas lentas, `/admin/metrics`, errores no capturados (§3.13); falta un monitor externo con alertas (acción de operación, §10) |
| 15 | P1 | R | Respuestas de la API sin `Cache-Control` (riesgo con CDN/LiteSpeed cache) | ✅ `Cache-Control: no-store` en toda `/api` (§3.8) |
| 16 | P2 | C | `COUNT(*)` en cada listado; `parameters` se lee en casi cada operación | ⏳ (el conteo de auditoría cuesta 112 ms con 1 M de filas y crece linealmente) |
| 17 | P0 | C | Reversar un pago no devolvía el saldo de capital del crédito ni el saldo/estado de la cuota (64 de 75 créditos con reverso descuadrados en la base de pruebas) | ✅ [§3.14](#314-auditoría-de-transacciones-h1h5-2026-10-19) + reparación de datos (migración 027) |
| 18 | P0 | R | El job de alertas escribía estados con datos leídos antes: podía devolver a VENCIDA una cuota recién pagada (actualización perdida) | ✅ §3.14 |
| 19 | P1 | C | Pagos aceptados a créditos refinanciados y excedentes sobre lo adeudado, guardados sin aplicarse | ✅ §3.14 |
| 20 | P1 | C | Reverso de pagos de créditos ya refinanciados | ✅ §3.14 |
| 21 | P1 | C | Deadlock entre el job de alertas y pagos/reversos (500); sin reintento | ✅ §3.14 (READ COMMITTED en el job + reintento automático) |
| 22 | P2 | C | Decisiones sobre solicitudes (aprobar/rechazar/cancelar) y radicación sin transacción ni bloqueo | ✅ §3.15 (H6/H7) |
| 23 | P2 | R | Clave de idempotencia guardada después del commit (commit ambiguo) | ✅ §3.16 (H8) |
| 24 | P2 | R | Sin reglas en la base: pagado > debido o saldos negativos solo los impedía el código | ✅ §3.17 (migración 028) |

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

### 3.5 Job de alertas por lotes

**Problema (confirmado):** `recalculateAlerts` hacía hasta 3 consultas **por cuota
abierta** (UPDATE, SELECT de alertas existentes, INSERT) y usaba `NOT IN`, que no
aprovecha el índice de `status`.

**Solución:** carga las cuotas abiertas con `status IN (...)`, calcula en memoria y
escribe por lotes: un `UPDATE … WHERE id IN (…)` por cada combinación distinta de
(días de atraso, estado), una sola lectura de las alertas abiertas y `INSERT` en lotes
de 500. La lógica de negocio no cambió.

**Verificación de equivalencia** (mismos datos, código anterior contra código nuevo):

| Conjunto de datos | Anterior | Nuevo | ¿Mismo resultado? |
|---|---|---|---|
| 19 créditos / 228 cuotas, 19 desfases de vencimiento distintos | 79 ms | 42 ms | Sí: idénticas las 228 cuotas, las 41 alertas y los 19 créditos |
| 1.919 créditos / 23.028 cuotas | **8.321 ms, 17.478 consultas** | **459 ms, 60 consultas** | Sí: mismo hash de cuotas (días y estado), alertas (tipo, prioridad, mensaje) y créditos |

Proyección lineal: con 180.000 cuotas el job anterior tardaría ~65 s con ~136.000
consultas; el nuevo, unos pocos segundos.

### 3.6 Una sola ejecución a la vez, y una vez por día

- `utils/jobLock.ts`: `withJobLock` usa `GET_LOCK` de MySQL (candado por nombre, ligado a
  la conexión, se libera solo si el proceso muere). El job y el botón "Recalcular" no
  esperan: si ya hay una ejecución en curso, el job se omite y el botón responde **409**.
- **Job diario:** cada proceso revisa cada 10 min, pero la reserva
  `job_runs (job_name, run_date)` (`INSERT IGNORE`) hace que lo ejecute **un solo proceso
  por día**. Si el job falla, se devuelve la reserva y el siguiente intento lo reintenta.
- **Alertas únicas:** columna `alerts.open_flag` (1 mientras está ABIERTA, NULL al
  atenderla) con llave única `(installment_id, type, open_flag)`. Dos ejecuciones
  simultáneas ya no pueden crear dos alertas abiertas iguales; el historial de alertas
  atendidas se conserva. Migración `021_multiprocess_guards.sql` (descarta duplicados
  abiertos existentes conservando el más antiguo).

### 3.7 Alertas en vivo (SSE) con varios procesos

Cada proceso solo conoce sus propias conexiones SSE. Ahora `SseHub`
(`modules/alerts/sse.hub.core.ts`) entrega el evento de inmediato a sus clientes y lo
publica en la tabla `realtime_events`; cada proceso la consulta cada 2 s y reenvía a sus
clientes lo publicado por los demás (ignora lo propio). **Solo consulta mientras tiene
clientes conectados**; los eventos se purgan a los 10 minutos.

- **Latido** cada 25 s (`: ping`): detecta y limpia conexiones muertas y evita que el
  proxy las corte por inactividad.
- **Tope por usuario** (5): al abrir otra pestaña se cierra la conexión más antigua.
  **Tope global** (500 por proceso): más allá responde 503 y el navegador reintenta solo.
- Garantías: cada evento llega una vez a cada cliente. **No hay orden total entre
  procesos distintos** (el evento local se entrega al instante); sí se conserva el orden
  entre eventos de un mismo proceso. Para notificaciones de alertas es suficiente.
- El frontend solo escucha `alert.created`; los demás eventos que emite el servidor
  (`payment.registered`, etc.) no tienen consumidor hoy.
- Si algún día se pasa a VPS con Redis, este buzón se reemplaza por pub/sub sin cambiar el
  resto del código (interfaz `RealtimeStore`).

### 3.8 Pool, tiempos máximos, salud y caché

| Cambio | Detalle |
|---|---|
| Pool de conexiones | `DB_POOL_SIZE` (10) y `DB_QUEUE_LIMIT` (200). Con la cola llena se responde **503 + Retry-After** en vez de acumular peticiones colgadas. `DB_CONNECT_TIMEOUT_MS` (10 s), keep-alive activado. |
| Peticiones lentas | `REQUEST_TIMEOUT_MS` (60 s) y `headersTimeout` 30 s cortan clientes que nunca terminan de enviar. No afecta a SSE. |
| `/health` | Ejecuta `SELECT 1` (máx. 2 s); **503 si la base falla** (antes devolvía "ok" fijo). Incluye `instance` (id del proceso) y `uptimeSec`. |
| Caché | `Cache-Control: no-store` en toda `/api/*`: la API devuelve datos por usuario y personales y nunca debe quedar en una caché compartida (CDN, LiteSpeed Cache). |
| Apagado ordenado | Con SIGTERM/SIGINT cierra las conexiones SSE y devuelve las conexiones MySQL (cada despliegue reinicia el proceso). |
| Limpieza horaria | Borra claves de idempotencia y eventos en vivo vencidos. |

**Límite honesto:** `mysql2` no tiene un tiempo máximo para *obtener* una conexión del
pool ni para una consulta; `DB_QUEUE_LIMIT` y `REQUEST_TIMEOUT_MS` son la contención
disponible. Un timeout por consulta requeriría `max_execution_time`, que difiere entre
MySQL y MariaDB; queda como pendiente si las pruebas de carga lo justifican.

### 3.10 Índices (medidos con EXPLAIN sobre ~1,5 millones de filas)

**Método:** base de pruebas con 10.000 asociados, 15.000 créditos (180.000 cuotas), 300.000 pagos,
1.000.000 de filas de auditoría, 200.000 registros de login y 50.000 alertas (439 MB). Se midió
cada consulta real de la app (plan de `EXPLAIN` + mediana de tiempos) con
`backend/scripts/explain-bench.mjs`, se aplicó la migración `022_query_indexes.sql` (9 s sobre
esos datos) y se volvió a medir. Motor local: MariaDB 10.11; **el de Hostinger puede elegir
planes distintos: repetir el script allí (§4) antes de dar los números por buenos.**

| Consulta | Antes | Después |
|---|---|---|
| Auditoría: listado / por entidad | 527 / 540 ms (escaneo de ~980.000 filas + filesort) | **0,6 / 0,6 ms** |
| Auditoría: conteo total | 490 ms | 112 ms |
| Alertas atendidas (listado) | 59 ms | 0,7 ms |
| Alertas abiertas (listado) | 7,7 ms | 0,6 ms |
| Login: conteo de fallos | 7,0 ms | 0,4 ms |
| Créditos: listado por estado | 11,2 ms | 1,1 ms |
| Dashboard: pagos de 30 días / créditos vencidos | 61 / 42 ms | 17 / 14 ms |
| Solicitudes, asociados: listados | 1–4 ms (con filesort) | ≈1 ms (sin filesort) |
| **Búsqueda de asociados por cédula** | 6 ms | **19 ms (peor)** |

- **Compromiso conocido:** el índice por fecha acelera el listado de asociados (el más usado), pero
  la búsqueda `LIKE '%texto%'` no puede usar ningún índice B-tree y ahora el optimizador la recorre
  en orden de fecha (más lento que antes: 6 → 19 ms con 10.000 asociados). Es aceptable a esta
  escala; la solución limpia, si crece, es buscar por prefijo (`'texto%'`) cuando el texto sea
  numérico, con un índice sobre `id_number` (cambia el comportamiento de la búsqueda: no se hizo sin
  consultarlo).
- **Qué los índices NO arreglan:** los reportes pesados siguen casi igual (detalle mensual 4,7 → 3,5 s,
  resumen mensual 1,0 s, cartera vencida 223 → 189 ms). Son cálculos sobre todo el historial; la
  palanca es la caché (§3.11), no un índice.
- **Costo de escritura** (inserción masiva de 300.000 filas): auditoría 2,2 → 4,0 s (2 índices
  nuevos), pagos 2,0 → 2,5 s. Por fila son microsegundos; la app inserta pocas filas por petición.
- Se eliminaron 5 índices que quedaron redundantes (prefijo de uno nuevo): `idx_alerts_status`,
  `idx_credits_status`, `idx_applications_status`, `idx_payments_credit`, `idx_installments_status`.
- La migración es **repetible** (CREATE/DROP condicionales) y crea los nuevos antes de borrar los
  redundantes, para que ninguna llave foránea quede sin índice.

### 3.11 Caché de reportes con coalescencia

**Problema (medido):** con 20 usuarios abriendo el mismo reporte a la vez, cada uno disparaba su propio
cálculo. El detalle mensual tardó **21,9 s en total y un listado de créditos ajeno esperó 19 s**
(el pool de 10 conexiones se agotó); el resumen mensual, 5,2 s y 4,4 s de espera.

**Solución:** `utils/responseCache.ts`, middleware `reportCache.middleware()` en
`/reports/dashboard`, `/overdue`, `/mora-buckets`, `/monthly-summary` y `/credits-monthly-detail`:
resultado fresco → se devuelve sin tocar la base; cálculo en curso → las demás peticiones esperan
**ese** resultado (una sola consulta pesada en vez de N); un error nunca se cachea.

| Escenario (20 usuarios simultáneos) | Sin coalescencia | Con coalescencia |
|---|---|---|
| Detalle mensual por crédito | 21,9 s en total; listado ajeno esperó 19.107 ms | 5,5 s en total (1 cálculo); listado ajeno 11 ms |
| Resumen mensual | 5,2 s; listado ajeno 4.383 ms | 1,06 s (1 cálculo); listado ajeno 24 ms |
| Repetir el reporte (dentro del TTL) | — | 3 ms (resumen), 52 ms (detalle, por serializar 14.850 filas) |

- **TTL:** `REPORT_CACHE_TTL_SECONDS` (60; 0 = sin guardar, pero la coalescencia sigue). Las escrituras
  que cambian estos datos (pago, reverso, desembolso, refinanciación, ajuste, recálculo de alertas)
  invalidan la caché del proceso (`invalidateReportCache()`); verificado con una prueba: tras registrar
  un pago el dashboard refleja el monto de inmediato.
- **Seguridad:** solo se cachean respuestas **idénticas para todo usuario con `reports:read`**
  (agregados de cartera). La clave es la URL, no el usuario: **nunca** aplicar este middleware a
  datos por usuario o personales. La API además lleva `Cache-Control: no-store`.
- **Límite:** la caché es por proceso; si hubiera varios, otro proceso puede mostrar datos de hasta el TTL.

### 3.12 Exportación de pagos por tramos y escapado de CSV

`GET /reports/payments.csv` cargaba **todos** los pagos en memoria (1,5 s y ~300.000 objetos con 300.000
pagos). Ahora lee por tramos de 5.000 filas con paginación por llave (sin `OFFSET`), escribe a medida
que llega (con contrapresión) y devuelve la conexión del pool entre tramos. Filtros opcionales
`?from=AAAA-MM-DD&to=AAAA-MM-DD` (400 si el formato es inválido). Verificado con 300.000 pagos: 300.000
filas, ids únicos, orden por fecha descendente, 3,2 s extremo a extremo; con filtro de seis meses, 49.016
filas en 0,3 s. Nuevo índice `idx_payments_received (received_date)` para el orden.

Además cierra el hallazgo de seguridad **SEC-010**: los campos de texto se escapan (`utils/csv.ts`): las
comas y comillas se citan y un valor que empiece por `= + - @` se neutraliza para que Excel no lo ejecute
como fórmula (los montos numéricos no se tocan).

### 3.13 Observabilidad

| Pieza | Detalle |
|---|---|
| `X-Request-Id` | Cada petición recibe un id (o conserva el del cliente si es válido). Aparece en el log y en la respuesta; los errores 500 lo devuelven también en el cuerpo (`requestId`): con el id que cite el usuario se encuentra el error exacto en los logs. |
| Log de peticiones | Una línea JSON por petición: `{"t":"req","id","m","p","s","ms","u","i"}` (método, ruta, estado, duración, usuario, proceso). `REQUEST_LOG=slow` (por defecto) solo registra las 5xx y las lentas (`SLOW_REQUEST_MS`, 1000); `all` registra todas (para depurar); `off` ninguna. **Nunca** se registran query string (el SSE lleva el token ahí), cabeceras ni cuerpos. `/health` y los archivos estáticos no se registran. |
| Consultas lentas | `{"t":"slowq","ms","sql"}` para consultas de más de `SLOW_QUERY_MS` (500): SQL normalizado **sin parámetros** (pueden ser datos personales). |
| Errores | `{"t":"error",...}` con id, ruta, mensaje y 6 líneas de pila; `unhandledRejection` se registra; `uncaughtException` se registra y el proceso sale para que el hosting lo arranque limpio. |
| `GET /api/v1/admin/metrics` | Solo con permiso `audit:read` (ADMIN y CONTADORA). Memoria, retraso del event loop (p50/p99/máx), peticiones por clase de estado con latencias p50/p95/p99, estado del pool (total/libres/en cola), consultas lentas recientes, conexiones SSE y estadísticas de la caché de reportes. **Es de este proceso y se reinicia cuando el hosting lo recicla.** |

Ejemplo real (base de pruebas grande, un reporte pesado): la consulta aparece en el log como
`{"t":"slowq","ms":3282,"sql":"WITH bounds AS ( SELECT CAST(? AS DATE) ..."}` y, a continuación,
`{"t":"req","id":"b1cf1b6a4358","m":"GET","p":"/api/v1/reports/credits-monthly-detail","s":200,"ms":3338,"u":64,"i":"8e5e5484","slow":true}`.

### 3.14 Auditoría de transacciones (H1–H5, 2026-10-19)

Auditoría de atomicidad, aislamiento y concurrencia de las operaciones de dinero. Pagos, desembolso,
refinanciación y cancelación anticipada ya eran atómicos y bloqueaban el crédito primero (§3.1); los problemas
estaban en lo que pasa **alrededor**. Medido en la base de pruebas antes del cambio: 64 de 75 créditos vigentes
con algún pago reversado tenían `principal_balance` distinto de lo que suman sus cuotas, y 164 cuotas estaban en
PARCIAL sin ningún abono.

| Hallazgo | Problema | Cambio |
|---|---|---|
| H1 | El reverso devolvía lo pagado a las cuotas pero no recalculaba `credits.principal_balance` ni `credit_schedule_installments.balance`, y dejaba la cuota en PARCIAL aunque quedara sin abonos. El tablero y el reporte por asesor usan `principal_balance`. | El reverso recalcula, en la misma transacción, saldo y estado de cada cuota tocada (`refreshInstallments`) y saldo y estado del crédito (`refreshCreditAfterReversal`). Migración **027** repara los datos ya afectados (repetible). |
| H2 | El job leía miles de cuotas y luego escribía su estado con `UPDATE … WHERE id IN (…)` sin condición: si un pago se confirmaba en ese intervalo, la cuota pagada volvía a VENCIDA. | Escritura condicional: `… AND status = <el que leyó el job>` (`persistInstallmentStates`). Si cambió, se omite y la próxima corrida la evalúa. |
| H3 | Solo se rechazaban créditos PAGADO/ANULADO: un pago a un crédito REFINANCIADO (cuotas anuladas) se guardaba sin aplicarse. | Pagos y cancelación anticipada exigen crédito VIGENTE o EN_MORA. |
| H4 | El excedente de un pago se descartaba en silencio (monto guardado > lo aplicado). | Dentro de la transacción se exige que lo aplicado sea igual al monto; si no, 409 con el máximo que se puede registrar y rollback. Se eligió **rechazar** (no saldo a favor): es reversible y no requiere un concepto contable nuevo. |
| H5 | Se podía reversar un pago de un crédito ya refinanciado: el crédito nuevo quedaba con menos capital del debido. | El reverso exige crédito VIGENTE, EN_MORA o PAGADO. |

**Regresión encontrada al probar y corregida:** con H1 el reverso ahora sí cambia el estado de las cuotas, y en
3 de 8 corridas completas de pruebas apareció un deadlock entre un reverso y el job de alertas. `SHOW ENGINE INNODB
STATUS` mostró la causa: en REPEATABLE READ, `UPDATE credits … WHERE EXISTS (SELECT … cuotas)` del job deja
bloqueos compartidos *de rango* sobre el índice `(status, credit_id)` de las cuotas y luego espera el crédito,
mientras el reverso tiene el crédito y quiere escribir esas cuotas. El mismo riesgo existía con los pagos. Cambios:

- Las escrituras del job corren en **READ COMMITTED** (`withReadCommitted` en `db/pool.ts`): sin bloqueos de rango.
  Es seguro porque cada sentencia del job es condicional y se reevalúa en la siguiente corrida.
- `withTransaction` **reintenta** la transacción completa (hasta 2 veces) si MySQL la elige como víctima de un
  deadlock (1213), en vez de responder 500. Por eso dentro de una transacción solo va trabajo de base de datos.

Resultado: 12 corridas de estrés (concurrencia + job + estas pruebas) y 5 de la suite completa (136 pruebas) sin un
solo deadlock nuevo (`SHOW ENGINE INNODB STATUS` conserva el último de antes del arreglo).

**Cómo verificar en producción** (solo lectura; debe dar 0 después de la migración 027):

```sql
SELECT COUNT(*) FROM credits c
WHERE c.status IN ('VIGENTE','EN_MORA','PAGADO')
  AND ABS(c.principal_balance - (SELECT COALESCE(SUM(principal_due - principal_paid), 0)
       FROM credit_schedule_installments WHERE credit_id = c.id AND status <> 'ANULADA')) > 0.01;
```

**Pruebas:** `transacciones.audit.test.ts` (6 casos: H1 ×3, H2, H3+H5, H4) fallan con el código anterior y pasan con
el nuevo; `db/withTransaction.test.ts` provoca un deadlock real con dos transacciones cruzadas y comprueba el
reintento (falla con los reintentos en 0).

**Pendiente de la auditoría:** ~~H6~~ y ~~H7~~ (hechos, §3.15), ~~H8~~ (hecho, §3.16), ~~reglas `CHECK` en la base~~
(hecho, §3.17) y H9 (la refinanciación suma interés futuro al nuevo capital: regla de negocio a
confirmar con la cooperativa).

### 3.15 Solicitudes: decisiones y radicación atómicas (H6, H7, 2026-10-19)

**Problema (confirmado por lectura de código y reproducido en pruebas):**
- **H6:** aprobar, rechazar, cancelar, poner en revisión y revisar documentos/participantes/referencias leían el
  estado de la solicitud sin bloqueo y escribían con varias sentencias sueltas (`UPDATE` incondicional del estado +
  historial + auditoría). Con el código anterior, "aprobar y rechazar a la vez" terminó **las 3 veces** con las dos
  respuestas en 200 y dos decisiones en el historial. Cancelar mientras otra persona desembolsa podía dejar una
  solicitud CANCELADA con un crédito activo; rechazar un documento mientras se aprueba, una solicitud APROBADA con un
  documento rechazado (estas dos ventanas son muy cortas y no se reprodujeron en las pruebas locales con el código
  viejo; las pruebas quedan como protección).
- **H7:** radicar insertaba la solicitud, los participantes, el historial y la auditoría sin transacción: un codeudor
  inexistente daba error de llave foránea (500) y podía dejar una solicitud RADICADA sin codeudores.

**Cambio:**
- Toda operación sobre una solicitud corre en `withTransaction` y **bloquea la solicitud como primera sentencia**
  (`lockApplication`, la misma fila que bloquea el desembolso). Así se aplican de a una y cada una ve el estado que
  dejó la anterior; la segunda decisión recibe 409.
- `transition()` va dentro de la transacción y su `UPDATE` es condicional al estado de origen (red de seguridad: si
  cambió, 409 en vez de pisarlo).
- La radicación es una sola transacción (idempotencia `transactional`), valida que existan el titular, los
  codeudores, la sociedad y el asesor (400 con mensaje claro en vez de 500) y rechaza al titular como su propio
  codeudor. Si algo falla, no queda nada guardado.
- Cancelar ahora deja registro en la auditoría ("Canceló la solicitud", con el motivo).

**Pruebas:** `solicitudes.concurrencia.test.ts` (6): aprobar vs. rechazar ×4, cancelar vs. desembolsar ×4, rechazar
documento vs. aprobar ×4, decisiones sobre solicitudes cerradas, radicación inválida sin residuos, auditoría de la
cancelación. Con el código anterior fallan 3 (aprobar vs. rechazar, radicación, auditoría); con el nuevo pasan las 6.
Suite completa: 142 pruebas, 5 corridas seguidas sin fallos.

### 3.9 Incidente: migración 021 interrumpida dejó el sitio caído (2026-10-12)

**Qué pasó:** al desplegar la migración 021, el proceso se reinició a mitad de arranque
(Hostinger reinicia el servidor al publicar y puede arrancar dos procesos casi juntos).
El `ALTER TABLE alerts ADD COLUMN open_flag` ya se había aplicado, pero la migración no
quedó registrada en `schema_migrations`. Cada arranque posterior reintentaba el mismo
`ALTER` y fallaba con `Duplicate column name 'open_flag'`; como el backend no arranca si
una migración falla, **el sitio quedó caído** hasta publicar el arreglo.

**Causa raíz:** (1) la migración no era repetible, (2) nada impedía que dos procesos
migraran a la vez, (3) no se probó el caso "migración interrumpida", y las pruebas de
despliegue solo cubrieron base vacía y base con datos, no un reinicio a mitad.

**Arreglo:**
- La 021 usa `ALTER` condicionales (consulta `information_schema` y `PREPARE`), por lo
  que se puede ejecutar de nuevo sobre una base a medias o completa.
- `runMigrations` toma un candado `GET_LOCK('coop:migrations')`: con dos procesos
  simultáneos uno migra y el otro espera y luego ve todo aplicado.
- Regla nueva en `CLAUDE.md`: las migraciones deben ser repetibles.

**Verificado localmente:** (A) base con 020 aplicada y 021 a medias → se completa;
(B) 021 ejecutada dos veces seguidas → sin error; (C) dos procesos migrando a la vez
sobre una base vacía → uno aplicó las 21, el otro 0, sin errores.

**Pendiente de mejora:** el arranque del backend sigue dependiendo de que las migraciones
terminen. Si se quiere que una migración fallida no tumbe el sitio, habría que arrancar
igualmente y marcar `/health` como degradado; se decidió no hacerlo todavía porque
arrancar con un esquema desactualizado puede dar errores peores.

### 3.16 Clave de idempotencia confirmada en la transacción del negocio (H8, 2026-10-19)

**Problema (confirmado con prueba):** la clave `Idempotency-Key` se marcaba `COMPLETED` en el `res.send`,
**después** del COMMIT del pago. Si algo fallaba entre el COMMIT y la respuesta (en la prueba: un error al
avisar a las pantallas; en producción también una caída del proceso o de la conexión), la ruta respondía 500,
y como la operación es "transaccional" el middleware **liberaba** la clave. El reintento del usuario o del
navegador (misma clave) volvía a ejecutar todo: **pago duplicado**. Con el código anterior la prueba nueva
registra dos veces.

**Arreglo:** `completeIdempotencyInTransaction(conn, res, 201, cuerpo)` (`middlewares/idempotent.ts`) hace el
`UPDATE idempotency_keys SET state='COMPLETED', respuesta…` como **última sentencia de la transacción** del
negocio. La clave y el efecto se confirman o se revierten juntos:
- Error después del COMMIT → la clave ya está `COMPLETED`; `release` solo borra reservas `IN_PROGRESS`, así que
  se conserva y el reintento recibe la respuesta original (`Idempotent-Replayed: true`) sin repetir el pago.
- Rollback (409, 400, deadlock agotado) → el `UPDATE` también se revierte, la clave sigue `IN_PROGRESS` y se
  libera: el reintento sí ejecuta.
- Si la ruta ya confirmó la clave, el `res.send` no hace una segunda escritura.
- Rutas: `POST /payments`, `/payments/early-payoff`, `/credits/applications/:id/disburse`,
  `/credits/:id/refinance`, `POST /applications`, `/applications/:id/references`. El `UPDATE` toca solo la fila
  de la clave (por PK), después de los bloqueos crédito → pago, así que no cambia el orden de bloqueo.

**Verificación:** `idempotencia.transaccion.test.ts` (3): error forzado después del COMMIT en un pago y en una
radicación → el reintento devuelve 201 repetido y hay un solo registro; un pago que se revierte (excedente, H4)
no deja clave ni pago. Las dos primeras fallan con el código anterior. Suite backend: 145 pruebas, dos corridas.

**Pendiente:** una caída del proceso **antes** del COMMIT deja la clave `IN_PROGRESS` hasta que vence (el
reintento recibe `409 IDEMPOTENCY_IN_PROGRESS`): es seguro (no duplica) pero el usuario debe esperar o revisar.
Las operaciones no transaccionales (tabla del README) conservan el comportamiento anterior.

### 3.17 Reglas CHECK de montos en la base (2026-10-19)

**Problema:** que una cuota no tenga más pagado que lo debido, que los saldos no sean negativos o que no haya
pagos en cero lo garantizaba solo el código. Los errores H1–H5 (§3.14) dejaron saldos inconsistentes que nada
detectó hasta la auditoría.

**Arreglo:** migración `028_reglas_check_montos.sql`, 10 reglas:

| Tabla | Regla |
|---|---|
| `credit_schedule_installments` | pagados ≥ 0; debidos ≥ 0; `balance` ≥ 0; `principal_paid` ≤ `principal_due`; `interest_paid` ≤ `interest_due`; `other_paid` ≤ `other_due` |
| `credits` | `principal_balance` ≥ 0 |
| `payments` | `amount` > 0 |
| `payment_allocations` | `amount` > 0 |
| `credit_adjustments` | 0 ≤ `paid_amount` ≤ `amount` |

Para no repetir el incidente de §3.9 (arranque caído por una migración), cada regla se agrega **solo si**: el
servidor las hace cumplir (MySQL ≥ 8.0.16 o MariaDB ≥ 10.2.1; en versiones anteriores MySQL las ignora), no
existe ya (repetible), y **ninguna fila actual la incumple**. Si se omite alguna, el arranque lo registra:
`[db] <versión>; reglas CHECK activas 9/10. Faltan …: chk_…` (`db/migrate.ts`). Ese mismo log muestra por
primera vez la versión de la base de Hostinger, que no se conocía.

Si una escritura las incumple, la base la rechaza (MariaDB 4025, MySQL 3819), la transacción completa se revierte
y la API responde 500 con `code: "INTEGRITY_CHECK_FAILED"` y un mensaje claro. Sigue siendo 500 a propósito: es un
error del programa y queda en el log con su traza.

**Verificación (MariaDB 10.11 local):** (A) aplicada sobre la base de pruebas (32.910 cuotas, 0 incumplimientos):
10/10; (B) ejecutada dos veces: sin error; (C) interrumpida con 4 de 10 creadas: completa las 6 faltantes;
(D) `UPDATE` con pagado > debido o saldo negativo: rechazado; (E) base con un pago en 0: se omite solo esa regla,
se aplican las otras 9 y el arranque avisa. `reglas.check.test.ts` (2). La suite completa (147 pruebas, dos corridas)
pasa con las reglas activas: ningún flujo de la app las incumple.

**No probado:** MySQL 8 (no hay uno local); la condición de versión y la sintaxis son las documentadas para
MySQL 8.0.16+. **Producción (2026-10-19 19:22 UTC):** Hostinger usa **MariaDB 11.8.9**; la 028 se aplicó sin
errores y el log muestra `reglas CHECK activas 10/10` (los datos reales cumplían todas).

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
env $DB JOBS_TEST_DB=1 npm test           # candados, job diario, alertas únicas, buzón de eventos
# Todo junto (el archivo de autenticación hace muchos logins: subir el límite en la base de pruebas):
env $DB AUTH_RATE_LIMIT=100000 CONCURRENCY_TEST_DB=1 AUTH_TEST_DB=1 IDEMPOTENCY_TEST_DB=1 JOBS_TEST_DB=1 npm test
```
Atajo: `TEST_DB=1` activa **todas** las pruebas con base de datos (más `AUTH_RATE_LIMIT=100000`, porque
la de autenticación hace muchos logins). 96 pruebas, repetidas 3 veces seguidas sobre bases nuevas.

Plan de ejecución y tiempos de las consultas reales (SOLO LECTURA; usar una base de pruebas con datos
sembrados, nunca producción):

```bash
env $DB node scripts/explain-bench.mjs resultado.json    # tabla: tiempo, filas, filesort, índice usado
env $DB ONLY="auditoría" RUNS=5 node scripts/explain-bench.mjs
```
Las consultas están copiadas de los archivos de rutas (y los reportes grandes se extraen del propio
código): si cambia una consulta, actualizar el script.

Las pruebas de `sse.hub.test.ts` (latido, topes, dos procesos simulados) y de
`app.health.test.ts` (salud, `no-store`, cola del pool) no necesitan base de datos.

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
2. **Cuántos procesos Node hay (clave para #7). Evidencia ya obtenida (2026-10-12):** los registros de Hostinger muestran que el servidor se **arranca bajo demanda y se detiene al quedar ocioso**: tras un despliegue aparecen varios arranques en segundos y un `SIGTERM` (el apagado ordenado ahora lo registra: `[server] SIGTERM: apagando`) unos segundos después, y minutos más tarde un arranque nuevo cuando llegó una petición. Es decir, los "dos arranques por despliegue" son ciclo de vida del hosting, no necesariamente dos procesos simultáneos; y **la app no está siempre viva**. Falta confirmar si alguna vez coexisten dos procesos: abra `https://coomulnissi.cc/health` unas 10 veces: si el campo `instance` cambia entre respuestas, hay varios procesos; si siempre es el mismo, hay uno. Los logs de arranque también muestran `pid` e `instancia`. Si hay uno solo, la parte de varios procesos de §3.5–3.7 queda como protección preventiva sin costo.
2b. **Límites del plan de Hostinger:** hPanel → Avanzado → Uso de recursos (CPU, RAM, procesos). Preguntar a soporte cuántas instancias de Node arranca lsnode y si las conexiones largas (SSE) tienen tiempo límite. Pista: los logs muestran **dos** arranques por despliegue, con `pid` e `instancia` distintos.
3. **Límites de MySQL (para fijar `DB_POOL_SIZE`: procesos × tamaño del pool ≤ `max_user_connections`):** `SHOW VARIABLES WHERE Variable_name IN ('max_user_connections','max_connections','wait_timeout','innodb_buffer_pool_size'); SELECT VERSION();`
4. **Volumen por tabla:** `SELECT table_name, table_rows, ROUND((data_length+index_length)/1048576,1) AS mb FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY mb DESC;`
5. **Índices reales:** `SHOW INDEX FROM payments;` (y las demás tablas de la sección 6).
6. **Planes de ejecución:** `EXPLAIN` de cada consulta de la sección 6 sobre datos sembrados en un entorno de pruebas.

## 6. Índices: estado

Implementados en la migración `022_query_indexes.sql` (resultados en §3.10). Pendiente / a vigilar:

- **Conteo de auditoría** (`SELECT COUNT(*) FROM audit_logs`): 112 ms con 1 M de filas, crece linealmente.
  Opciones cuando moleste: limitar el conteo (mostrar "más de 10.000"), o llevar un contador aparte.
  La interfaz actual no tiene pantalla de auditoría; solo la API.
- **Búsqueda de asociados** `LIKE '%x%'`: ver el compromiso de §3.10.
- **Retención:** `audit_logs`, `login_activity`, `realtime_events` e `idempotency_keys` crecen sin límite
  (las dos últimas se purgan solas). Definir cuánto tiempo se conservan auditoría y accesos.
- Evitar `SELECT *` en listados (arrastra las columnas JSON de auditoría y los snapshots del crédito):
  no se tocó porque cambia la forma de la respuesta que usa la interfaz.

## 7. Caché y tareas asíncronas (pendiente)

- **Hecho (§3.11):** caché con coalescencia de los reportes pesados. **Pendiente:** `parameters` (60 s; invalidar al editar), alcance global, solo configuración.
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

0. **Job diario de alertas: no depender del proceso (acción de operación, pendiente).** Como Hostinger detiene la app cuando está ociosa, el temporizador interno (`INTERNAL_CRON`, que revisa cada 10 min si son las 11:00 UTC) **solo corre si el proceso está vivo a esa hora**. Si nadie usa el sistema entre las 06:00 y las 07:00 (hora de Colombia), el job de ese día no se ejecuta. Solución: crear en hPanel → Avanzado → Cron Jobs una tarea diaria a las 11:00 UTC (06:00 Colombia) que llame al endpoint ya existente, que también despierta a la app:
   `curl -fsS -H "Authorization: Bearer <CRON_SECRET>" https://coomulnissi.cc/api/v1/alerts/cron`
   En hPanel: Sitios web → coomulnissi.cc → Avanzado → Tareas Cron → "Personalizado" → comando `wget -q -O /dev/null --header="Authorization: Bearer <CRON_SECRET>" https://coomulnissi.cc/api/v1/alerts/cron` → minuto `0`, hora `11`, resto en "cada" (`* * *`). Hostinger usa la hora de su servidor (puede no ser UTC): como la tarea es idempotente, una diferencia de horas no causa daño. Cada ejecución deja en los logs de Hostinger la línea `[cron] alertas recalculadas: {...}`; comprobarla al día siguiente.
   (`CRON_SECRET` es la variable de entorno ya configurada en Hostinger; no se guarda en el repositorio. **Si se rota el secreto, hay que actualizar también este comando.**) El endpoint usa el mismo candado, así que es seguro aunque coincida con el temporizador interno o con el botón "Recalcular". Hasta que se configure, las alertas se actualizan al pulsar "Recalcular" o si el sistema está en uso a esa hora.

1. Confirmar cuántos procesos hay y los límites de conexión (§5) y fijar `DB_POOL_SIZE`; rate limit compartido entre procesos (hoy el límite de autenticación es por proceso: con N procesos el límite real es N × `AUTH_RATE_LIMIT`).
2. Índices de §6 validados con EXPLAIN; quitar `SELECT *`.
3. Observabilidad mínima (log de peticiones con id, `/health` que consulte la base, rastreo de errores) y retención de `audit_logs` y `login_activity`.
4. Pruebas de carga en entorno de pruebas (§8).
5. Según resultados: caché de parámetros y reportes, exportaciones en stream, sondeo en lugar de SSE, y salto a VPS/Cloud si se confirma escala de "miles".

## 10. Operación: monitoreo y alertas (acciones pendientes del dueño del sistema)

Lo que ya está en el código (§3.13) permite diagnosticar; falta lo que avisa **sin que nadie mire**:

1. **Monitor externo de disponibilidad** (gratuito, p. ej. UptimeRobot o similar): vigilar
   `https://coomulnissi.cc/health` cada 5 min con alerta por correo si no responde 200 o si el
   cuerpo no contiene `"status":"ok"`. `/health` devuelve 503 cuando la base de datos falla y su
   campo `instance` ayuda a contar procesos.
2. **Revisar los logs de Hostinger** (hPanel → Node.js → Logs de ejecución) buscando `"t":"error"`,
   `"t":"slowq"` y `"slow":true`. Con el id de la petición que cite un usuario se llega al error exacto.
3. **Mirar `/api/v1/admin/metrics`** (con un usuario ADMIN) durante una jornada de uso y tras cada
   cambio de rendimiento: p95 de latencia, retraso del event loop (alerta si p99 > 200 ms), pool
   (`queued` > 0 sostenido = saturación) y consultas lentas.
4. **Ruta de aumento:** para historia de métricas y alertas automáticas (CPU, memoria, p95) hace falta
   un sistema externo (Grafana Cloud, Better Stack, etc.) o pasar a VPS; con hosting compartido no hay
   acceso a esas métricas del servidor.

## 11. Historial

| Fecha | Cambio |
|---|---|
| 2026-10-19 | Reglas CHECK de montos en la base (migración 028, condicionales por versión y por datos existentes) y aviso en el arranque con la versión de la base (§3.17). |
| 2026-10-19 | H8: la clave de idempotencia se confirma dentro de la transacción del pago/desembolso/refinanciación/radicación; un error después del COMMIT ya no permite duplicar al reintentar (§3.16). |
| 2026-10-19 | H6 y H7: decisiones sobre solicitudes con bloqueo y transacción, radicación atómica con validación de participantes (§3.15). |
| 2026-10-19 | Auditoría de transacciones: H1–H5 corregidos (reverso recalcula saldos, job con escritura condicional, sin pagos a créditos cerrados ni excedentes, sin reversos de refinanciados), migración 027 repara saldos, deadlock job↔reverso eliminado (READ COMMITTED en el job) y reintento automático ante deadlock (§3.14). |
| 2026-10-16 | Corrección del cambio anterior: el login no renovaba la marca `lastActivityAt`, así que con una marca vieja en el navegador `IdleTimeout` expulsaba al usuario justo después de entrar ("sesión expirada" en bucle). Ahora `login()` la pone en "ahora" y `logout()` la borra; prueba `AuthContext.test.tsx` (falla sin la corrección). |
| 2026-10-16 | Sesión: al abrir la app se reiniciaba el reloj de inactividad y una sesión de 5 días seguía abierta. Ahora `IdleTimeout` cierra al abrir si la última actividad supera 10 min, y el refresh token por defecto pasa de 7 d a 12 h. No es de rendimiento; se anota por ser un cambio de comportamiento de producción. |
| 2026-10-13 | Página Reportes: tabla de cuotas vencidas paginada (25 por página, `/reports/overdue?page=&pageSize=` con `total`; sin `page` conserva la respuesta completa) y exportación de pagos con rango Desde/Hasta (usa `?from=&to=`). Limitación: el servidor aún calcula la lista completa y la corta en memoria (cacheada 60 s); no se midió con volumen nuevo. |
| 2026-10-13 | Bloque 3: índices medidos con EXPLAIN sobre 1,5 M de filas (migración 022, auditoría 527 → 0,6 ms); caché de reportes con coalescencia (20 usuarios: 21,9 s → 5,5 s, sin bloquear al resto); `pagos.csv` por tramos con filtros y escapado de CSV (SEC-010); observabilidad (id de petición, log estructurado, consultas lentas, `/admin/metrics`, errores no capturados); herramienta `explain-bench.mjs`; `TEST_DB=1`. |
| 2026-10-12 | Incidente: la migración 021 quedó a medias y el sitio cayó; migraciones repetibles + candado entre procesos (§3.9). |
| 2026-10-12 | Bloque 2: job de alertas por lotes (18× más rápido, mismo resultado), exclusión mutua y ejecución diaria única (`job_runs`, `GET_LOCK`), alertas únicas (`open_flag`), SSE entre procesos con latido y topes, pool con cola limitada, `/health` real, `no-store` en la API, apagado ordenado. Migración 021. |
| 2026-10-12 | Diagnóstico inicial. Corregidos #1–#6 (§3). Migración 020. `AUTH_RATE_LIMIT`. Refresh con token inválido: 500 → 401. |

# Operación y escalabilidad

## Varios procesos es el caso normal

El hosting (Hostinger, Vercel, PM2 en cluster) puede correr 2+ procesos de Node, o reiniciarlos en
cualquier momento. Todo estado en memoria se multiplica o se pierde:

| En memoria | Problema | Solución |
|---|---|---|
| Job diario con `setInterval` | Corre una vez **por proceso** (alertas duplicadas) | Tabla `job_runs (job, fecha)` PK: el primero que inserta ejecuta; `GET_LOCK` para exclusión mientras corre |
| Conexiones SSE/WebSocket | Un evento solo llega a los clientes del proceso que lo generó | Buzón en la base (`realtime_events`), cada proceso lo consulta cada pocos segundos y reenvía; purgar eventos viejos |
| Rate limit / contadores de login | Cada proceso cuenta aparte | Contar en la base (o Redis) |
| Caché | Inconsistente entre procesos | Caché corta (60 s) solo para reportes pesados, invalidada al escribir |

Expón el id de proceso en `/health` para saber cuántos hay.

## Base de datos

- **Pool con cola limitada** (`queueLimit`) y timeouts de conexión y de petición: si se llena, responde
  503 "muy ocupado, intente en unos segundos" en vez de colgar. Ajusta el tamaño a `max_user_connections`
  del hosting.
- **Índices medidos con EXPLAIN** sobre volumen realista (se generó 1,5 M de filas): la consulta de
  auditoría pasó de 527 ms a 0,6 ms. No adivines índices; mide antes y después.
- **Listados paginados** en el servidor (`?page=&pageSize=` con `total`) y búsqueda por los campos que el
  usuario usa (cédula, nombre, número).
- **Jobs por lotes**, no N+1 (18× más rápido con el mismo resultado; compruébalo comparando salidas).

## Reportes y exportaciones

- Nada sin límite: exportaciones por tramos (streaming) y con filtros de fecha.
- **Caché con coalescencia**: si 20 usuarios piden el mismo reporte pesado a la vez, se calcula una sola
  vez y los demás esperan ese resultado (21,9 s → 5,5 s sin bloquear al resto).
- **CSV seguro**: escapar comillas (RFC 4180) y, en celdas de TEXTO, anteponer `'` si empiezan por `=`,
  `+`, `-`, `@`, tabulador o retorno (inyección de fórmulas en Excel). Los montos y fechas no pasan por esa
  protección: un monto negativo es legítimo.

## Observabilidad

- Id por petición (cabecera `X-Request-Id`) en cada línea de log y en la respuesta de error, para que el
  usuario lo reporte.
- Log estructurado (JSON) de errores con método, ruta y traza corta; sin cuerpos ni query strings
  (datos personales).
- Registro de consultas lentas (umbral configurable) y `/admin/metrics` protegido.
- `/health` que **toca la base** (no solo responde 200).
- Errores no capturados y rechazos de promesas registrados; apagado ordenado con SIGTERM (cerrar SSE,
  terminar peticiones, cerrar el pool).
- Monitor externo con alerta (acción de operación): dile al dueño qué configurar.

## Documento de escalabilidad

Mantén un documento vivo con: tabla de hallazgos (prioridad, tipo C/R, estado), sección por cambio
(problema medido, qué se hizo, cómo verificar, pendiente), información que falta del hosting (procesos,
conexiones máximas, versión de la base) y un historial. Es lo que permite retomar el trabajo meses después.

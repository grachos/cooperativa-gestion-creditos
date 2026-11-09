# Reintentos y fallas

Los reintentos van a ocurrir (red móvil, proxy, usuario impaciente, deadlock). Hay que decidir **cuáles se hacen solos, cuáles
nunca, y qué pasa cuando algo de lo que dependes falla**.

## Reintentos del cliente (navegador)

| Respuesta | ¿Reintentar solo? | Por qué |
|---|---|---|
| fallo de red, `502/503/504` | **sí, pero solo si la petición lleva `Idempotency-Key`** | repetir es inofensivo: el servidor no duplica el efecto (ver `blindaje-transaccional/references/idempotencia.md`) |
| `409 IDEMPOTENCY_IN_PROGRESS` | sí (la original sigue ejecutándose) | |
| `401` | una vez, tras renovar el token, con la misma clave y cuerpo | |
| `429` | **no**: mostrar «espera N minutos» (respetar `Retry-After`) | reintentar solo agrava el bloqueo |
| `403 CAPTCHA-0x` | **no**: pedir un reto nuevo (el token es de un solo uso) | repetir el mismo token nunca funciona |
| `400`, `404`, `409` de regla de negocio, `5xx` sin clave | **no** | un reintento ciego duplica o repite el error |

- Espera creciente con tope: 400 ms, 1,2 s, 2,5 s (3 reintentos). Con algo de aleatoriedad si hay muchos clientes.
- **Sin `Idempotency-Key`, un POST nunca se reintenta solo.** Los GET sí pueden.
- El botón se deshabilita al enviar y un `ref` síncrono ignora el segundo clic (el `disabled` de React llega tarde).

## Reintentos del servidor

- **Deadlock** (MySQL 1213, Postgres 40P01/40001): repetir la transacción completa, 2 veces, con espera aleatoria de
  20–100 ms. Por eso dentro de la transacción solo trabajo de base de datos (nada de correos ni HTTP).
- **Llamadas a terceros** (captcha, correo, pasarela): siempre con **timeout** (5 s para el captcha) y sin reintento
  automático dentro de la petición del usuario; si hay que reintentar, en una cola aparte.

## Qué hacer cuando algo falla: ¿cerrado o abierto?

| Dependencia | Al fallar | Razón |
|---|---|---|
| Captcha (Cloudflare caído, sin llave) | **cerrado** (rechazar) + palanca de emergencia `ENFORCE=false` | si se deja pasar «por si acaso», el captcha no protege nada |
| Contador de intentos (base de datos caída) | **cerrado** (error 500) | sin saber cuántos intentos van, no se puede limitar; el resto del sistema tampoco funcionaría |
| Correo de recuperación (SMTP caído) | **abierto**: se responde igual 204 y se registra el error | no filtrar si el usuario existe ni exponer la falla |
| Auditoría (no se pudo escribir la fila) | **abierto**: se registra el error y la petición sigue | la auditoría no debe tumbar el ingreso |
| Eventos en vivo (SSE) | abierto | |

Regla: lo que **decide si alguien entra** falla cerrado; lo que **solo informa** falla abierto. Y toda falla cerrada debe tener
una salida documentada para el dueño.

## Mensajes al usuario

Claros y sin detalles internos: «La verificación venció, vuelve a intentarlo», «Demasiados intentos, espera 15 minutos o
restablece tu contraseña», «No se pudo cargar la verificación: revisa tu conexión o desactiva el bloqueador de contenido».
Los códigos de error de proveedores externos van a los registros.

# Límites, bloqueos y auditoría (en la base de datos)

Código en `assets/backend/authGuard.ts` y tablas en `assets/backend/030_antibots.sql`.

## Por qué en la base y no en memoria

El hosting corre varios procesos Node (y serverless no comparte estado): un contador en memoria cuenta aparte en cada
uno, así que el límite real era N veces mayor y se reiniciaba con cada despliegue. Tabla compartida, con índices por
`(acción, ip, fecha)` y `(acción, identificador, fecha)`, y purga periódica.

## Qué se limita (ventana de 15 min; todo configurable por variable de entorno)

| Límite | Valor inicial | Protege de |
|---|---|---|
| peticiones totales por IP y acción | 40 | inundar correos, CPU de hash, escrituras |
| intentos de login **fallidos** por IP | 20 | probar una contraseña en muchas cuentas (relleno de credenciales) |
| intentos fallidos por **identificador** (usuario o correo tecleado), desde el último acceso exitoso | 5 | fuerza bruta sobre una cuenta |

- Respuesta `429` con `Retry-After` y un mensaje claro; el de la cuenta puede ofrecer «restablece tu contraseña».
- **Oficina detrás de una sola IP:** por eso el límite por IP de login cuenta solo los **fallidos**, no los accesos exitosos;
  de lo contrario seis empleados entrando por la mañana se bloquean entre sí.
- En pruebas automáticas todos comparten IP: poner el límite por IP muy alto cuando `NODE_ENV=test` (y probar los límites
  con valores pasados a mano al middleware, no por variables de entorno).

## Lo que más falla: el orden y la medición

1. **Insertar el intento ANTES de verificar** (como fallido) y marcarlo `success = 1` si sale bien. Si cuentas y luego
   insertas, una ráfaga de 14 peticiones simultáneas pasa las 14 antes de que ninguna se registre. Insertando primero, la
   petición número «límite + 1» ve al menos esa cantidad de filas y se bloquea: pasan como mucho `límite` (se probó con 14
   simultáneas y límite 5).
2. **Contar los fallos desde el último éxito por `id`, no por hora.** `created_at` tiene precisión de segundos: los fallos
   ocurridos en el mismo segundo que el éxito no se contaban. Lo encontró una prueba. `id > (SELECT MAX(id) … success = 1)`.
3. **Mismo límite exista o no la cuenta.** Si solo se bloquean las cuentas que existen, quien prueba usuarios sabe cuáles
   existen por cuándo recibe el 429: es un oráculo de enumeración. Limitar por el **hash** del identificador tecleado, no por
   `user_id`.
4. **Guardar el identificador solo como hash** (SHA-256 de `trim().toLowerCase()`): lo tecleado a veces es una contraseña
   puesta en el campo equivocado, y mayúsculas no deben librar del bloqueo.
5. Los bloqueos temporales **expiran solos**; no hay bloqueo permanente de cuenta (sería un arma para denegar el servicio
   a un usuario real). El usuario puede salir con «restablecer contraseña», que también tiene su propio tope (p. ej. 3
   correos por hora por usuario).

## Mensajes uniformes

Mismo mensaje y mismo código para «usuario no existe» y «clave incorrecta». «Recuperar contraseña» responde siempre 204,
exista o no el usuario. El resultado fino (`UNKNOWN_USER`, `SENT`, `THROTTLED`, `LOCKED`) va **solo** a la auditoría.

## Auditoría (tabla `auth_audit`)

Una fila por petición, escrita al terminar la respuesta (`res.on("finish")`, sin bloquearla): fecha, IP, agente de usuario,
acción, hash del identificador, `user_id` si se conoce, resultado del captcha (`OK`, `SKIPPED`, `CAPTCHA-0x`,
`NOT_CHECKED`), resultado del acceso (`SUCCESS`, `INVALID_CREDENTIALS`, `LOCKED`, `RATE_LIMITED`, `CAPTCHA_FAILED`,
`NO_ACCESS`, …) y código HTTP. **Nunca** contraseñas, tokens ni el identificador en claro. Sin llave foránea a `users`
(el rastro sobrevive a la baja del usuario y a una limpieza de datos). Retención: intentos 2 días, auditoría 1 año.
Prueba: que un volcado de las filas no contenga la contraseña, el token ni el identificador enviados.

## Pruebas (ver `references/pruebas-seguridad.md`)

IP única por corrida (IPv6 con prefijo aleatorio) e identificadores únicos: las filas de corridas anteriores siguen dentro
de la ventana de 15 minutos y hacen fallar pruebas «por herencia».

# Pruebas de las defensas

## Principios

1. **Una prueba que nunca falló no demuestra nada.** Tras escribirlas, rompe la defensa a propósito (quita la comprobación
   del hostname, de la llave secreta, del token en el botón…) y comprueba que fallan; luego restaura. En este proyecto:
   quitar dos comprobaciones del verificador hizo fallar 2 pruebas; quitar «sin token no se envía» del hook hizo fallar 8.
2. **El proveedor del captcha se simula** inyectando `fetchImpl` (y `now`, `log`, `timeoutMs`) al verificador: ninguna
   prueba toca la red ni el widget real.
3. **Contra la base real** para límites y auditoría (no mocks), activadas con una variable (`TEST_DB=1`) y solo contra una
   base de pruebas. **Si de pronto fallan o se saltan muchas pruebas, primero comprueba que la base esté arriba**
   (`mysqladmin ping`): en entornos efímeros se cae entre sesiones.
4. **Aislamiento entre corridas:** las filas siguen dentro de la ventana de 15 min. IP única por corrida (IPv6 con prefijo
   aleatorio vía `X-Forwarded-For` con `trust proxy`) e identificadores únicos (`Date.now()` + aleatorio). Límites pasados a
   mano al middleware, no por variables de entorno.
5. **Suite completa 2–3 veces** antes de subir: las carreras y los datos heredados aparecen en la segunda.

## Qué probar

**Verificador (sin red):** token válido (y que envía secret/response/remoteip); acción errónea; hostname ajeno (y con
mayúsculas, `www` y punto final); token reutilizado (`timeout-or-duplicate`); token vencido por `challenge_ts`; token
ausente, vacío, no-cadena, demasiado largo (sin llamar a Cloudflare); `success:false`; llave secreta inválida; **sin llave
secreta**; **sin lista de dominios**; Cloudflare caído, 500, HTML en vez de JSON, JSON nulo; **tiempo agotado** (el `fetch`
simulado respeta `AbortSignal`); claves de prueba sirven fuera de producción y **se rechazan en producción**; el registro
**no contiene** el token ni la llave; sin IP no se manda `remoteip`.

**Guardia (base real):** límite por IP (429 + `Retry-After`; otra IP no se afecta); por identificador **exista o no la
cuenta**, desde cualquier IP, y mayúsculas no lo evaden; un éxito reinicia el contador (con éxito y fallos en el mismo
segundo); total por IP; **ráfaga simultánea** (14 peticiones, límite 5: pasan ≤ 5 y todas terminan en 401 o 429); reto
fallido → 403 con claves exactas `code/message/status` y sin los códigos del proveedor, cuenta como fallido, y bloqueada la
IP ni se consulta al proveedor; reto superado; token por cabecera; `ENFORCE=false` → `SKIPPED`; auditoría con IP, agente,
acción, resultados y **sin** contraseña, token ni identificador en claro.

**Integración con la aplicación completa:** `TURNSTILE_ENFORCE=true` sin llave secreta → las tres rutas públicas responden
403 `CAPTCHA-02` (falla cerrado); `GET /captcha-config` devuelve solo `{ enforce, siteKey }`; la cabecera
`content-security-policy` incluye el dominio del proveedor en `script-src` y `frame-src`. Las variables de entorno que lee
`config/env.ts` se fijan **antes** del `import()` dinámico de la aplicación (se parsean al importar).

**Frontend (con `window.turnstile` simulado):** sin exigir reto no hay widget y el botón se habilita; con reto, el botón
espera el token y se envía con la acción correcta; expiración/tiempo agotado/error descartan el token y reinician;
`reset()` tras cada envío; sin clave pública → aviso; falla al leer la configuración → aviso (y un nuevo intento la vuelve
a pedir); el script no carga (`onerror`) → aviso; al desmontar se quita el widget.

**Migración:** aplicar, repetir, interrumpida a medias (borrar una de las tablas y reaplicar).

## Trampas encontradas

- `verify(token, …, ip = "x")` con parámetro por defecto: pasar `undefined` activa el valor por defecto y la prueba de
  «sin IP» no probaba nada. Usar `null` explícito.
- Los renders de React Testing Library se acumulan entre pruebas si no se llama a `cleanup()` (`getByRole` encuentra varios).
- El build de producción compila también los archivos de prueba: un error de tipos en una prueba rompe el despliegue aunque
  `vitest` pase. Ejecutar `tsc` y el build antes de subir.
- Usar valores de prueba obvios y únicos (`TOKEN-SECRETO-777`) para comprobar que **no** aparecen en registros ni auditoría.

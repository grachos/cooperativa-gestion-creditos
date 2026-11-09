# Captcha con Cloudflare Turnstile

Funciona igual con reCAPTCHA o hCaptcha (cambian la URL de verificación y los códigos de error); Turnstile se eligió por
ser gratuito, sin acertijos visuales en modo Managed y fácil de integrar. El widget solo entrega un token: **lo que protege
es la verificación en el servidor.**

## Servidor: `verifyTurnstile(token, expectedAction, ip)` (ver `assets/backend/turnstile.ts`)

POST a `https://challenges.cloudflare.com/turnstile/v0/siteverify` con `secret`, `response` y `remoteip`. Rechaza si:

| Situación | Código al cliente | Nota |
|---|---|---|
| `hostname` no está en la lista blanca de dominios propios | `CAPTCHA-01` | un token obtenido en otro sitio no sirve |
| `success` falso (bot, reto no superado, llave secreta inválida, Cloudflare caído o sin responder) | `CAPTCHA-02` | |
| acción distinta a la del formulario | `CAPTCHA-02` | un token de «login» no vale en «recuperar» |
| token ausente, mal formado, vencido (>5 min) o reutilizado (`timeout-or-duplicate`) | `CAPTCHA-03` | el token es de un solo uso |

- **Falla cerrado:** sin `TURNSTILE_SECRET_KEY`, sin lista de dominios, timeout de 5 s, error HTTP o JSON ilegible →
  rechazo. Nunca lanza: siempre devuelve `{ ok: false, code, reason, errorCodes }`.
- **Respuesta HTTP 403** con exactamente `{ code, status: "validation_failed", message }`. Los `error-codes` de Cloudflare y
  el motivo interno van **solo** a los registros y a la auditoría.
- Rechazar también un `challenge_ts` de más de ~5 min (Cloudflare ya lo hace con `timeout-or-duplicate`, esto es defensa
  en profundidad).
- **Nunca registrar** el token ni la llave secreta.
- **Claves de prueba oficiales** (siempre pasa / siempre falla), para desarrollo y pruebas: site `1x00000000000000000000AA`
  / secret `1x0000000000000000000000000000000AA`; falla: `2x00000000000000000000AB` / `2x0000000000000000000000000000000AA`.
  Con ellas los tokens son ficticios, así que **no se comprueban acción ni dominio** — y **en producción se rechazan
  siempre** (una llave de prueba olvidada dejaría pasar a cualquiera).

## Middleware (ver `assets/backend/authGuard.ts`)

`requireTurnstile(action)` va **después** del límite por IP (un bot bloqueado no llega a gastar llamadas a Cloudflare) y antes
del manejador. Token en `cf-turnstile-response` (cuerpo o cabecera). Una `action` distinta por formulario
(`login`, `forgot_password`, `reset_password`, …). Un intento con reto fallido cuenta como intento fallido de esa IP.

### Variables de entorno

`TURNSTILE_SITE_KEY` (pública), `TURNSTILE_SECRET_KEY` (solo servidor), `TURNSTILE_ALLOWED_HOSTNAMES` (con y sin `www`, sin
`https://`), `TURNSTILE_ENFORCE` (**por defecto true**; en pruebas automáticas, false). `ENFORCE=false` es la **palanca de
emergencia**: el servidor deja de exigirlo y la pantalla no muestra el widget.

## Frontend (ver `assets/frontend/`)

- Cargar `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` **una sola vez**; renderizar con
  `sitekey`, `action` y callbacks. Si el script no carga (bloqueador de contenido) → mensaje claro, sin enviar.
- **Botón deshabilitado hasta tener token.** Si el token vence (`expired-callback`), se agota el tiempo
  (`timeout-callback`) o hay error (`error-callback`, devolver `true`), descartar el token y `turnstile.reset()`.
- **Reiniciar el reto después de CADA envío**, salga bien o mal: el token ya se gastó. Es el error que más se olvida.
- **La clave pública la entrega el servidor** (`GET /auth/captcha-config` → `{ enforce, siteKey }`, nunca la secreta). Variables
  `VITE_*` se hornean en la compilación y en algunos hostings no llegan al build; así además se pueden cambiar las
  claves sin recompilar. Cachear la configuración una vez por carga de página.
- El cliente de la API debe mostrar `body.message` además de `body.error` (los rechazos del reto traen `message`).

## Cabeceras: lo que bloquea el widget sin avisar

`helmet()` por defecto trae una política de contenido (CSP) que **bloquea** el script y el iframe de Cloudflare: el widget
simplemente no aparece. Añadir:

```ts
const CF = "https://challenges.cloudflare.com";
app.use(helmet({ contentSecurityPolicy: { directives: {
  ...helmet.contentSecurityPolicy.getDefaultDirectives(),
  "script-src": ["'self'", CF], "frame-src": ["'self'", CF], "connect-src": ["'self'", CF]
} } }));
```

Helmet 7 deja `Cross-Origin-Embedder-Policy` apagado (en versiones donde estuviera en `require-corp` también rompería el
widget). Probar con una prueba de integración que lea la cabecera `content-security-policy` y busque el dominio.
Otras cabeceras útiles que helmet ya trae: `X-Content-Type-Options`, `Strict-Transport-Security`, `X-Frame-Options`.

## Qué no se pudo probar desde el entorno de desarrollo

Muchos entornos de desarrollo en la nube bloquean la salida a `challenges.cloudflare.com`: las pruebas usan un
Cloudflare simulado (inyectar `fetchImpl`). La primera verificación real ocurre en producción, con las claves reales, y
la hace el dueño entrando a la pantalla. Dilo en el informe y deja la palanca de emergencia lista.

## Errores típicos de quien lo configura (para decírselos al dueño)

- Dominio sin autorizar en el sitio de Cloudflare → el widget muestra un error (110200). Agregar apex y `www`.
- Clave secreta o lista de dominios mal escrita → el reto se supera en pantalla pero el servidor responde 403.
- Falta la clave pública en el servidor → la pantalla avisa «no está configurada».

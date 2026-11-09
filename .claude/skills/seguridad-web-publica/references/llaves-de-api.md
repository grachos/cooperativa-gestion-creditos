# Llaves de API para integraciones legítimas

> **Estado en el proyecto de origen:** este es un **diseño, no construido ni probado en producción**: allí no había ninguna
> integración (el cron de alertas ya usa su propio secreto con comparación en tiempo constante). Se dejó acordado para que,
> cuando haga falta una, se agregue sin tocar el ingreso. Al implementarlo, escribe las pruebas y dilo en el informe.

Tus propios bots, el cron y otros sistemas **no pueden resolver un captcha**. La solución no es saltarse el captcha en las
rutas de personas, sino darles **otra puerta, con su propia autenticación**.

## Reglas

1. **Ruta separada** (p. ej. `/api/v1/integration/*`) con su propio middleware de llave. **Nunca** poner en `login` o en un
   formulario público algo como «si trae la cabecera X, sáltate Turnstile»: sería exactamente el hueco que un atacante
   busca. La llave solo abre las rutas pensadas para máquinas.
2. **La llave viaja por cabecera** (`Authorization: Bearer <llave>` o `X-Api-Key`), nunca en la URL (queda en registros).
3. **Generación:** `crypto.randomBytes(32).toString("base64url")` (256 bits). Una llave por integración, para poder revocar
   una sin afectar a las demás.
4. **Almacenamiento:** en variables de entorno del hosting (nunca en el repositorio ni en el frontend), idealmente como
   **hash SHA-256** de cada llave con su nombre (`INTEGRATION_API_KEYS="facturacion:ab12…,cron:cd34…"`): una filtración de la
   configuración no entrega las llaves.
5. **Comparación en tiempo constante:** hashear la llave recibida y comparar con `crypto.timingSafeEqual` los dos hashes
   (misma longitud siempre, no se filtra ni el largo). Nada de `===`.
6. **Permisos mínimos por llave** (alcances): una integración de lectura no puede escribir.
7. **Límite propio por llave** (reutiliza `auth_attempts` con acción `api_key` y el nombre de la llave como identificador) y
   auditoría con el **nombre** de la llave (no la llave).
8. **Rotación:** admitir dos llaves activas por integración durante el cambio; vencimiento si es posible; revocar =
   quitar de la variable de entorno y reiniciar.
9. **Registro:** nunca imprimir la llave (ni en errores). Tras un 401, mismo mensaje exista o no la llave.
10. Si hay que llamar a un proveedor externo de pago, propagar la misma `Idempotency-Key` (ver `blindaje-transaccional`).

## Esqueleto (adaptar y probar)

```ts
import crypto from "node:crypto";
const sha = (s: string) => crypto.createHash("sha256").update(s).digest();
// INTEGRATION_API_KEYS="nombre:hashHex,otra:hashHex"
const keys = (process.env.INTEGRATION_API_KEYS ?? "").split(",").filter(Boolean).map((p) => {
  const [name, hex] = p.split(":");
  return { name, hash: Buffer.from(hex ?? "", "hex") };
});
export const requireApiKey: RequestHandler = (req, res, next) => {
  const received = /^Bearer (.+)$/.exec(req.get("authorization") ?? "")?.[1] ?? req.get("x-api-key") ?? "";
  const digest = sha(received);
  const match = keys.find((k) => k.hash.length === digest.length && crypto.timingSafeEqual(k.hash, digest));
  if (!match) return res.status(401).json({ error: "No autorizado" });
  res.locals.apiKeyName = match.name;
  next();
};
```

## Pruebas que debe tener

Llave válida pasa; inválida, ausente o de otra integración → 401 con el mismo mensaje; la ruta de personas **sigue exigiendo**
captcha aunque venga una llave válida; la llave no aparece en registros ni auditoría; el límite por llave funciona.

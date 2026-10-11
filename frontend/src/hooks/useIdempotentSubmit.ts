import { useCallback, useEffect, useRef, useState } from "react";
import { idempotencyKeys } from "../lib/idempotency";

/**
 * Evita que una misma acción del usuario cree o envíe registros duplicados.
 *
 *  - `pending` pasa a true al instante (úselo para deshabilitar el botón y
 *    mostrar el estado de carga).
 *  - `submit` ignora cualquier llamada mientras haya una en curso. Se apoya en
 *    un ref (síncrono), no solo en el estado: un doble clic, un Enter repetido
 *    o dos controles que disparen el mismo envío antes de que React vuelva a
 *    renderizar NO generan una segunda petición.
 *  - La clave `Idempotency-Key` se crea por operación lógica y se reutiliza en
 *    cada reintento del mismo contenido (tras un error se conserva); una vez
 *    que la operación tiene éxito se descarta, y un contenido distinto o una
 *    acción nueva reciben una clave nueva.
 *
 * `submit` devuelve `{ ran: false }` cuando ignoró la llamada por duplicada y
 * `{ ran: true, result }` si se ejecutó. Si la petición falla, relanza el error
 * para que el formulario lo muestre; `pending` vuelve a false y el usuario puede
 * corregir o reintentar.
 *
 * @param scope identifica la operación (p. ej. `payment:${creditId}`).
 */
export function useIdempotentSubmit(scope: string) {
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = useCallback(
    async <T>(payload: unknown, send: (idempotencyKey: string) => Promise<T>): Promise<{ ran: false } | { ran: true; result: T }> => {
      if (inFlight.current) return { ran: false };
      inFlight.current = true;
      setPending(true);
      try {
        const key = idempotencyKeys.acquire(scope, payload);
        const result = await send(key);
        idempotencyKeys.release(scope);
        return { ran: true, result };
      } finally {
        inFlight.current = false;
        if (mounted.current) setPending(false);
      }
    },
    [scope]
  );

  return { submit, pending };
}

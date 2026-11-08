import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

/**
 * Widget de Cloudflare Turnstile (modo Managed). Carga el script oficial una sola vez, dibuja el reto con la clave
 * pública y la `action` del formulario, y avisa con `onToken` cada vez que cambia el token (null = ya no sirve).
 * El token es de un solo uso y dura 5 minutos: al vencer, fallar o expirar se reinicia el reto solo; el formulario
 * debe llamar a `reset()` después de CADA envío (aunque falle), porque Cloudflare ya lo dio por usado.
 */

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

/** Carga api.js una vez. Si falla (bloqueador de anuncios, sin red) se puede reintentar. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile no disponible")));
      script.onerror = () => {
        scriptPromise = null;
        script.remove();
        reject(new Error("no se pudo cargar el script de Turnstile"));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

export interface TurnstileHandle {
  reset: () => void;
}

interface TurnstileWidgetProps {
  siteKey: string;
  /** Una acción distinta por formulario: login, forgot_password, reset_password. */
  action: string;
  onToken: (token: string | null) => void;
  onError?: (message: string) => void;
}

export const TurnstileWidget = forwardRef<TurnstileHandle, TurnstileWidgetProps>(function TurnstileWidget(
  { siteKey, action, onToken, onError },
  handleRef
) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // Los callbacks cambian en cada render; el widget se dibuja una sola vez.
  const callbacks = useRef({ onToken, onError });
  callbacks.current = { onToken, onError };

  useImperativeHandle(handleRef, () => ({
    reset() {
      callbacks.current.onToken(null);
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
    }
  }));

  useEffect(() => {
    let cancelled = false;
    callbacks.current.onToken(null); // un token de un widget anterior ya no vale
    loadTurnstile().then(
      (api) => {
        if (cancelled || !container.current) return;
        widgetId.current = api.render(container.current, {
          sitekey: siteKey,
          action,
          theme: "light",
          callback: (token: string) => callbacks.current.onToken(token),
          // Vencido o con tiempo agotado: el token ya no sirve y se pide otro reto.
          "expired-callback": () => {
            callbacks.current.onToken(null);
            if (widgetId.current) api.reset(widgetId.current);
          },
          "timeout-callback": () => {
            callbacks.current.onToken(null);
            if (widgetId.current) api.reset(widgetId.current);
          },
          "error-callback": () => {
            callbacks.current.onToken(null);
            callbacks.current.onError?.("No se pudo completar la verificación de seguridad. Pulsa «Reintentar» o recarga la página.");
            if (widgetId.current) api.reset(widgetId.current);
            return true;
          }
        });
      },
      () => {
        if (!cancelled) {
          callbacks.current.onError?.(
            "No se pudo cargar la verificación de seguridad. Revisa tu conexión o desactiva el bloqueador de contenido e intenta de nuevo."
          );
        }
      }
    );
    return () => {
      cancelled = true;
      callbacks.current.onToken(null);
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, action]);

  return <div ref={container} className="my-4 flex min-h-[65px] justify-center" data-testid="turnstile-container" />;
});

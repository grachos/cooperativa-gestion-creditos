import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { TurnstileWidget, type TurnstileHandle } from "../components/TurnstileWidget";

interface CaptchaConfig {
  enforce: boolean;
  siteKey: string | null;
}

// La configuración es la misma para todas las pantallas: se pide una vez por carga de la página.
let configPromise: Promise<CaptchaConfig> | null = null;
function loadConfig(): Promise<CaptchaConfig> {
  if (!configPromise) {
    configPromise = api.get<CaptchaConfig>("/auth/captcha-config").catch((err) => {
      configPromise = null; // permite reintentar
      throw err;
    });
  }
  return configPromise;
}
/** Solo para pruebas. */
export function resetCaptchaConfigCache() {
  configPromise = null;
}

export interface UseTurnstile {
  /** Elemento a poner dentro del formulario (null si no se exige el reto). */
  widget: ReactNode;
  /** El botón de envío debe estar habilitado. */
  canSubmit: boolean;
  /** Campo para añadir al cuerpo de la petición: { "cf-turnstile-response": token } o {}. */
  payload: Record<string, string>;
  /** Aviso a mostrar (configuración ausente, widget no cargó…) o null. */
  message: string | null;
  /** Descarta el token y pide otro reto: llamar después de CADA envío, salga bien o mal. */
  reset: () => void;
}

/**
 * Reto anti-bots de un formulario: lee del servidor si se exige y la clave pública, muestra el widget con la acción del
 * formulario, y mantiene el token. El botón de envío queda deshabilitado hasta tener token.
 */
export function useTurnstile(action: string): UseTurnstile {
  const [config, setConfig] = useState<CaptchaConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [widgetError, setWidgetError] = useState<string | null>(null);
  const handle = useRef<TurnstileHandle>(null);

  useEffect(() => {
    let alive = true;
    loadConfig().then(
      (c) => alive && setConfig(c),
      () => alive && setConfigError(true)
    );
    return () => {
      alive = false;
    };
  }, []);

  const onToken = useCallback((t: string | null) => {
    setToken(t);
    if (t) setWidgetError(null);
  }, []);

  const reset = useCallback(() => {
    handle.current?.reset();
    setToken(null);
  }, []);

  const required = config?.enforce === true;
  const misconfigured = required && !config?.siteKey;

  let message: string | null = widgetError;
  if (configError) message = "No se pudo cargar la verificación de seguridad. Recarga la página.";
  else if (misconfigured) message = "La verificación de seguridad no está configurada. Contacta al administrador.";

  const widget =
    required && config?.siteKey ? (
      <TurnstileWidget ref={handle} siteKey={config.siteKey} action={action} onToken={onToken} onError={setWidgetError} />
    ) : null;

  return {
    widget,
    canSubmit: config !== null && !configError && !misconfigured && (!required || token !== null),
    payload: required && token ? { "cf-turnstile-response": token } : {},
    message,
    reset
  };
}

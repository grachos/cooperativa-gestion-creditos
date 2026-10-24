import { useEffect, useState } from "react";

const SPLASH_VISIBLE_MS = 900;
const SPLASH_TRANSITION_MS = 600;

/** Después de iniciar sesión: logo + círculo de carga durante unos segundos (pedido de la cooperativa, 2026-10-24). */
const LOADING_VISIBLE_MS = 3000;

interface SplashIntroProps {
  /** Muestra el círculo de estado "Cargando la página…" y alarga la pantalla a LOADING_VISIBLE_MS. */
  showLoading?: boolean;
  /** Se dispara cuando el logo empieza a achicarse/desvanecerse — el momento de hacer crossfade con el contenido de debajo. */
  onLeaveStart?: () => void;
  /** Se dispara cuando termina la animación y el splash se desmonta. */
  onDone?: () => void;
}

/**
 * Logo grande a pantalla completa que se achica y se desvanece mientras el
 * contenido de debajo aparece en crossfade. Se usa en el login y justo
 * después de iniciar sesión, mientras carga la app.
 */
export function SplashIntro({ onLeaveStart, onDone, showLoading = false }: SplashIntroProps) {
  const [leaving, setLeaving] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [progress, setProgress] = useState(0);
  const visibleMs = showLoading ? LOADING_VISIBLE_MS : SPLASH_VISIBLE_MS;

  // Avance del círculo: de 0 a 100 % durante el tiempo visible.
  useEffect(() => {
    if (!showLoading) return;
    const start = Date.now();
    const tick = setInterval(() => {
      const pct = Math.min(100, Math.round(((Date.now() - start) / LOADING_VISIBLE_MS) * 100));
      setProgress(pct);
      if (pct >= 100) clearInterval(tick);
    }, 50);
    return () => clearInterval(tick);
  }, [showLoading]);

  useEffect(() => {
    const leaveTimer = setTimeout(() => {
      setLeaving(true);
      onLeaveStart?.();
    }, visibleMs);
    const unmountTimer = setTimeout(() => {
      setMounted(false);
      onDone?.();
    }, visibleMs + SPLASH_TRANSITION_MS);
    return () => {
      clearTimeout(leaveTimer);
      clearTimeout(unmountTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!mounted) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-white transition-all ease-in-out ${
        leaving ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      style={{ transitionDuration: `${SPLASH_TRANSITION_MS}ms` }}
      aria-hidden={showLoading ? undefined : "true"}
    >
      <div className="flex flex-col items-center gap-8">
        <img
          src="/logo.jpg"
          alt={showLoading ? "Coomulnissi" : ""}
          className={`object-contain transition-all ease-in-out ${
            leaving ? "h-24 w-24 scale-90 opacity-0" : "h-56 w-56 scale-100 opacity-100"
          }`}
          style={{ transitionDuration: `${SPLASH_TRANSITION_MS}ms` }}
        />
        {showLoading && <LoadingCircle progress={progress} />}
      </div>
    </div>
  );
}

const RADIUS = 34;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Círculo que se llena con el porcentaje y el texto de estado debajo. */
function LoadingCircle({ progress }: { progress: number }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-3">
      <div className="relative h-20 w-20">
        <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90">
          <circle cx="40" cy="40" r={RADIUS} fill="none" strokeWidth="6" className="stroke-slate-200" />
          <circle
            cx="40"
            cy="40"
            r={RADIUS}
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            className="stroke-brand-600 transition-[stroke-dashoffset] duration-100 ease-linear"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - progress / 100)}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-slate-700">{progress}%</span>
      </div>
      <p className="text-sm text-slate-500">{progress < 100 ? "Cargando la página…" : "¡Listo!"}</p>
    </div>
  );
}

export { SPLASH_VISIBLE_MS, SPLASH_TRANSITION_MS, LOADING_VISIBLE_MS };

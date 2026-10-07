import { useEffect, useState } from "react";

const SPLASH_VISIBLE_MS = 900;
const SPLASH_TRANSITION_MS = 600;

interface SplashIntroProps {
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
export function SplashIntro({ onLeaveStart, onDone }: SplashIntroProps) {
  const [leaving, setLeaving] = useState(false);
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    const leaveTimer = setTimeout(() => {
      setLeaving(true);
      onLeaveStart?.();
    }, SPLASH_VISIBLE_MS);
    const unmountTimer = setTimeout(() => {
      setMounted(false);
      onDone?.();
    }, SPLASH_VISIBLE_MS + SPLASH_TRANSITION_MS);
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
      aria-hidden="true"
    >
      <img
        src="/logo.jpg"
        alt=""
        className={`object-contain transition-all ease-in-out ${
          leaving ? "h-24 w-24 scale-90 opacity-0" : "h-56 w-56 scale-100 opacity-100"
        }`}
        style={{ transitionDuration: `${SPLASH_TRANSITION_MS}ms` }}
      />
    </div>
  );
}

export { SPLASH_VISIBLE_MS, SPLASH_TRANSITION_MS };

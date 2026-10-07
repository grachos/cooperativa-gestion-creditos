import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";

const IDLE_LIMIT_MS = 10 * 60 * 1000;
const WARNING_MS = 60 * 1000;
// Compartido entre pestañas: actividad en una pestaña mantiene viva la sesión en las demás.
const LAST_ACTIVITY_KEY = "lastActivityAt";
const ACTIVITY_EVENTS = ["mousedown", "keydown", "scroll", "touchstart", "mousemove"] as const;

// Respaldo en memoria por si localStorage no está disponible (modo privado).
let memoryLastActivity = Date.now();

function readLastActivity(): number {
  try {
    return Number(localStorage.getItem(LAST_ACTIVITY_KEY)) || memoryLastActivity;
  } catch {
    return memoryLastActivity;
  }
}

function writeLastActivity(at: number) {
  memoryLastActivity = at;
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(at));
  } catch {
    // Sin almacenamiento: el temporizador sigue funcionando en esta pestaña.
  }
}

export function IdleTimeout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // El efecto del temporizador corre UNA sola vez. Antes dependía del estado del
  // aviso y, al abrirse, se reiniciaba y volvía a marcar "actividad ahora": el
  // aviso desaparecía al segundo y la sesión nunca se cerraba. Lo que cambia
  // entre renders (logout, navigate, si el aviso está abierto) se lee por refs.
  const warningOpen = useRef(false);
  const lastWrite = useRef(0);
  const expireRef = useRef<(byInactivity: boolean) => Promise<void>>(async () => {});

  useEffect(() => {
    expireRef.current = async (byInactivity: boolean) => {
      try {
        await logout();
      } catch {
        // Aunque el servidor no responda, la sesión local ya se limpió.
      }
      navigate(byInactivity ? "/login?expirada=1" : "/login", { replace: true });
    };
  });

  useEffect(() => {
    writeLastActivity(Date.now());

    function onActivity() {
      const now = Date.now();
      // Con el aviso abierto solo cuenta el botón "Seguir conectado".
      if (warningOpen.current || now - lastWrite.current < 5000) return;
      lastWrite.current = now;
      writeLastActivity(now);
    }
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));

    const timer = setInterval(() => {
      const idle = Date.now() - readLastActivity();
      if (idle >= IDLE_LIMIT_MS) {
        clearInterval(timer);
        void expireRef.current(true);
      } else if (idle >= IDLE_LIMIT_MS - WARNING_MS) {
        warningOpen.current = true;
        setSecondsLeft(Math.ceil((IDLE_LIMIT_MS - idle) / 1000));
      } else {
        // También cierra el aviso si otra pestaña registró actividad.
        warningOpen.current = false;
        setSecondsLeft(null);
      }
    }, 1000);

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      clearInterval(timer);
    };
  }, []);

  function stayLoggedIn() {
    writeLastActivity(Date.now());
    warningOpen.current = false;
    setSecondsLeft(null);
    void api.get("/auth/me").catch(() => {});
  }

  if (secondsLeft === null) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-title"
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
        <div className="mb-3 flex items-center gap-2 text-brand-700">
          <Clock className="h-5 w-5" aria-hidden="true" />
          <h2 id="idle-title" className="text-base font-semibold text-slate-800">
            ¿Sigues ahí?
          </h2>
        </div>
        <p className="mb-5 text-sm text-slate-600">
          Por inactividad, tu sesión se cerrará en <span className="font-semibold text-slate-800">{secondsLeft} s</span>.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            autoFocus
            onClick={stayLoggedIn}
            className="flex-1 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Seguir conectado
          </button>
          <button
            type="button"
            onClick={() => void expireRef.current(false)}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}

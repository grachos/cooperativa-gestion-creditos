import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { SplashIntro } from "../components/SplashIntro";
import { PasswordInput } from "../components/PasswordInput";
import { useTurnstile } from "../hooks/useTurnstile";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionExpired = searchParams.get("expirada") === "1";
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [mode, setMode] = useState<"login" | "forgot" | "forgot-sent">("login");
  const [forgotIdentifier, setForgotIdentifier] = useState("");
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotSubmitting, setForgotSubmitting] = useState(false);

  const [splashDone, setSplashDone] = useState(false);
  // Reto anti-bots (Cloudflare Turnstile): una acción distinta por formulario. El botón queda deshabilitado hasta tener token.
  const loginCaptcha = useTurnstile("login");
  const forgotCaptcha = useTurnstile("forgot_password");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(identifier, password, loginCaptcha.payload);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar sesión");
    } finally {
      setSubmitting(false);
      loginCaptcha.reset(); // el token es de un solo uso: salga bien o mal, hay que pedir otro
    }
  }

  async function onForgotSubmit(e: FormEvent) {
    e.preventDefault();
    setForgotError(null);
    setForgotSubmitting(true);
    try {
      await api.post("/auth/forgot-password", { identifier: forgotIdentifier, ...forgotCaptcha.payload });
      setMode("forgot-sent");
    } catch (err) {
      setForgotError(err instanceof Error ? err.message : "No se pudo procesar la solicitud");
    } finally {
      setForgotSubmitting(false);
      forgotCaptcha.reset();
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <SplashIntro onLeaveStart={() => setSplashDone(true)} />

      <div
        className={`w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition-opacity duration-500 ${
          splashDone ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="mb-6 flex flex-col items-center gap-2">
          <img src="/logo.jpg" alt="Coomulnissi" className="h-32 w-32 object-contain" />
          <h1 className="text-lg font-semibold text-slate-800">Coomulnissi</h1>
          <p className="text-center text-xs text-slate-500">Cooperativa Multiactiva Nissi · Gestión de Créditos</p>
        </div>

        {mode === "login" && (
          <form onSubmit={onSubmit}>
            {sessionExpired && !error && (
              <p className="mb-4 rounded-md bg-amber-50 p-2 text-sm text-amber-800">
                Tu sesión se cerró por inactividad. Ingresa de nuevo para continuar.
              </p>
            )}
            {error && <p className="mb-4 rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}

            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="identifier">
              Usuario o correo
            </label>
            <input
              id="identifier"
              name="username"
              autoComplete="username"
              className="mb-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
            />

            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="password">
              Contraseña
            </label>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="current-password"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <button
              type="button"
              onClick={() => {
                setForgotIdentifier(identifier);
                setForgotError(null);
                setMode("forgot");
              }}
              className="mb-6 mt-1 block text-xs font-medium text-brand-700 hover:text-brand-900"
            >
              ¿Olvidaste tu contraseña?
            </button>

            {loginCaptcha.widget}
            {loginCaptcha.message && <p className="mb-3 rounded-md bg-amber-50 p-2 text-sm text-amber-800">{loginCaptcha.message}</p>}

            <button
              type="submit"
              disabled={submitting || !loginCaptcha.canSubmit}
              className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {submitting ? "Ingresando..." : "Ingresar"}
            </button>
          </form>
        )}

        {mode === "forgot" && (
          <form onSubmit={onForgotSubmit}>
            <p className="mb-4 text-sm text-slate-600">
              Indica tu usuario o correo y te enviaremos un enlace para elegir una nueva contraseña.
            </p>

            {forgotError && <p className="mb-4 rounded-md bg-red-50 p-2 text-sm text-red-700">{forgotError}</p>}

            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="forgot-identifier">
              Usuario o correo
            </label>
            <input
              id="forgot-identifier"
              name="username"
              autoComplete="username"
              className="mb-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              value={forgotIdentifier}
              onChange={(e) => setForgotIdentifier(e.target.value)}
              required
            />

            {forgotCaptcha.widget}
            {forgotCaptcha.message && <p className="mb-3 rounded-md bg-amber-50 p-2 text-sm text-amber-800">{forgotCaptcha.message}</p>}

            <button
              type="submit"
              disabled={forgotSubmitting || !forgotCaptcha.canSubmit}
              className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {forgotSubmitting ? "Enviando..." : "Enviar enlace de restablecimiento"}
            </button>

            <button
              type="button"
              onClick={() => setMode("login")}
              className="mt-4 block w-full text-center text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              Volver a iniciar sesión
            </button>
          </form>
        )}

        {mode === "forgot-sent" && (
          <div>
            <p className="mb-6 rounded-md bg-brand-50 p-3 text-sm text-brand-800">
              Si el usuario o correo existe, enviamos un enlace para restablecer la contraseña. Revisa tu bandeja de
              entrada (y spam) — el enlace vence en 1 hora.
            </p>
            <button
              type="button"
              onClick={() => setMode("login")}
              className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Volver a iniciar sesión
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

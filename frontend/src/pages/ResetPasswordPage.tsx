import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { PasswordInput } from "../components/PasswordInput";

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const uid = searchParams.get("uid") ?? "";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const missingLink = !token || !uid;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Las contraseñas no coinciden");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/auth/reset-password", { token, uid: Number(uid), newPassword });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo restablecer la contraseña");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <img src="/logo.jpg" alt="Coomulnissi" className="h-20 w-20 object-contain" />
          <h1 className="text-lg font-semibold text-slate-800">Restablecer contraseña</h1>
        </div>

        {missingLink && (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            Este enlace no es válido. Solicita uno nuevo desde la pantalla de inicio de sesión.
          </p>
        )}

        {!missingLink && done && (
          <div>
            <p className="mb-6 rounded-md bg-brand-50 p-3 text-sm text-brand-800">
              Tu contraseña se actualizó correctamente. Ya puedes iniciar sesión con la nueva contraseña.
            </p>
            <Link
              to="/login"
              className="block w-full rounded-md bg-brand-600 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-brand-700"
            >
              Ir a iniciar sesión
            </Link>
          </div>
        )}

        {!missingLink && !done && (
          <form onSubmit={onSubmit}>
            {error && <p className="mb-4 rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}

            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="new-password">
              Nueva contraseña
            </label>
            <PasswordInput
              id="new-password"
              required
              minLength={6}
              wrapperClassName="mb-4"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />

            <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor="confirm-password">
              Confirmar contraseña
            </label>
            <PasswordInput
              id="confirm-password"
              required
              minLength={6}
              wrapperClassName="mb-6"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {submitting ? "Guardando..." : "Guardar nueva contraseña"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

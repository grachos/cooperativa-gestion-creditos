// En desarrollo, Vite hace proxy de /api hacia el backend local (vite.config.ts).
// En despliegues donde el frontend y el backend no comparten origen (p. ej.
// frontend en Vercel, backend en otro proveedor), define VITE_API_BASE_URL
// apuntando a la URL completa del backend (ej. https://api.midominio.com/api/v1).
const BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api/v1";

function getAccessToken(): string | null {
  return localStorage.getItem("accessToken");
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem("refreshToken");
  if (!refreshToken) return null;
  const res = await fetch(`${BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken })
  });
  if (!res.ok) return null;
  const data = await res.json();
  localStorage.setItem("accessToken", data.accessToken);
  return data.accessToken;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { skipRetry?: boolean } = {}
): Promise<T> {
  const token = getAccessToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

  if (res.status === 401 && !options.skipRetry) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return apiFetch<T>(path, { ...options, skipRetry: true });
    }
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    window.location.href = "/login";
    throw new Error("Sesión expirada");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Error desconocido" }));
    throw new Error(body.error ?? "Error en la solicitud");
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined })
};

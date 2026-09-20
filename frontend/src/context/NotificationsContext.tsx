import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./AuthContext";

interface AlertEvent {
  creditId: number;
  type: string;
  priority: string;
  message: string;
}

type PermissionState = NotificationPermission | "unsupported";

interface NotificationsContextValue {
  permission: PermissionState;
  requestPermission: () => void;
  liveAlertCount: number;
  clearLiveAlertCount: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

function getInitialPermission(): PermissionState {
  return typeof window === "undefined" || !("Notification" in window) ? "unsupported" : Notification.permission;
}

/**
 * Conecta el stream SSE de alertas (ya existente en /alerts/stream) de forma
 * global mientras haya sesión — antes solo se escuchaba dentro de la página
 * de Alertas, así que una alerta nueva no se notificaba si el usuario estaba
 * en otra pantalla. Cuando el permiso del navegador está concedido, cada
 * "alert.created" dispara además una notificación nativa del sistema
 * operativo (funciona mientras la pestaña/PWA siga abierta, aunque esté en
 * segundo plano — no es push a la app completamente cerrada, que requeriría
 * un Service Worker + claves VAPID, fuera del alcance de este MVP).
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [permission, setPermission] = useState<PermissionState>(getInitialPermission);
  const [liveAlertCount, setLiveAlertCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem("accessToken");
    if (!token) return;

    const source = new EventSource(`/api/v1/alerts/stream?token=${token}`);
    source.addEventListener("alert.created", (event) => {
      setLiveAlertCount((c) => c + 1);
      void queryClient.invalidateQueries({ queryKey: ["alerts"] });

      if (getInitialPermission() !== "granted") return;
      try {
        const data = JSON.parse((event as MessageEvent).data) as AlertEvent;
        const notification = new Notification("Nueva alerta · Cooperativa", {
          body: data.message,
          tag: `alert-${data.creditId}-${data.type}`
        });
        notification.onclick = () => {
          window.focus();
          window.location.href = "/alertas";
        };
      } catch {
        // Evento sin payload utilizable: se ignora, la alerta ya quedó
        // reflejada en la lista vía la invalidación de la query.
      }
    });
    source.onerror = () => {
      // El navegador reintenta automáticamente la conexión SSE.
    };
    return () => source.close();
  }, [user, queryClient]);

  function requestPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    void Notification.requestPermission().then(setPermission);
  }

  return (
    <NotificationsContext.Provider
      value={{ permission, requestPermission, liveAlertCount, clearLiveAlertCount: () => setLiveAlertCount(0) }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications debe usarse dentro de NotificationsProvider");
  return ctx;
}

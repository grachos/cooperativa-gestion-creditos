import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/**
 * Atrapa errores de renderizado: sin esto, un fallo en cualquier componente
 * deja la pantalla en blanco. Muestra el motivo (legible desde el celular) y
 * permite recargar.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Error de renderizado", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto mt-[12vh] max-w-md p-6">
        <h1 className="mb-2 text-xl font-semibold text-slate-800">Algo salió mal</h1>
        <p className="mb-4 text-sm text-slate-600">
          La pantalla tuvo un error inesperado. Recargue la aplicación; si el problema sigue, envíe una captura de este mensaje.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="w-full rounded-md bg-brand-600 px-4 py-3 text-sm font-medium text-white hover:bg-brand-700"
        >
          Recargar la aplicación
        </button>
        <pre className="mt-4 whitespace-pre-wrap break-words rounded-md bg-slate-100 p-3 text-xs text-slate-600">
          {this.state.error.message}
        </pre>
      </div>
    );
  }
}

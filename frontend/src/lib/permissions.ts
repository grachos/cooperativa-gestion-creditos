/** Nombres legibles de los permisos para la pantalla de casillas de Usuarios. */
export const PERMISSION_LABELS: Record<string, string> = {
  "associates:write": "Crear y editar asociados",
  "applications:write": "Radicar y cancelar solicitudes de crédito",
  "applications:review": "Revisar solicitudes (iniciar revisión, documentos, participantes, referencias)",
  "applications:approve": "Aprobar o rechazar solicitudes",
  "disbursements:write": "Desembolsar créditos y refinanciar",
  "payments:write": "Registrar, verificar y reversar pagos",
  "adjustments:write": "Registrar ajustes, descuentos y gastos de un crédito",
  "collections:write": "Registrar compromisos de pago y gestión de cobro",
  "alerts:write": "Atender alertas y recalcularlas",
  "reports:read": "Ver reportes y tablero",
  "audit:read": "Ver la actividad por usuario (auditoría)",
  "parameters:write": "Editar parámetros del sistema",
  "integration:write": "Integración contable",
  "users:write": "Administrar usuarios y permisos"
};

export function permissionLabel(code: string, description?: string | null): string {
  return PERMISSION_LABELS[code] ?? description ?? code;
}

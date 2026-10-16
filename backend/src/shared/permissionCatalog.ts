/**
 * Catálogo de permisos agrupado por módulo, para la pantalla de casillas de Usuarios (módulo × acción).
 * El código de cada permiso es el que verifican las rutas (`requirePermission`). Si se agrega uno, también
 * va en seed_base.sql (para que exista y se asigne a los roles) y en seed.ts.
 */
export interface PermissionAction {
  code: string;
  label: string;
}

export interface PermissionModule {
  module: string;
  label: string;
  actions: PermissionAction[];
}

export const PERMISSION_CATALOG: PermissionModule[] = [
  {
    module: "associates",
    label: "Asociados y sociedades",
    actions: [
      { code: "associates:read", label: "Ver asociados y sociedades" },
      { code: "associates:create", label: "Crear asociados y sociedades" },
      { code: "associates:update", label: "Editar datos y cambiar el estado" },
      { code: "associates:documents", label: "Marcar los documentos que tiene la cooperativa" }
    ]
  },
  {
    module: "applications",
    label: "Solicitudes de crédito",
    actions: [
      { code: "applications:read", label: "Ver solicitudes" },
      { code: "applications:write", label: "Radicar solicitudes" },
      { code: "applications:cancel", label: "Cancelar solicitudes" },
      { code: "applications:review", label: "Revisar: poner en revisión, documentos, participantes y referencias" },
      { code: "applications:approve", label: "Aprobar o rechazar solicitudes" }
    ]
  },
  {
    module: "credits",
    label: "Créditos",
    actions: [
      { code: "credits:read", label: "Ver créditos" },
      { code: "disbursements:write", label: "Desembolsar" },
      { code: "credits:refinance", label: "Refinanciar" }
    ]
  },
  {
    module: "payments",
    label: "Pagos",
    actions: [
      { code: "payments:write", label: "Registrar pagos" },
      { code: "payments:verify", label: "Marcar pagos como verificados en el banco" },
      { code: "payments:reverse", label: "Reversar pagos" },
      { code: "payments:payoff", label: "Cancelar el crédito por pago anticipado" }
    ]
  },
  {
    module: "adjustments",
    label: "Mora, descuentos y ajustes",
    actions: [{ code: "adjustments:write", label: "Cobrar o no la mora y los gastos, dar descuentos y registrar ajustes" }]
  },
  {
    module: "collections",
    label: "Cobranza y cobro jurídico",
    actions: [{ code: "collections:write", label: "Registrar compromisos, gestiones y documentos jurídicos" }]
  },
  {
    module: "alerts",
    label: "Alertas",
    actions: [
      { code: "alerts:read", label: "Ver alertas" },
      { code: "alerts:write", label: "Atender y recalcular alertas" }
    ]
  },
  {
    module: "reports",
    label: "Reportes",
    actions: [
      { code: "reports:read", label: "Ver tablero y reportes" },
      { code: "reports:export", label: "Exportar a CSV" }
    ]
  },
  {
    module: "audit",
    label: "Actividad por usuario",
    actions: [{ code: "audit:read", label: "Ver la actividad de los usuarios (quién hizo qué)" }]
  },
  {
    module: "parameters",
    label: "Parámetros",
    actions: [{ code: "parameters:write", label: "Editar parámetros del sistema" }]
  },
  {
    module: "users",
    label: "Usuarios",
    actions: [{ code: "users:write", label: "Administrar usuarios y permisos" }]
  },
  {
    module: "integration",
    label: "Integración contable",
    actions: [{ code: "integration:write", label: "Gestionar la integración contable" }]
  }
];

export const CATALOG_CODES = PERMISSION_CATALOG.flatMap((m) => m.actions.map((a) => a.code));

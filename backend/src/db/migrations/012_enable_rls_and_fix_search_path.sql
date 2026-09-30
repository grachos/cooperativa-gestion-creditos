-- Supabase Security Advisor: las 25 tablas de public quedaban expuestas al
-- API REST automático de PostgREST (roles anon/authenticated) sin Row Level
-- Security. El backend se conecta con el rol `postgres`, que tiene
-- BYPASSRLS, así que esto no afecta a la aplicación — solo cierra el
-- acceso público vía el API REST que la app no usa.
ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."login_activity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."associates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."societies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."credit_participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."credit_applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."credit_application_status_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."credits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."credit_schedule_installments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."payment_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."delinquency_calculations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."collection_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."parameters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."integration_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."integration_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."credit_adjustments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."schema_migrations" ENABLE ROW LEVEL SECURITY;

-- Supabase Security Advisor: función con search_path mutable (riesgo de
-- secuestro de esquema si alguien crea un objeto malicioso en un esquema
-- anterior en el search_path de la sesión que la invoque).
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

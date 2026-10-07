import "dotenv/config";
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().default(4000),
    // Producción/Supabase: una sola cadena de conexión Postgres.
    DATABASE_URL: z.string().min(1).optional(),
    // Por defecto SIN SSL (Postgres local / docker-compose no trae
    // certificados configurados). Se activa explícitamente con
    // DATABASE_SSL=true, como en producción/Supabase.
    DATABASE_SSL: z
      .string()
      .optional()
      .transform((v) => v === "true"),
    // Desarrollo local sin Supabase: Postgres por variables sueltas.
    DB_HOST: z.string().default("localhost"),
    DB_PORT: z.coerce.number().default(5432),
    DB_USER: z.string().default("postgres"),
    DB_PASSWORD: z.string().default(""),
    DB_NAME: z.string().default("cooperativa_creditos"),
    JWT_ACCESS_SECRET: z.string().min(10),
    JWT_REFRESH_SECRET: z.string().min(10),
    JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
    JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
    CORS_ORIGIN: z.string().default("http://localhost:5173"),
    TIMEZONE: z.string().default("America/Bogota"),
    CURRENCY: z.string().default("COP"),
    // URL pública del frontend, usada para armar el enlace de restablecer
    // contraseña dentro del correo. Sin SMTP configurado, el enlace se
    // registra en consola en vez de enviarse (ver mailer.ts).
    APP_URL: z.string().default("http://localhost:5173"),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().default(587),
    SMTP_SECURE: z
      .string()
      .optional()
      .transform((v) => v === "true"),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().default("Coomulnissi <no-reply@coomulnissi.demo>"),
    // Vercel Cron lo envía como "Authorization: Bearer <CRON_SECRET>" al
    // invocar el job diario de mora/alertas. Sin definirlo, el job queda
    // deshabilitado (responde 401).
    CRON_SECRET: z.string().min(16).optional()
  })
  .refine((v) => v.DATABASE_URL || (v.DB_HOST && v.DB_NAME), {
    message: "Debe definirse DATABASE_URL o DB_HOST/DB_NAME"
  });

export const env = envSchema.parse(process.env);

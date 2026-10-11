import "dotenv/config";
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().default(4000),
    // Por defecto SIN SSL (MySQL local / Hostinger se conecta por 127.0.0.1).
    // Se activa explícitamente con DATABASE_SSL=true.
    DATABASE_SSL: z
      .string()
      .optional()
      .transform((v) => v === "true"),
    // MySQL/MariaDB. En Hostinger: DB_HOST=127.0.0.1, DB_PORT=3306.
    DB_HOST: z.string().default("127.0.0.1"),
    DB_PORT: z.coerce.number().default(3306),
    DB_USER: z.string().default("root"),
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
    // Carpeta del frontend compilado (frontend/dist). Si existe, el mismo
    // proceso Node lo sirve junto con la API (despliegue en Hostinger).
    STATIC_DIR: z.string().optional(),
    // Ejecuta el job diario de mora/alertas dentro del proceso (a las 06:00
    // hora Colombia), en vez de depender de Vercel Cron.
    INTERNAL_CRON: z
      .string()
      .optional()
      .transform((v) => v === "true"),
    // Al arrancar, aplica migraciones + datos base (idempotente).
    AUTO_MIGRATE: z
      .string()
      .optional()
      .transform((v) => v === "true"),
    ADMIN_EMAIL: z.string().optional(),
    ADMIN_PASSWORD_HASH: z.string().optional(),
    // Idempotency-Key (ver middlewares/idempotency.ts). El proyecto no tenía
    // una convención para esto: el valor por defecto (24 h) cubre sobradamente
    // reintentos de red, recargas y un "volver a enviar" el mismo día. Para
    // cambiarlo, defina IDEMPOTENCY_TTL_HOURS (admite decimales). IDEMPOTENCY_WAIT_MS
    // es cuánto espera una petición duplicada a que termine la original antes
    // de recibir 409 IDEMPOTENCY_IN_PROGRESS.
    IDEMPOTENCY_TTL_HOURS: z.coerce.number().positive().max(24 * 30).default(24),
    IDEMPOTENCY_WAIT_MS: z.coerce.number().int().min(0).max(60000).default(8000),
    CRON_SECRET: z.string().min(16).optional()
  })
  ;

export const env = envSchema.parse(process.env);

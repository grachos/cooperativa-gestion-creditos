import "dotenv/config";
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().default(4000),
    // Producción/Supabase: una sola cadena de conexión Postgres.
    DATABASE_URL: z.string().min(1).optional(),
    DATABASE_SSL: z
      .string()
      .optional()
      .transform((v) => v !== "false"),
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
    CURRENCY: z.string().default("COP")
  })
  .refine((v) => v.DATABASE_URL || (v.DB_HOST && v.DB_NAME), {
    message: "Debe definirse DATABASE_URL o DB_HOST/DB_NAME"
  });

export const env = envSchema.parse(process.env);

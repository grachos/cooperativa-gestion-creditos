// Punto de entrada del backend como función serverless de Vercel.
// Un rewrite en vercel.json envía todo /api/:path* a esta función (el
// catch-all por nombre de archivo [...path].ts no queda registrado como
// ruta en un proyecto sin framework); la app Express interna ya enruta
// por la URL completa, incluido el prefijo /api/v1.
//
// Requiere que las variables de entorno del backend (DATABASE_URL,
// JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, etc. — ver backend/.env.example)
// estén configuradas en el proyecto de Vercel (Settings → Environment
// Variables), porque se leen al arrancar el módulo (cold start).
import { app } from "../backend/src/app.js";

export default app;

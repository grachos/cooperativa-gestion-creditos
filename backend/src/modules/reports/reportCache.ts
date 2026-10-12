import { env } from "../../config/env.js";
import { ResponseCache } from "../../utils/responseCache.js";

/**
 * Caché de los reportes pesados. Solo para respuestas IDÉNTICAS para todo usuario con el
 * permiso reports:read (agregados de cartera, sin datos por usuario). Ver utils/responseCache.ts.
 * Las escrituras que cambian estos datos llaman a `invalidateReportCache()`.
 */
export const reportCache = new ResponseCache(env.REPORT_CACHE_TTL_SECONDS * 1000);
export const invalidateReportCache = () => reportCache.clear();

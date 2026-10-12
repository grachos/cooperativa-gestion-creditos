import crypto from "node:crypto";
import { SseHub, type RealtimeEvent } from "./sse.hub.core.js";
import { MysqlRealtimeStore } from "./sse.hub.mysql.js";

/** Identificador de este proceso (también lo muestra /health para contar procesos). */
export const instanceId = crypto.randomUUID().slice(0, 8);

const store = new MysqlRealtimeStore();
export const sseHub = new SseHub({ instanceId, store });

export const registerSseClient = sseHub.register.bind(sseHub);
export const broadcastEvent = sseHub.broadcast.bind(sseHub);
export const broadcastEvents = (events: RealtimeEvent[]) => sseHub.broadcastMany(events);
export const canAcceptSseClient = sseHub.canAccept.bind(sseHub);

/** Borra del buzón los eventos de más de 10 minutos (los clientes los consultan cada pocos segundos). */
export const purgeRealtimeEvents = () => store.purgeOlderThan(10);

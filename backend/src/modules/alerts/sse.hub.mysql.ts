import { pool } from "../../db/pool.js";
import type { RealtimeEvent, RealtimeStore, StoredRealtimeEvent } from "./sse.hub.core.js";

/** Buzón de eventos en MySQL (tabla realtime_events; ver migración 021). */
export class MysqlRealtimeStore implements RealtimeStore {
  async publish(origin: string, events: RealtimeEvent[]) {
    if (events.length === 0) return;
    await pool.query(`INSERT INTO realtime_events (origin, event, payload) VALUES ?`, [
      events.map((e) => [origin, e.event, JSON.stringify(e.data)])
    ]);
  }

  async fetchSince(lastId: number, limit: number): Promise<StoredRealtimeEvent[]> {
    const [rows] = await pool.query<any[]>(
      `SELECT id, origin, event, payload FROM realtime_events WHERE id > ? ORDER BY id ASC LIMIT ?`,
      [lastId, limit]
    );
    return (rows as any[]).map((r) => ({ id: Number(r.id), origin: r.origin, event: r.event, payload: r.payload }));
  }

  async latestId() {
    const [rows] = await pool.query<any[]>(`SELECT COALESCE(MAX(id), 0) AS id FROM realtime_events`);
    return Number((rows as any[])[0].id);
  }

  async purgeOlderThan(minutes: number) {
    const [result] = await pool.query<any>(`DELETE FROM realtime_events WHERE created_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`, [minutes]);
    return Number(result.affectedRows ?? 0);
  }
}

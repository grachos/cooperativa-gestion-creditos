import type { Response } from "express";

interface Client {
  userId: number;
  res: Response;
}

const clients: Client[] = [];

export function registerSseClient(userId: number, res: Response) {
  clients.push({ userId, res });
  res.on("close", () => {
    const idx = clients.findIndex((c) => c.res === res);
    if (idx >= 0) clients.splice(idx, 1);
  });
}

export function broadcastEvent(eventName: string, data: unknown) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.res.write(payload);
  }
}

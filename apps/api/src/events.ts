import pg from "pg";
import type { ChangedTopic } from "@office/contracts";

export const EVENT_CHANNEL = "office_events";

interface EventSocket {
  readyState: number;
  send(data: string): void;
  on(event: "close", handler: () => void): void;
}

// Fans "changed" events out to the websocket clients connected to this process.
export function createEventHub() {
  const sockets = new Set<EventSocket>();
  return {
    add(socket: EventSocket) {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    },
    deliver(topics: ChangedTopic[]) {
      const message = JSON.stringify({ type: "changed", topics });
      for (const socket of sockets) if (socket.readyState === 1) socket.send(message);
    }
  };
}

// A dedicated LISTEN connection so events published by the worker (or another API
// instance) via pg_notify reach this process. Reconnects until closed. Payloads may
// carry an "<origin>|" prefix; those matching ownOrigin were already delivered
// locally by publish() and are dropped to avoid duplicates.
export function listenForEvents(connectionString: string, ownOrigin: string, deliver: (topics: ChangedTopic[]) => void) {
  let closed = false;
  let client: pg.Client | undefined;
  let retry: NodeJS.Timeout | undefined;
  const connect = () => {
    if (closed) return;
    let scheduled = false;
    const scheduleRetry = () => {
      if (closed || scheduled) return;
      scheduled = true;
      retry = setTimeout(connect, 1000);
    };
    client = new pg.Client({ connectionString, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined });
    client.on("notification", (message) => {
      if (!message.payload) return;
      const separator = message.payload.indexOf("|");
      const origin = separator === -1 ? "" : message.payload.slice(0, separator);
      if (origin === ownOrigin) return;
      deliver(message.payload.slice(separator + 1).split(",") as ChangedTopic[]);
    });
    client.on("error", () => { /* the end event schedules the reconnect */ });
    client.on("end", scheduleRetry);
    client.connect().then(() => client?.query(`LISTEN ${EVENT_CHANNEL}`)).catch(scheduleRetry);
  };
  connect();
  return async () => {
    closed = true;
    clearTimeout(retry);
    await client?.end().catch(() => undefined);
  };
}

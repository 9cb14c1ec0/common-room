import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { z } from "zod";
import type { MeetingRequest, MeetingSummary, Person } from "@office/contracts";
import { createSession, currentUser, destroySession, hashPassword, verifyPassword } from "./auth.js";
import { createDatabase, migrate } from "./database.js";

const people: Person[] = [
  { id: "maya", name: "Maya Chen", initials: "MC", title: "Product", presence: "available" },
  { id: "jon", name: "Jon Bell", initials: "JB", title: "Engineering", presence: "busy" },
  { id: "priya", name: "Priya Shah", initials: "PS", title: "Design", presence: "available" },
  { id: "theo", name: "Theo Martin", initials: "TM", title: "Operations", presence: "offline" }
];

const meetings: MeetingSummary[] = [{
  id: "weekly-product",
  title: "Weekly product sync",
  occurredAt: new Date(Date.now() - 86_400_000).toISOString(),
  durationMinutes: 34,
  participants: people.slice(0, 3),
  summary: "The team aligned on the onboarding release and resolved the remaining copy review.",
  actionItemCount: 3
}];

const requests: MeetingRequest[] = [];

export async function buildApp() {
  const app = Fastify({ logger: true });
  const database = createDatabase();
  if (database) {
    await migrate(database);
    const count = await database.query("SELECT count(*)::int AS count FROM users");
    if (count.rows[0].count === 0 && process.env.BOOTSTRAP_ADMIN_EMAIL && process.env.BOOTSTRAP_ADMIN_PASSWORD) {
      await database.query("INSERT INTO users(email,password_hash,display_name,title,presence,is_admin) VALUES($1,$2,$3,'Administrator','available',true)", [process.env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase(), await hashPassword(process.env.BOOTSTRAP_ADMIN_PASSWORD), process.env.BOOTSTRAP_ADMIN_NAME ?? "Administrator"]);
    }
  }
  await app.register(cookie);
  await app.register(helmet);
  await app.register(cors, { origin: (process.env.WEB_ORIGIN ?? "http://localhost:5173").replace(/\/$/, ""), credentials: true });
  await app.register(websocket);

  app.addHook("onClose", async () => { await database?.end(); });
  app.get("/health", async () => ({ ok: true, service: "office-api", database: database ? "connected" : "demo" }));

  app.get("/api/auth/status", async (request) => {
    if (!database) return { mode: "demo", user: { id: "maya", email: "maya@example.test", displayName: "Maya Chen", title: "Product", isAdmin: true } };
    const user = await currentUser(database, request);
    const result = await database.query("SELECT count(*)::int AS count FROM users");
    return { mode: "database", requiresSetup: result.rows[0].count === 0, user: user ?? null };
  });

  app.post("/api/auth/setup", async (request, reply) => {
    if (!database) return reply.code(400).send({ error: "Database is not configured" });
    const input = z.object({ email: z.string().email(), password: z.string().min(10), displayName: z.string().min(2).max(80) }).parse(request.body);
    const count = await database.query("SELECT count(*)::int AS count FROM users");
    if (count.rows[0].count !== 0) return reply.code(409).send({ error: "Setup is already complete" });
    const result = await database.query("INSERT INTO users(email,password_hash,display_name,title,presence,is_admin) VALUES($1,$2,$3,'Administrator','available',true) RETURNING id", [input.email.toLowerCase(), await hashPassword(input.password), input.displayName]);
    await createSession(database, result.rows[0].id, reply);
    return reply.code(201).send({ ok: true });
  });

  app.post("/api/auth/login", async (request, reply) => {
    if (!database) return reply.code(400).send({ error: "Database is not configured" });
    const input = z.object({ email: z.string().email(), password: z.string() }).parse(request.body);
    const result = await database.query("SELECT id,password_hash FROM users WHERE email=$1", [input.email.toLowerCase()]);
    const row = result.rows[0];
    if (!row || !await verifyPassword(input.password, row.password_hash)) return reply.code(401).send({ error: "Invalid email or password" });
    await createSession(database, row.id, reply);
    return { ok: true };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    if (database) await destroySession(database, request, reply);
    return { ok: true };
  });

  app.get("/api/people", async (request, reply) => {
    if (!database) return { people };
    if (!await currentUser(database, request)) return reply.code(401).send({ error: "Authentication required" });
    const result = await database.query("SELECT id,display_name,title,presence FROM users ORDER BY display_name");
    return { people: result.rows.map((row) => ({ id: row.id, name: row.display_name, initials: row.display_name.split(/\\s+/).map((part: string) => part[0]).slice(0,2).join("").toUpperCase(), title: row.title, presence: row.presence })) };
  });
  app.get("/api/meetings", async (request, reply) => {
    if (!database) return { meetings };
    if (!await currentUser(database, request)) return reply.code(401).send({ error: "Authentication required" });
    const result = await database.query("SELECT id, coalesce(summary, 'Processing is not complete.') summary, started_at, ended_at FROM meetings ORDER BY created_at DESC LIMIT 30");
    return { meetings: result.rows.map((row) => ({ id: row.id, title: "Common Room meeting", occurredAt: row.started_at, durationMinutes: row.started_at && row.ended_at ? Math.round((new Date(row.ended_at).getTime() - new Date(row.started_at).getTime()) / 60000) : 0, participants: [], summary: row.summary, actionItemCount: 0 })) };
  });
  app.get("/api/requests", async (request, reply) => {
    if (!database) return { requests };
    const user = await currentUser(database, request);
    if (!user) return reply.code(401).send({ error: "Authentication required" });
    const result = await database.query("SELECT id,sender_id,recipient_id,message,status,created_at FROM meeting_requests WHERE sender_id=$1 OR recipient_id=$1 ORDER BY created_at DESC", [user.id]);
    return { requests: result.rows };
  });

  app.post("/api/requests", async (request, reply) => {
    const input = z.object({ fromId: z.string(), toId: z.string(), message: z.string().max(280).optional() }).parse(request.body);
    if (database) {
      const user = await currentUser(database, request);
      if (!user) return reply.code(401).send({ error: "Authentication required" });
      const result = await database.query("INSERT INTO meeting_requests(sender_id,recipient_id,message) VALUES($1,$2,$3) RETURNING id,status,created_at", [user.id, input.toId, input.message ?? null]);
      return reply.code(201).send({ request: { ...result.rows[0], from: user, toId: input.toId } });
    }
    const from = people.find((person) => person.id === input.fromId);
    const to = people.find((person) => person.id === input.toId);
    if (!from || !to) return reply.code(404).send({ error: "Person not found" });
    const meetingRequest: MeetingRequest = {
      id: crypto.randomUUID(), from, to, message: input.message,
      createdAt: new Date().toISOString(), status: "pending"
    };
    requests.push(meetingRequest);
    return reply.code(201).send({ request: meetingRequest });
  });

  app.post<{ Params: { meetingId: string } }>("/api/meetings/:meetingId/token", async (request, reply) => {
    const input = z.object({ displayName: z.string().min(1).max(80).optional() }).parse(request.body ?? {});
    const spaceUrl = process.env.SIGNALWIRE_SPACE_URL?.replace(/\/$/, "");
    if (!spaceUrl || !process.env.SIGNALWIRE_PROJECT_ID || !process.env.SIGNALWIRE_API_TOKEN) {
      return reply.code(503).send({ error: "SignalWire is not configured", code: "INTEGRATION_NOT_CONFIGURED" });
    }
    const authenticated = database ? await currentUser(database, request) : undefined;
    const roomName = `common-room-${request.params.meetingId}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
    const credentials = Buffer.from(`${process.env.SIGNALWIRE_PROJECT_ID}:${process.env.SIGNALWIRE_API_TOKEN}`).toString("base64");
    const signalWireResponse = await fetch(`${spaceUrl}/api/video/room_tokens`, {
      method: "POST",
      headers: { authorization: `Basic ${credentials}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ room_name: roomName, user_name: authenticated?.displayName ?? input.displayName ?? "Guest" })
    });
    const payload = await signalWireResponse.json() as { token?: string; message?: string; errors?: unknown };
    if (!signalWireResponse.ok || !payload.token) {
      request.log.error({ status: signalWireResponse.status, payload }, "SignalWire room token request failed");
      return reply.code(502).send({ error: "Unable to create a SignalWire room token", code: "SIGNALWIRE_TOKEN_FAILED" });
    }
    return { token: payload.token, roomName };
  });

  app.get("/api/presence", { websocket: true }, (socket) => {
    socket.send(JSON.stringify({ type: "presence.snapshot", people }));
  });

  return app;
}

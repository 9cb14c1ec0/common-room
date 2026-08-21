import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
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
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

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
    await database.query("UPDATE users SET presence='available' WHERE id=$1", [row.id]);
    await createSession(database, row.id, reply);
    return { ok: true };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    if (database) {
      const user = await currentUser(database, request);
      if (user) await database.query("UPDATE users SET presence='offline' WHERE id=$1", [user.id]);
      await destroySession(database, request, reply);
    }
    return { ok: true };
  });

  app.get("/api/people", async (request, reply) => {
    if (!database) return { people };
    if (!await currentUser(database, request)) return reply.code(401).send({ error: "Authentication required" });
    const result = await database.query("SELECT id,display_name,title,presence FROM users ORDER BY display_name");
    return { people: result.rows.map((row) => ({ id: row.id, name: row.display_name, initials: row.display_name.split(/\\s+/).map((part: string) => part[0]).slice(0,2).join("").toUpperCase(), title: row.title, presence: row.presence })) };
  });
  app.post("/api/users", async (request, reply) => {
    if (!database) return reply.code(400).send({ error: "Database is not configured" });
    const user = await currentUser(database, request);
    if (!user?.isAdmin) return reply.code(403).send({ error: "Administrator access required" });
    const input = z.object({ email: z.string().email(), displayName: z.string().min(2).max(80), title: z.string().max(80).default(""), temporaryPassword: z.string().min(10) }).parse(request.body);
    try {
      const result = await database.query("INSERT INTO users(email,password_hash,display_name,title,presence,is_admin) VALUES($1,$2,$3,$4,'offline',false) RETURNING id", [input.email.toLowerCase(), await hashPassword(input.temporaryPassword), input.displayName, input.title]);
      return reply.code(201).send({ id: result.rows[0].id });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "An account with that email already exists" });
      throw error;
    }
  });
  app.post("/api/invitations", async (request, reply) => {
    if (!database) return reply.code(400).send({ error: "Database is not configured" });
    const user = await currentUser(database, request);
    if (!user?.isAdmin) return reply.code(403).send({ error: "Administrator access required" });
    const input = z.object({ email: z.string().email(), title: z.string().max(80).default("") }).parse(request.body);
    const existing = await database.query("SELECT 1 FROM users WHERE email=$1", [input.email.toLowerCase()]);
    if (existing.rowCount) return reply.code(409).send({ error: "An account with that email already exists" });
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    await database.query("UPDATE invitations SET accepted_at=now() WHERE email=$1 AND accepted_at IS NULL", [input.email.toLowerCase()]);
    await database.query("INSERT INTO invitations(email,title,token_hash,created_by,expires_at) VALUES($1,$2,$3,$4,$5)", [input.email.toLowerCase(), input.title, tokenHash(token), user.id, expiresAt]);
    const webOrigin = (process.env.WEB_ORIGIN ?? "http://localhost:5173").replace(/\/$/, "");
    return reply.code(201).send({ inviteUrl: `${webOrigin}/?invite=${encodeURIComponent(token)}`, expiresAt });
  });

  app.get<{ Params: { token: string } }>("/api/invitations/:token", async (request, reply) => {
    if (!database) return reply.code(404).send({ error: "Invitation not found" });
    const result = await database.query("SELECT email,title,expires_at FROM invitations WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at > now()", [tokenHash(request.params.token)]);
    const invitation = result.rows[0];
    if (!invitation) return reply.code(404).send({ error: "This invitation is invalid or has expired" });
    return { email: invitation.email, title: invitation.title, expiresAt: invitation.expires_at };
  });

  app.post<{ Params: { token: string } }>("/api/invitations/:token/accept", async (request, reply) => {
    if (!database) return reply.code(404).send({ error: "Invitation not found" });
    const input = z.object({ displayName: z.string().min(2).max(80), password: z.string().min(10) }).parse(request.body);
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT id,email,title FROM invitations WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at > now() FOR UPDATE", [tokenHash(request.params.token)]);
      const invitation = result.rows[0];
      if (!invitation) { await client.query("ROLLBACK"); return reply.code(404).send({ error: "This invitation is invalid or has expired" }); }
      const created = await client.query("INSERT INTO users(email,password_hash,display_name,title,presence,is_admin) VALUES($1,$2,$3,$4,'available',false) RETURNING id", [invitation.email, await hashPassword(input.password), input.displayName, invitation.title]);
      await client.query("UPDATE invitations SET accepted_at=now() WHERE id=$1", [invitation.id]);
      await client.query("COMMIT");
      await createSession(database, created.rows[0].id, reply);
      return reply.code(201).send({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") return reply.code(409).send({ error: "An account with this email already exists" });
      throw error;
    } finally { client.release(); }
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
    const result = await database.query(`SELECT r.id,r.sender_id,r.recipient_id,r.message,r.status,r.created_at,
      sender.display_name sender_name, recipient.display_name recipient_name
      FROM meeting_requests r JOIN users sender ON sender.id=r.sender_id JOIN users recipient ON recipient.id=r.recipient_id
      WHERE r.sender_id=$1 OR r.recipient_id=$1 ORDER BY r.created_at DESC`, [user.id]);
    return { requests: result.rows.map((row) => ({ id: row.id, senderId: row.sender_id, recipientId: row.recipient_id, senderName: row.sender_name, recipientName: row.recipient_name, message: row.message, status: row.status, createdAt: row.created_at, direction: row.sender_id === user.id ? "outgoing" : "incoming" })) };
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

  app.patch<{ Params: { requestId: string } }>("/api/requests/:requestId", async (request, reply) => {
    if (!database) return reply.code(400).send({ error: "Database is not configured" });
    const user = await currentUser(database, request);
    if (!user) return reply.code(401).send({ error: "Authentication required" });
    const input = z.object({ status: z.enum(["accepted", "declined", "cancelled"]) }).parse(request.body);
    const existing = await database.query("SELECT sender_id,recipient_id,status FROM meeting_requests WHERE id=$1", [request.params.requestId]);
    const row = existing.rows[0];
    if (!row || row.status !== "pending") return reply.code(404).send({ error: "Pending request not found" });
    const allowed = input.status === "cancelled" ? row.sender_id === user.id : row.recipient_id === user.id;
    if (!allowed) return reply.code(403).send({ error: "You cannot respond to this request" });
    await database.query("UPDATE meeting_requests SET status=$1,responded_at=now() WHERE id=$2", [input.status, request.params.requestId]);
    if (input.status !== "accepted") return { status: input.status };
    const roomName = `meeting-${request.params.requestId}`;
    const meeting = await database.query("INSERT INTO meetings(signalwire_room_name,status,started_at) VALUES($1,'waiting',now()) RETURNING id", [roomName]);
    await database.query("INSERT INTO meeting_participants(meeting_id,user_id) VALUES($1,$2),($1,$3)", [meeting.rows[0].id, row.sender_id, row.recipient_id]);
    return { status: input.status, meetingId: meeting.rows[0].id };
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

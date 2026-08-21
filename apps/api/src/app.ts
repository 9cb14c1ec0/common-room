import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { z } from "zod";
import type { MeetingRequest, MeetingSummary, Person } from "@office/contracts";

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
  await app.register(helmet);
  await app.register(cors, { origin: process.env.WEB_ORIGIN ?? "http://localhost:5173", credentials: true });
  await app.register(websocket);

  app.get("/health", async () => ({ ok: true, service: "office-api" }));
  app.get("/api/people", async () => ({ people }));
  app.get("/api/meetings", async () => ({ meetings }));
  app.get("/api/requests", async () => ({ requests }));

  app.post("/api/requests", async (request, reply) => {
    const input = z.object({ fromId: z.string(), toId: z.string(), message: z.string().max(280).optional() }).parse(request.body);
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

  app.post("/api/meetings/:meetingId/token", async (_request, reply) => {
    if (!process.env.SIGNALWIRE_PROJECT_ID || !process.env.SIGNALWIRE_API_TOKEN) {
      return reply.code(503).send({ error: "SignalWire is not configured", code: "INTEGRATION_NOT_CONFIGURED" });
    }
    return reply.code(501).send({ error: "SignalWire token adapter is the next implementation slice" });
  });

  app.get("/api/presence", { websocket: true }, (socket) => {
    socket.send(JSON.stringify({ type: "presence.snapshot", people }));
  });

  return app;
}

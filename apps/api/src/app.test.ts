import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "./app.js";

test("health endpoint reports ready", async () => {
  const app = await buildApp();
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true, service: "office-api", database: "demo" });
  await app.close();
});

test("CORS preflight permits presence and request mutations", async () => {
  const app = await buildApp();
  const response = await app.inject({ method: "OPTIONS", url: "/api/presence", headers: { origin: "http://localhost:5173", "access-control-request-method": "PATCH" } });
  assert.equal(response.statusCode, 204);
  assert.match(response.headers["access-control-allow-methods"] ?? "", /PATCH/);
  assert.match(response.headers["access-control-allow-methods"] ?? "", /DELETE/);
  await app.close();
});

test("door and meeting presence changes are reflected in the directory", async () => {
  const app = await buildApp();
  const update = await app.inject({ method: "PATCH", url: "/api/presence", payload: { status: "busy" } });
  assert.equal(update.statusCode, 200);
  const directory = await app.inject({ method: "GET", url: "/api/people" });
  assert.equal(directory.json().people.find((person: { id: string }) => person.id === "maya").presence, "busy");
  await app.inject({ method: "PATCH", url: "/api/presence", payload: { doorOpen: true } });
  await app.close();
});

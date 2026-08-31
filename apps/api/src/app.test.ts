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

test("demo mode includes representative meeting and action-item data", async () => {
  const app = await buildApp();
  const [meetings, actionItems] = await Promise.all([
    app.inject({ method: "GET", url: "/api/meetings" }),
    app.inject({ method: "GET", url: "/api/action-items/mine" })
  ]);
  assert.equal(meetings.json().meetings[0].actionItemCount, 1);
  assert.equal(actionItems.json().actionItems[0].meetingTitle, "Weekly product sync");
  await app.close();
});

test("an administrator can delete a meeting note", async () => {
  const app = await buildApp();
  const deletion = await app.inject({ method: "DELETE", url: "/api/meetings/weekly-product" });
  assert.equal(deletion.statusCode, 204);

  const notes = await app.inject({ method: "GET", url: "/api/meetings" });
  assert.equal(notes.statusCode, 200);
  assert.equal(notes.json().meetings.some((meeting: { id: string }) => meeting.id === "weekly-product"), false);

  const missing = await app.inject({ method: "DELETE", url: "/api/meetings/weekly-product" });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: "Meeting note not found" });
  await app.close();
});

test("key term settings are unavailable without a database", async () => {
  const app = await buildApp();
  const read = await app.inject({ method: "GET", url: "/api/settings/key-terms" });
  assert.equal(read.statusCode, 400);
  assert.deepEqual(read.json(), { error: "Database is not configured" });

  const write = await app.inject({ method: "PUT", url: "/api/settings/key-terms", payload: { terms: ["Kestrel"] } });
  assert.equal(write.statusCode, 400);
  assert.deepEqual(write.json(), { error: "Database is not configured" });
  await app.close();
});

test("CORS preflight permits the key term settings write", async () => {
  const app = await buildApp();
  const response = await app.inject({ method: "OPTIONS", url: "/api/settings/key-terms", headers: { origin: "http://localhost:5173", "access-control-request-method": "PUT" } });
  assert.equal(response.statusCode, 204);
  assert.match(response.headers["access-control-allow-methods"] ?? "", /PUT/);
  await app.close();
});

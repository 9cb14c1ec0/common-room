import assert from "node:assert/strict";
import test from "node:test";
import { defaultSchemeForHost, isSameOrigin, normalizeWorkspaceUrl, parseWorkspaceState, probeWorkspace, rememberRecent } from "./workspace.js";

test("normalizeWorkspaceUrl adds https and strips trailing slashes", () => {
  const result = normalizeWorkspaceUrl(" common-room.example.com/app/ ");
  assert.deepEqual(result, { ok: true, url: "https://common-room.example.com/app" });
});

test("normalizeWorkspaceUrl uses http for localhost and private hosts", () => {
  assert.deepEqual(normalizeWorkspaceUrl("localhost:5173"), { ok: true, url: "http://localhost:5173" });
  assert.deepEqual(normalizeWorkspaceUrl("127.0.0.1:5173"), { ok: true, url: "http://127.0.0.1:5173" });
  assert.deepEqual(normalizeWorkspaceUrl("192.168.1.20:5173"), { ok: true, url: "http://192.168.1.20:5173" });
  assert.equal(defaultSchemeForHost("10.0.0.8"), "http");
  assert.equal(defaultSchemeForHost("office.example.com"), "https");
});

test("normalizeWorkspaceUrl keeps an explicit scheme", () => {
  assert.deepEqual(normalizeWorkspaceUrl("http://office.example.com"), { ok: true, url: "http://office.example.com" });
});

test("normalizeWorkspaceUrl rejects empty, non-http, and credentialed URLs", () => {
  assert.equal(normalizeWorkspaceUrl("").ok, false);
  assert.equal(normalizeWorkspaceUrl("   ").ok, false);
  assert.equal(normalizeWorkspaceUrl("file:///etc/passwd").ok, false);
  assert.equal(normalizeWorkspaceUrl("javascript:alert(1)").ok, false);
  assert.equal(normalizeWorkspaceUrl("https://user:pass@office.example.com").ok, false);
});

test("rememberRecent puts the latest URL first and de-duplicates", () => {
  assert.deepEqual(rememberRecent("https://b.example", ["https://a.example", "https://b.example", "https://c.example"], 5), [
    "https://b.example",
    "https://a.example",
    "https://c.example"
  ]);
  assert.deepEqual(rememberRecent("https://new.example", ["1", "2", "3", "4", "5"], 5), ["https://new.example", "1", "2", "3", "4"]);
});

test("isSameOrigin compares origins and rejects invalid URLs", () => {
  assert.equal(isSameOrigin("https://office.example/notes", "https://office.example"), true);
  assert.equal(isSameOrigin("https://office.example/notes", "https://other.example"), false);
  assert.equal(isSameOrigin("http://office.example", "https://office.example"), false);
  assert.equal(isSameOrigin("not-a-url", "https://office.example"), false);
});

test("parseWorkspaceState recovers from malformed files", () => {
  assert.deepEqual(parseWorkspaceState(null), { url: null, recents: [] });
  assert.deepEqual(parseWorkspaceState({ url: "https://ok.example", recents: ["https://ok.example", 1, ""] }), {
    url: "https://ok.example",
    recents: ["https://ok.example"]
  });
});

test("probeWorkspace accepts an HTML workspace", async () => {
  const result = await probeWorkspace("https://office.example", async () => new Response("<html><title>Common Room</title></html>", {
    status: 200,
    headers: { "content-type": "text/html" }
  }));
  assert.deepEqual(result, { ok: true });
});

test("probeWorkspace rejects the API health endpoint", async () => {
  const result = await probeWorkspace("https://api.example", async () => new Response(JSON.stringify({ ok: true, service: "office-api" }), {
    status: 200,
    headers: { "content-type": "application/json" }
  }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "api");
});

test("probeWorkspace reports HTTP and network failures", async () => {
  const missing = await probeWorkspace("https://office.example", async () => new Response("gone", { status: 404 }));
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "http");

  const offline = await probeWorkspace("https://office.example", async () => {
    throw new Error("fetch failed");
  });
  assert.equal(offline.ok, false);
  if (!offline.ok) assert.equal(offline.code, "network");
});

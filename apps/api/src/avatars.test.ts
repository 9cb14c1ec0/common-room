import assert from "node:assert/strict";
import test from "node:test";
import { avatarUrl, detectAvatarType } from "./avatars.js";

test("avatar types are detected from the image bytes", () => {
  assert.equal(detectAvatarType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(detectAvatarType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(detectAvatarType(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "ascii")), "image/webp");
  assert.equal(detectAvatarType(Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"/>")), undefined);
  assert.equal(detectAvatarType(Buffer.alloc(0)), undefined);
});

test("avatar URLs are versioned by upload time", () => {
  assert.equal(avatarUrl("user-1", null), undefined);
  assert.equal(avatarUrl("user-1", "2026-10-19T12:00:00.000Z"), "/api/users/user-1/avatar?v=1792411200000");
});

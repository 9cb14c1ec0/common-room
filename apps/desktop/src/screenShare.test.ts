import assert from "node:assert/strict";
import test from "node:test";
import { canShareDisplay, selectDisplaySource } from "./screenShare.js";

test("canShareDisplay only permits video capture from the workspace", () => {
  const request = { securityOrigin: "https://office.example", videoRequested: true };
  assert.equal(canShareDisplay(request, "https://office.example/team"), true);
  assert.equal(canShareDisplay({ ...request, securityOrigin: "https://evil.example" }, "https://office.example"), false);
  assert.equal(canShareDisplay({ ...request, videoRequested: false }, "https://office.example"), false);
  assert.equal(canShareDisplay(request, null), false);
});

test("selectDisplaySource prefers the primary display and falls back to the first source", () => {
  const sources = [
    { id: "screen:1", display_id: "8" },
    { id: "screen:2", display_id: "12" }
  ];
  assert.equal(selectDisplaySource(sources, 12)?.id, "screen:2");
  assert.equal(selectDisplaySource(sources, 99)?.id, "screen:1");
  assert.equal(selectDisplaySource([], 12), undefined);
});

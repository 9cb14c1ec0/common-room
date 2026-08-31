import assert from "node:assert/strict";
import test from "node:test";
import { canAccessWorkspace, canShareDisplay, displayMediaHandlerOptions, selectDisplaySource } from "./screenShare.js";

test("canAccessWorkspace only permits the configured workspace origin", () => {
  assert.equal(canAccessWorkspace("https://office.example/meeting", "https://office.example/team"), true);
  assert.equal(canAccessWorkspace("https://evil.example", "https://office.example"), false);
  assert.equal(canAccessWorkspace("https://office.example", null), false);
});

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

test("displayMediaHandlerOptions only enables Electron's system picker on macOS", () => {
  assert.deepEqual(displayMediaHandlerOptions("darwin"), { useSystemPicker: true });
  assert.equal(displayMediaHandlerOptions("win32"), undefined);
  assert.equal(displayMediaHandlerOptions("linux"), undefined);
});

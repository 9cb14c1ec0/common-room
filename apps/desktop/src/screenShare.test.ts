import assert from "node:assert/strict";
import test from "node:test";
import { canAccessWorkspace, canShareDisplay, displayMediaHandlerOptions, selectDisplaySource, serializeDisplaySources } from "./screenShare.js";

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

test("serializeDisplaySources exposes safe picker data", () => {
  const sources = [
    { id: "screen:1:0", name: "Screen 1", thumbnail: { toDataURL: () => "data:image/png;base64,screen" } },
    { id: "window:2:0", name: "Notes", thumbnail: { toDataURL: () => "data:image/png;base64,window" } }
  ];
  assert.deepEqual(serializeDisplaySources(sources), [
    { index: 0, name: "Screen 1", thumbnail: "data:image/png;base64,screen", type: "screen" },
    { index: 1, name: "Notes", thumbnail: "data:image/png;base64,window", type: "window" }
  ]);
});

test("selectDisplaySource accepts only an in-range integer index", () => {
  const sources = [{ id: "screen:1" }, { id: "window:2" }];
  assert.equal(selectDisplaySource(sources, 1)?.id, "window:2");
  assert.equal(selectDisplaySource(sources, -1), undefined);
  assert.equal(selectDisplaySource(sources, 2), undefined);
  assert.equal(selectDisplaySource(sources, "1"), undefined);
});

test("displayMediaHandlerOptions only enables Electron's system picker on macOS", () => {
  assert.deepEqual(displayMediaHandlerOptions("darwin"), { useSystemPicker: true });
  assert.equal(displayMediaHandlerOptions("win32"), undefined);
  assert.equal(displayMediaHandlerOptions("linux"), undefined);
});

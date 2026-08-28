import assert from "node:assert/strict";
import test from "node:test";
import { sessionCookieOptions } from "./auth.js";

const withEnv = (values: Record<string, string | undefined>, run: () => void) => {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { run(); } finally { Object.assign(process.env, previous); }
};

test("first-party session cookie stays SameSite=Lax and unpartitioned", () => {
  withEnv({ NODE_ENV: "production", CROSS_SITE_COOKIES: undefined }, () => {
    assert.deepEqual(sessionCookieOptions(), { httpOnly: true, path: "/", secure: true, sameSite: "lax", partitioned: false });
  });
});

test("cross-site session cookie is SameSite=None, Secure and Partitioned", () => {
  withEnv({ NODE_ENV: "production", CROSS_SITE_COOKIES: "true" }, () => {
    assert.deepEqual(sessionCookieOptions(), { httpOnly: true, path: "/", secure: true, sameSite: "none", partitioned: true });
  });
});

test("SameSite=None always carries Secure, even outside production", () => {
  withEnv({ NODE_ENV: "development", CROSS_SITE_COOKIES: "true" }, () => {
    const options = sessionCookieOptions();
    assert.equal(options.sameSite, "none");
    assert.equal(options.secure, true);
  });
});

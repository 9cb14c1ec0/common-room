import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Database } from "./database.js";

const scrypt = promisify(scryptCallback);
const COOKIE = "common_room_session";

export interface AuthUser { id: string; email: string; displayName: string; title: string; isAdmin: boolean }

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, saltHex, expectedHex] = encoded.split(":");
  if (algorithm !== "scrypt" || !saltHex || !expectedHex) return false;
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), 64) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

// The web app reaches the API under its own origin (Vite proxies /api in development, the Render
// static site rewrites it in production), so the session cookie is first-party and SameSite=Lax.
// Set CROSS_SITE_COOKIES=true when the browser calls the API host directly instead: that needs
// SameSite=None plus Partitioned (CHIPS), or browsers blocking third-party cookies reject it.
export const sessionCookieOptions = () => {
  const production = process.env.NODE_ENV === "production";
  const crossSite = process.env.CROSS_SITE_COOKIES === "true";
  return { httpOnly: true, path: "/", secure: production || crossSite, sameSite: crossSite ? "none" : "lax", partitioned: crossSite } as const;
};

export async function createSession(database: Database, userId: string, reply: FastifyReply) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 14 * 86_400_000);
  await database.query("INSERT INTO sessions(id_hash, user_id, expires_at) VALUES ($1, $2, $3)", [digest(token), userId, expiresAt]);
  reply.setCookie(COOKIE, token, { ...sessionCookieOptions(), expires: expiresAt });
}

export async function currentUser(database: Database, request: FastifyRequest): Promise<AuthUser | undefined> {
  const token = request.cookies[COOKIE];
  if (!token) return undefined;
  const result = await database.query(`SELECT u.id, u.email, u.display_name, u.title, u.is_admin FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=$1 AND s.expires_at > now()`, [digest(token)]);
  const row = result.rows[0];
  return row && { id: row.id, email: row.email, displayName: row.display_name, title: row.title, isAdmin: row.is_admin };
}

export async function destroySession(database: Database, request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[COOKIE];
  if (token) await database.query("DELETE FROM sessions WHERE id_hash=$1", [digest(token)]);
  reply.clearCookie(COOKIE, sessionCookieOptions());
}

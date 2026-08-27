export type ConnectErrorCode = "invalid" | "api" | "http" | "network";

export interface WorkspaceState {
  url: string | null;
  recents: string[];
}

export interface ProbeSuccess {
  ok: true;
}

export interface ProbeFailure {
  ok: false;
  code: Exclude<ConnectErrorCode, "invalid">;
  error: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

export function emptyWorkspaceState(): WorkspaceState {
  return { url: null, recents: [] };
}

export function rememberRecent(url: string, recents: string[], limit = 5): string[] {
  return [url, ...recents.filter((item) => item !== url)].slice(0, limit);
}

export function parseWorkspaceState(value: unknown): WorkspaceState {
  if (!value || typeof value !== "object") return emptyWorkspaceState();
  const record = value as { url?: unknown; recents?: unknown };
  return {
    url: typeof record.url === "string" && record.url.length > 0 ? record.url : null,
    recents: Array.isArray(record.recents) ? record.recents.filter((item): item is string => typeof item === "string" && item.length > 0) : []
  };
}

export function defaultSchemeForHost(host: string): "http" | "https" {
  const hostname = host.replace(/:\d+$/, "").toLowerCase();
  if (LOCAL_HOSTS.has(hostname) || PRIVATE_V4.test(hostname)) return "http";
  return "https";
}

export function normalizeWorkspaceUrl(input: string): { ok: true; url: string } | { ok: false; code: "invalid"; error: string } {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, code: "invalid", error: "Enter a workspace URL." };
  if (trimmed.length > 2048) return { ok: false, code: "invalid", error: "That URL is too long." };

  const hostAndPort = /^[a-zA-Z0-9.-]+:\d+(?:[/?#]|$)/.test(trimmed);
  const hasHttpScheme = /^https?:\/\//i.test(trimmed);
  const hasOtherScheme = !hasHttpScheme && !hostAndPort && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
  if (hasOtherScheme) return { ok: false, code: "invalid", error: "Workspace URLs must use http or https." };

  const withScheme = hasHttpScheme ? trimmed : `${defaultSchemeForHost(trimmed.split("/")[0] ?? trimmed)}://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false, code: "invalid", error: "Enter a valid http or https URL." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, code: "invalid", error: "Workspace URLs must use http or https." };
  }
  if (!parsed.hostname) return { ok: false, code: "invalid", error: "Enter a valid http or https URL." };
  if (parsed.username || parsed.password) {
    return { ok: false, code: "invalid", error: "Remove the username and password from the URL." };
  }

  parsed.hash = "";
  const normalized = parsed.toString().replace(/\/+$/, "");
  return { ok: true, url: normalized };
}

export async function probeWorkspace(url: string, fetchFn: typeof fetch = fetch): Promise<ProbeSuccess | ProbeFailure> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "GET",
      redirect: "follow",
      headers: { Accept: "text/html,application/json;q=0.9,*/*;q=0.8" },
      signal: AbortSignal.timeout(8000)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network request failed";
    return { ok: false, code: "network", error: `Could not reach that workspace. ${message}` };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") || contentType.includes("text/plain") || contentType.includes("json")) {
    const text = await response.text();
    try {
      const body = JSON.parse(text) as { service?: unknown };
      if (body.service === "office-api") {
        return {
          ok: false,
          code: "api",
          error: "That URL is the Common Room API. Enter the web app URL you open in a browser."
        };
      }
    } catch {
      /* body is not JSON */
    }
  }

  if (!response.ok) {
    return { ok: false, code: "http", error: `The workspace responded with HTTP ${response.status}.` };
  }
  return { ok: true };
}

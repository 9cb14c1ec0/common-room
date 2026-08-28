import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { chromium } from "playwright";

const apiPort = 4310;
const webPort = 4311;
const webUrl = `http://127.0.0.1:${webPort}`;
const outputPath = fileURLToPath(new URL("../docs/common-room.png", import.meta.url));
const children = [];
const useProcessGroups = process.platform !== "win32";

function start(command, args, env) {
  const child = spawn(command, args, {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, ...env },
    detached: useProcessGroups,
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(child);
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function waitFor(url, child, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} exited before it was ready`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function stopChildren() {
  for (const child of children) {
    if (child.exitCode !== null) continue;
    try {
      if (useProcessGroups) process.kill(-child.pid, "SIGTERM");
      else child.kill("SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

process.on("SIGINT", () => {
  stopChildren();
  process.exit(130);
});

let browser;
try {
  const api = start("npm", ["run", "dev", "-w", "@office/api"], {
    DATABASE_URL: "",
    NODE_ENV: "development",
    PORT: String(apiPort),
    WEB_ORIGIN: webUrl
  });
  const web = start("npm", ["run", "dev", "-w", "@office/web", "--", "--host", "127.0.0.1"], {
    API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
    WEB_PORT: String(webPort)
  });

  await Promise.all([
    waitFor(`http://127.0.0.1:${apiPort}/health`, api, "demo API"),
    waitFor(webUrl, web, "web app")
  ]);

  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Who’s around" }).waitFor();
  await page.getByText("Finalize the onboarding launch checklist").waitFor();
  await page.evaluate(() => document.fonts.ready);
  await mkdir(new URL("../docs", import.meta.url), { recursive: true });
  await page.screenshot({ path: outputPath, fullPage: true });
  console.log(`README screenshot written to ${outputPath}`);
} finally {
  await browser?.close();
  stopChildren();
}

import { app, BrowserWindow, Menu, shell, ipcMain, session } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeWorkspaceUrl, parseWorkspaceState, probeWorkspace, rememberRecent, emptyWorkspaceState, type WorkspaceState } from "./workspace.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const preloadPath = path.join(root, "preload.cjs");
const onboardingPath = path.join(root, "renderer", "onboarding.html");
const loadErrorPath = path.join(root, "renderer", "load-error.html");

let mainWindow: BrowserWindow | undefined;
let showingShellPage = false;

function statePath() {
  return path.join(app.getPath("userData"), "workspace.json");
}

function loadState(): WorkspaceState {
  try {
    return parseWorkspaceState(JSON.parse(readFileSync(statePath(), "utf8")));
  } catch {
    return emptyWorkspaceState();
  }
}

function saveState(state: WorkspaceState) {
  const directory = path.dirname(statePath());
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 640,
    title: "Common Room",
    backgroundColor: "#dce7c7",
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  mainWindow.on("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = undefined; });
  attachNavigationGuards(mainWindow);
  return mainWindow;
}

function attachNavigationGuards(window: BrowserWindow) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    const workspace = loadState().url;
    try {
      if (workspace && new URL(url).origin === new URL(workspace).origin) return { action: "allow" };
    } catch {
      /* fall through */
    }
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (showingShellPage) {
      if (!url.startsWith("file:")) event.preventDefault();
      return;
    }
    try {
      const protocol = new URL(url).protocol;
      if (protocol !== "http:" && protocol !== "https:") event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (!isMainFrame || showingShellPage || errorCode === -3) return;
    void showLoadError(errorDescription);
  });
}

async function showOnboarding() {
  const window = mainWindow ?? createWindow();
  showingShellPage = true;
  await window.loadFile(onboardingPath);
}

async function showLoadError(detail: string) {
  const window = mainWindow ?? createWindow();
  showingShellPage = true;
  const params = new URLSearchParams({ detail });
  await window.loadFile(loadErrorPath, { search: `?${params.toString()}` });
}

async function loadWorkspace(url: string) {
  const window = mainWindow ?? createWindow();
  showingShellPage = false;
  window.setTitle("Common Room");
  try {
    await window.loadURL(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The workspace could not be loaded.";
    await showLoadError(message);
  }
}

async function connectToWorkspace(rawUrl: unknown, force = false) {
  if (typeof rawUrl !== "string") return { ok: false as const, code: "invalid" as const, error: "Enter a workspace URL." };
  const normalized = normalizeWorkspaceUrl(rawUrl);
  if (!normalized.ok) return normalized;
  if (!force) {
    const probe = await probeWorkspace(normalized.url);
    if (!probe.ok) return probe;
  }
  const state = loadState();
  state.url = normalized.url;
  state.recents = rememberRecent(normalized.url, state.recents);
  saveState(state);
  await loadWorkspace(normalized.url);
  return { ok: true as const };
}

function buildMenu() {
  const workspaceSubmenu: Electron.MenuItemConstructorOptions[] = [
    { label: "Change workspace…", click: () => { void showOnboarding(); } }
  ];
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    {
      label: "Workspace",
      submenu: [
        ...workspaceSubmenu,
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" as const } : { role: "quit" as const }
      ]
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc() {
  ipcMain.handle("workspace:get", () => loadState());
  ipcMain.handle("workspace:connect", async (_event, payload: { url?: unknown; force?: unknown } | string) => {
    if (typeof payload === "string") return connectToWorkspace(payload, false);
    return connectToWorkspace(payload?.url, Boolean(payload?.force));
  });
  ipcMain.handle("workspace:disconnect", async () => {
    const state = loadState();
    state.url = null;
    saveState(state);
    await showOnboarding();
  });
  ipcMain.handle("workspace:retry", async () => {
    const url = loadState().url;
    if (!url) {
      await showOnboarding();
      return;
    }
    await loadWorkspace(url);
  });
}

function registerPermissions() {
  const allowed = new Set(["media", "mediaKeySystem", "display-capture", "notifications", "clipboard-sanitized-write"]);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(allowed.has(permission));
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    buildMenu();
    registerIpc();
    registerPermissions();
    createWindow();
    const workspace = loadState().url;
    if (workspace) await loadWorkspace(workspace);
    else await showOnboarding();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      const workspace = loadState().url;
      void (workspace ? loadWorkspace(workspace) : showOnboarding());
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

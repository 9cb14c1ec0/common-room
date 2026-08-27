import { app, BrowserWindow, Menu, Notification, desktopCapturer, shell, ipcMain, screen, session } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeWorkspaceUrl, parseWorkspaceState, probeWorkspace, rememberRecent, emptyWorkspaceState, isSameOrigin, type WorkspaceState } from "./workspace.js";
import { canShareDisplay, selectDisplaySource } from "./screenShare.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const preloadPath = path.join(root, "preload.cjs");
const onboardingPath = path.join(root, "renderer", "onboarding.html");
const loadErrorPath = path.join(root, "renderer", "load-error.html");

let mainWindow: BrowserWindow | undefined;
let showingShellPage = false;
let connectInFlight = false;
const rendererDir = path.resolve(path.join(root, "renderer"));

function isLocalRendererUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "file:") return false;
    const resolved = path.resolve(fileURLToPath(parsed));
    return resolved === rendererDir || resolved.startsWith(rendererDir + path.sep);
  } catch {
    return false;
  }
}

function assertTrustedShell(event: Electron.IpcMainInvokeEvent) {
  const url = event.senderFrame?.url;
  if (!url || !isLocalRendererUrl(url)) throw new Error("Workspace actions are only available from the desktop shell.");
}

function assertTrustedWorkspace(event: Electron.IpcMainInvokeEvent) {
  const url = event.senderFrame?.url;
  const workspace = loadState().url;
  if (!url || !workspace || !isSameOrigin(url, workspace)) throw new Error("Notifications are only available to the connected workspace.");
}

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
    if (workspace && isSameOrigin(url, workspace)) return { action: "allow" };
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (isLocalRendererUrl(url)) return;
    const workspace = loadState().url;
    if (workspace && isSameOrigin(url, workspace)) return;
    event.preventDefault();
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
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
  if (connectInFlight) return { ok: false as const, code: "invalid" as const, error: "A connection is already in progress." };
  if (typeof rawUrl !== "string") return { ok: false as const, code: "invalid" as const, error: "Enter a workspace URL." };
  const normalized = normalizeWorkspaceUrl(rawUrl);
  if (!normalized.ok) return normalized;
  connectInFlight = true;
  try {
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
  } finally {
    connectInFlight = false;
  }
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
  ipcMain.handle("workspace:get", (event) => {
    assertTrustedShell(event);
    return loadState();
  });
  ipcMain.handle("workspace:connect", async (event, payload: { url?: unknown; force?: unknown } | string) => {
    assertTrustedShell(event);
    if (typeof payload === "string") return connectToWorkspace(payload, false);
    return connectToWorkspace(payload?.url, Boolean(payload?.force));
  });
  ipcMain.handle("workspace:disconnect", async (event) => {
    assertTrustedShell(event);
    const state = loadState();
    state.url = null;
    saveState(state);
    await showOnboarding();
  });
  ipcMain.handle("workspace:retry", async (event) => {
    assertTrustedShell(event);
    const url = loadState().url;
    if (!url) {
      await showOnboarding();
      return;
    }
    await loadWorkspace(url);
  });
  ipcMain.handle("notification:show", (event, payload: { title?: unknown; body?: unknown }) => {
    assertTrustedWorkspace(event);
    if (!Notification.isSupported()) return false;
    const title = typeof payload?.title === "string" ? payload.title.slice(0, 120) : "Common Room";
    const body = typeof payload?.body === "string" ? payload.body.slice(0, 500) : "";
    const notification = new Notification({ title, body });
    notification.on("click", () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    });
    notification.show();
    return true;
  });
}

function registerPermissions() {
  const allowed = new Set(["media", "mediaKeySystem", "display-capture", "notifications", "clipboard-sanitized-write"]);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    const workspace = loadState().url;
    callback(Boolean(workspace && allowed.has(permission) && isSameOrigin(contents.getURL(), workspace)));
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!canShareDisplay(request, loadState().url)) {
      callback({});
      return;
    }

    try {
      const sources = await desktopCapturer.getSources({ types: ["screen"] });
      const source = selectDisplaySource(sources, screen.getPrimaryDisplay().id);
      callback(source ? { video: source } : {});
    } catch (error) {
      console.error("Unable to select a screen-sharing source", error);
      callback({});
    }
  }, { useSystemPicker: true });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  if (process.platform === "win32") app.setAppUserModelId("app.commonroom.desktop");

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

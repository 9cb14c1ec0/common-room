"use strict";

const { contextBridge, ipcRenderer } = require("electron");

function isLocalShell() {
  try {
    return location.protocol === "file:";
  } catch {
    return false;
  }
}

if (isLocalShell()) {
  contextBridge.exposeInMainWorld("desktop", {
    getState: () => ipcRenderer.invoke("workspace:get"),
    connect: (url, options) => ipcRenderer.invoke("workspace:connect", { url, force: Boolean(options?.force) }),
    disconnect: () => ipcRenderer.invoke("workspace:disconnect"),
    retry: () => ipcRenderer.invoke("workspace:retry")
  });
}

contextBridge.exposeInMainWorld("commonRoomDesktop", {
  showNotification: (title, body) => ipcRenderer.invoke("notification:show", { title, body })
});

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

if (isLocalShell() && location.pathname.endsWith("/screen-share-picker.html")) {
  contextBridge.exposeInMainWorld("screenShare", {
    getSources: () => ipcRenderer.invoke("screen-share:get-sources"),
    choose: (index) => ipcRenderer.invoke("screen-share:choose", index),
    cancel: () => ipcRenderer.invoke("screen-share:cancel")
  });
}

contextBridge.exposeInMainWorld("commonRoomDesktop", {
  showNotification: (title, body) => ipcRenderer.invoke("notification:show", { title, body })
});

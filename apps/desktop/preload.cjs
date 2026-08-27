"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  getState: () => ipcRenderer.invoke("workspace:get"),
  connect: (url, options) => ipcRenderer.invoke("workspace:connect", { url, force: Boolean(options?.force) }),
  disconnect: () => ipcRenderer.invoke("workspace:disconnect"),
  retry: () => ipcRenderer.invoke("workspace:retry")
});

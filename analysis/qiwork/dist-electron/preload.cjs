"use strict";
const electron = require("electron");
const ipcEvents = require("./ipcEvents-Cd88NGgE.cjs");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  invoke: (channel, args) => {
    if (!ipcEvents.ALLOWED_INVOKE.has(channel)) {
      return Promise.reject(new Error(`ipc blocked: ${channel}`));
    }
    return electron.ipcRenderer.invoke(channel, args);
  },
  listen: (channel, callback) => {
    if (!ipcEvents.ALLOWED_LISTEN.has(channel)) {
      return () => {
      };
    }
    const sub = (_event, payload) => {
      callback(payload);
    };
    electron.ipcRenderer.on(channel, sub);
    return () => electron.ipcRenderer.removeListener(channel, sub);
  },
  platform: process.platform,
  runtime: {
    electron: process.versions.electron ?? "",
    chrome: process.versions.chrome ?? "",
    node: process.versions.node ?? "",
    v8: process.versions.v8 ?? "",
    arch: process.arch
  }
});
//# sourceMappingURL=preload.cjs.map

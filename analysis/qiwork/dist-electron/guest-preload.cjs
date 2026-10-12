"use strict";
const electron = require("electron");
const INVOKE = /* @__PURE__ */ new Set([
  "guest_browser_command",
  "guest_browser_navigate",
  "guest_browser_new_tab",
  "guest_browser_snapshot",
  "show_open_dialog",
  "show_save_dialog",
  "open_folder"
]);
const LISTEN = /* @__PURE__ */ new Set(["guest-browser-state"]);
electron.contextBridge.exposeInMainWorld("electronAPI", {
  invoke: (channel, args) => {
    if (!INVOKE.has(channel)) {
      return Promise.reject(new Error(`ipc blocked: ${channel}`));
    }
    return electron.ipcRenderer.invoke(channel, args);
  },
  listen: (channel, callback) => {
    if (!LISTEN.has(channel)) {
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
//# sourceMappingURL=guest-preload.cjs.map

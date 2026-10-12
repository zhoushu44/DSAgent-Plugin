"use strict";
const electron = require("electron");
const DATA = "update-prompt:data";
const ACTION = "update-prompt:action";
const RESIZE = "update-prompt:resize";
let last = null;
let handler = null;
electron.ipcRenderer.on(DATA, (_event, data) => {
  last = data;
  handler?.(data);
});
electron.contextBridge.exposeInMainWorld("updatePrompt", {
  onData: (cb) => {
    handler = cb;
    if (last) cb(last);
  },
  action: (type) => {
    electron.ipcRenderer.send(ACTION, { type });
  },
  resize: (width, height) => {
    electron.ipcRenderer.send(RESIZE, { width, height });
  }
});
//# sourceMappingURL=update-prompt-preload.cjs.map

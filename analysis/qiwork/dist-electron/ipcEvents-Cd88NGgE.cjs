"use strict";
const IpcInvoke = {
  runtimeState: "runtime_state",
  restartBackend: "restart_backend",
  allowBackendForeground: "allow_backend_foreground",
  openFolder: "open_folder",
  openFile: "open_file",
  openExternalLink: "open_external_link",
  getUiLanguage: "get_ui_language",
  setUiLanguage: "set_ui_language",
  setIdleSleepPrevention: "set_idle_sleep_prevention",
  windowMinimize: "window:minimize",
  windowToggleMaximize: "window:toggle-maximize",
  windowClose: "window:close",
  openDevtools: "open_devtools",
  showOpenDialog: "show_open_dialog",
  showSaveDialog: "show_save_dialog",
  downloadBackendFile: "download_backend_file",
  getAppVersion: "get_app_version",
  updaterCheck: "updater_check",
  updaterDownload: "updater_download",
  updaterQuitAndInstall: "updater_quit_and_install",
  showNotification: "show_notification",
  clipboardWriteText: "clipboard_write_text",
  guestBrowserShow: "guest_browser_show",
  guestBrowserHide: "guest_browser_hide",
  guestBrowserSetBounds: "guest_browser_set_bounds",
  guestBrowserSnapshot: "guest_browser_snapshot",
  guestBrowserNewTab: "guest_browser_new_tab",
  guestBrowserCloseTab: "guest_browser_close_tab",
  guestBrowserSwitchTab: "guest_browser_switch_tab",
  guestBrowserNavigate: "guest_browser_navigate",
  guestBrowserBack: "guest_browser_back",
  guestBrowserForward: "guest_browser_forward",
  guestBrowserReload: "guest_browser_reload",
  guestBrowserHome: "guest_browser_home",
  guestBrowserStop: "guest_browser_stop",
  guestBrowserCommand: "guest_browser_command",
  guestBrowserOverlayReady: "guest_browser_overlay_ready",
  updatePromptSet: "update_prompt_set"
};
const IpcListen = {
  runtimeState: "runtime-state",
  updater: "updater",
  platformLoginEvent: "platform-login-event",
  authDeviceComplete: "auth-device-complete",
  deepLinkNavigate: "deep-link-navigate",
  guestBrowserState: "guest-browser-state",
  guestBrowserOverlay: "guest-browser-overlay",
  updatePromptAction: "update-prompt-action"
};
const ALLOWED_INVOKE = new Set(Object.values(IpcInvoke));
const ALLOWED_LISTEN = new Set(Object.values(IpcListen));
exports.ALLOWED_INVOKE = ALLOWED_INVOKE;
exports.ALLOWED_LISTEN = ALLOWED_LISTEN;
exports.IpcInvoke = IpcInvoke;
exports.IpcListen = IpcListen;
//# sourceMappingURL=ipcEvents-Cd88NGgE.cjs.map

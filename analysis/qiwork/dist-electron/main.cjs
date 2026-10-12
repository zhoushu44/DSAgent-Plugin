"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const electron = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const node_url = require("node:url");
const crypto = require("node:crypto");
const ipcEvents = require("./ipcEvents-Cd88NGgE.cjs");
const promises = require("node:fs/promises");
const promises$1 = require("node:stream/promises");
const node_stream = require("node:stream");
const node_child_process = require("node:child_process");
const readline = require("node:readline");
const net = require("node:net");
const node_util = require("node:util");
const http = require("node:http");
var _documentCurrentScript = typeof document !== "undefined" ? document.currentScript : null;
const HOST_APP_SCHEME = "app";
const __dirname$1 = path.dirname(node_url.fileURLToPath(typeof document === "undefined" ? require("url").pathToFileURL(__filename).href : _documentCurrentScript && _documentCurrentScript.tagName.toUpperCase() === "SCRIPT" && _documentCurrentScript.src || new URL("main.cjs", document.baseURI).href));
function isDev() {
  return !electron.app.isPackaged;
}
function electronDistDir() {
  return path.join(__dirname$1);
}
function preloadPath() {
  return path.join(electronDistDir(), "preload.cjs");
}
function updatePromptPreloadPath() {
  return path.join(electronDistDir(), "update-prompt-preload.cjs");
}
function updatePromptPageUrl() {
  return hostPageUrl("desktop-update-prompt.html");
}
function guestPreloadPath() {
  return path.join(electronDistDir(), "guest-preload.cjs");
}
function historyUtilityPath() {
  return path.join(electronDistDir(), "guest-history-utility.cjs");
}
function devRendererPageUrl(file) {
  const base = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173/electron.html";
  return base.replace(/electron\.html.*$/, file);
}
function hostPageUrl(file) {
  if (isDev()) return devRendererPageUrl(file);
  return `${HOST_APP_SCHEME}://localhost/${file}`;
}
function rendererDistRoot() {
  return path.join(__dirname$1, "..", "dist");
}
function rendererDistFile(file) {
  return path.join(rendererDistRoot(), file);
}
function guestPageUrl(file) {
  if (isDev()) return devRendererPageUrl(file);
  return node_url.pathToFileURL(rendererDistFile(file)).href;
}
function loadGuestRendererPage(wc, file) {
  if (wc.isDestroyed()) return;
  if (isDev()) {
    void wc.loadURL(devRendererPageUrl(file));
    return;
  }
  void wc.loadFile(rendererDistFile(file));
}
function guestToolbarUrl() {
  return hostPageUrl("desktop-toolbar.html");
}
function guestNewtabUrl() {
  return guestPageUrl("desktop-newtab.html");
}
function guestHistoryUrl() {
  return guestPageUrl("desktop-history.html");
}
function guestDownloadsUrl() {
  return guestPageUrl("desktop-downloads.html");
}
function loadGuestCertWarning(wc, params) {
  if (wc.isDestroyed()) return;
  if (isDev()) {
    const next = new URL(devRendererPageUrl("desktop-cert-warning.html"));
    next.searchParams.set("url", params.url);
    next.searchParams.set("host", params.host);
    next.searchParams.set("code", params.code);
    void wc.loadURL(next.toString());
    return;
  }
  void wc.loadFile(rendererDistFile("desktop-cert-warning.html"), { query: params });
}
function guestInternalKind(url) {
  const match = url.match(
    /desktop-(newtab|history|downloads|cert-warning)\.html(?:[?#]|$)/
  );
  if (match?.[1] === "cert-warning") return null;
  return match?.[1] ?? null;
}
function isGuestInternalUrl(url) {
  return guestInternalKind(url) != null || /desktop-cert-warning\.html/.test(url);
}
function officialEnvPaths() {
  if (isDev()) {
    return [
      path.join(electron.app.getAppPath(), "..", "src", "qiwork", "builtin", "official.env")
    ];
  }
  const binaries = resourcesBinariesDir();
  return [
    path.join(binaries, "qiwork", "_internal", "qiwork", "builtin", "official.env"),
    path.join(binaries, "qiwork", "qiwork", "builtin", "official.env"),
    path.join(binaries, "qiwork", "builtin", "official.env")
  ];
}
function resourcesBinariesDir() {
  if (isDev()) {
    return path.join(electron.app.getAppPath(), "build", "binaries");
  }
  return path.join(process.resourcesPath, "binaries");
}
function userGuestExtensionDir(name) {
  return path.join(electron.app.getPath("userData"), "guest-extensions", name);
}
function pathEnvKey() {
  return process.platform === "win32" ? "Path" : "PATH";
}
function joinPathEnv(prepend) {
  const key = pathEnvKey();
  const existing = process.env[key] ?? "";
  const parts = [...prepend, ...existing.split(path.delimiter).filter(Boolean)];
  return parts.join(path.delimiter);
}
function iconsDir() {
  const candidates = [
    path.join(electron.app.getAppPath(), "build", "icons"),
    path.join(process.resourcesPath, "icons"),
    path.join(electronDistDir(), "..", "build", "icons")
  ];
  return candidates.find((d) => fs.existsSync(d)) ?? candidates[0];
}
function loadFirstAvailableIcon(names) {
  const dir = iconsDir();
  for (const name of names) {
    const full = path.join(dir, name);
    if (!fs.existsSync(full)) continue;
    const image = electron.nativeImage.createFromPath(full);
    if (!image.isEmpty()) return image;
  }
  return electron.nativeImage.createEmpty();
}
function appIconCandidates() {
  if (process.platform === "darwin" && isDev()) return ["icon.png", "icon.icns"];
  if (process.platform === "darwin") return ["icon.icns", "icon.png"];
  if (process.platform === "win32") return ["icon.ico", "icon.png"];
  return ["icon.png", "icon.icns"];
}
function loadAppIcon() {
  return loadFirstAvailableIcon(appIconCandidates());
}
function resolveAppIconPath() {
  const dir = iconsDir();
  for (const name of appIconCandidates()) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) return full;
  }
  return void 0;
}
function loadTrayIcon() {
  const template = loadFirstAvailableIcon([
    "trayTemplate.png",
    "trayTemplate@2x.png"
  ]);
  if (!template.isEmpty()) {
    template.setTemplateImage(true);
    return template;
  }
  let image = loadFirstAvailableIcon(appIconCandidates());
  if (image.isEmpty() || process.platform !== "darwin") return image;
  const { width, height } = image.getSize();
  if (width > 22 || height > 22) {
    image = image.resize({ width: 22, height: 22 });
  }
  return image;
}
function applyDockIcon(icon = loadAppIcon()) {
  if (process.platform !== "darwin" || !electron.app.dock || icon.isEmpty()) return;
  electron.app.dock.setIcon(icon);
}
const APP_DISPLAY_NAME = "QIWork";
function setupApplicationBranding() {
  electron.app.setName(APP_DISPLAY_NAME);
}
function setupAboutPanel() {
  const iconPath = resolveAppIconPath();
  electron.app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: electron.app.getVersion(),
    version: electron.app.getVersion(),
    ...iconPath ? { iconPath } : {}
  });
}
function setupMacApplicationMenu() {
  if (process.platform !== "darwin") return;
  const template = [
    {
      label: electron.app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" }
  ];
  electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate(template));
}
const RESTRICTIVE_HEADER_NAMES = /* @__PURE__ */ new Set([
  "content-security-policy",
  "content-security-policy-report-only",
  "x-content-security-policy",
  "x-webkit-csp",
  "x-frame-options",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "permissions-policy",
  "feature-policy"
]);
function relaxResponseHeaders(responseHeaders) {
  if (!responseHeaders) return {};
  const next = {};
  for (const [key, values] of Object.entries(responseHeaders)) {
    if (RESTRICTIVE_HEADER_NAMES.has(key.toLowerCase())) continue;
    if (values) next[key] = values;
  }
  return next;
}
let blockerId = null;
function setIdleSleepPrevention(enabled) {
  if (enabled) {
    if (blockerId === null) {
      blockerId = electron.powerSaveBlocker.start("prevent-app-suspension");
    }
    return electron.powerSaveBlocker.isStarted(blockerId);
  }
  if (blockerId !== null) {
    electron.powerSaveBlocker.stop(blockerId);
    blockerId = null;
  }
  return false;
}
function releaseIdleSleep() {
  setIdleSleepPrevention(false);
}
const LANG_FILE = "ui-language.txt";
function configPath() {
  return path.join(electron.app.getPath("userData"), LANG_FILE);
}
function getUiLanguage() {
  try {
    const p = configPath();
    if (!fs.existsSync(p)) return null;
    const text = fs.readFileSync(p, "utf8").trim();
    return text || null;
  } catch {
    return null;
  }
}
function setUiLanguage(language) {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, language, "utf8");
}
var commonjsGlobal = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : {};
function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}
function commonjsRequire(path2) {
  throw new Error('Could not dynamically require "' + path2 + '". Please configure the dynamicRequireTargets or/and ignoreDynamicRequires option of @rollup/plugin-commonjs appropriately for this require call to work.');
}
var jszip_min = { exports: {} };
/*!

JSZip v3.10.1 - A JavaScript class for generating and reading zip files
<http://stuartk.com/jszip>

(c) 2009-2016 Stuart Knightley <stuart [at] stuartk.com>
Dual licenced under the MIT license or GPLv3. See https://raw.github.com/Stuk/jszip/main/LICENSE.markdown.

JSZip uses the library pako released under the MIT license :
https://github.com/nodeca/pako/blob/main/LICENSE
*/
var hasRequiredJszip_min;
function requireJszip_min() {
  if (hasRequiredJszip_min) return jszip_min.exports;
  hasRequiredJszip_min = 1;
  (function(module2, exports$1) {
    !(function(e) {
      module2.exports = e();
    })(function() {
      return (function s(a, o, h) {
        function u(r, e2) {
          if (!o[r]) {
            if (!a[r]) {
              var t = "function" == typeof commonjsRequire && commonjsRequire;
              if (!e2 && t) return t(r, true);
              if (l) return l(r, true);
              var n = new Error("Cannot find module '" + r + "'");
              throw n.code = "MODULE_NOT_FOUND", n;
            }
            var i = o[r] = { exports: {} };
            a[r][0].call(i.exports, function(e3) {
              var t2 = a[r][1][e3];
              return u(t2 || e3);
            }, i, i.exports, s, a, o, h);
          }
          return o[r].exports;
        }
        for (var l = "function" == typeof commonjsRequire && commonjsRequire, e = 0; e < h.length; e++) u(h[e]);
        return u;
      })({ 1: [function(e, t, r) {
        var d = e("./utils"), c = e("./support"), p = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
        r.encode = function(e2) {
          for (var t2, r2, n, i, s, a, o, h = [], u = 0, l = e2.length, f = l, c2 = "string" !== d.getTypeOf(e2); u < e2.length; ) f = l - u, n = c2 ? (t2 = e2[u++], r2 = u < l ? e2[u++] : 0, u < l ? e2[u++] : 0) : (t2 = e2.charCodeAt(u++), r2 = u < l ? e2.charCodeAt(u++) : 0, u < l ? e2.charCodeAt(u++) : 0), i = t2 >> 2, s = (3 & t2) << 4 | r2 >> 4, a = 1 < f ? (15 & r2) << 2 | n >> 6 : 64, o = 2 < f ? 63 & n : 64, h.push(p.charAt(i) + p.charAt(s) + p.charAt(a) + p.charAt(o));
          return h.join("");
        }, r.decode = function(e2) {
          var t2, r2, n, i, s, a, o = 0, h = 0, u = "data:";
          if (e2.substr(0, u.length) === u) throw new Error("Invalid base64 input, it looks like a data url.");
          var l, f = 3 * (e2 = e2.replace(/[^A-Za-z0-9+/=]/g, "")).length / 4;
          if (e2.charAt(e2.length - 1) === p.charAt(64) && f--, e2.charAt(e2.length - 2) === p.charAt(64) && f--, f % 1 != 0) throw new Error("Invalid base64 input, bad content length.");
          for (l = c.uint8array ? new Uint8Array(0 | f) : new Array(0 | f); o < e2.length; ) t2 = p.indexOf(e2.charAt(o++)) << 2 | (i = p.indexOf(e2.charAt(o++))) >> 4, r2 = (15 & i) << 4 | (s = p.indexOf(e2.charAt(o++))) >> 2, n = (3 & s) << 6 | (a = p.indexOf(e2.charAt(o++))), l[h++] = t2, 64 !== s && (l[h++] = r2), 64 !== a && (l[h++] = n);
          return l;
        };
      }, { "./support": 30, "./utils": 32 }], 2: [function(e, t, r) {
        var n = e("./external"), i = e("./stream/DataWorker"), s = e("./stream/Crc32Probe"), a = e("./stream/DataLengthProbe");
        function o(e2, t2, r2, n2, i2) {
          this.compressedSize = e2, this.uncompressedSize = t2, this.crc32 = r2, this.compression = n2, this.compressedContent = i2;
        }
        o.prototype = { getContentWorker: function() {
          var e2 = new i(n.Promise.resolve(this.compressedContent)).pipe(this.compression.uncompressWorker()).pipe(new a("data_length")), t2 = this;
          return e2.on("end", function() {
            if (this.streamInfo.data_length !== t2.uncompressedSize) throw new Error("Bug : uncompressed data size mismatch");
          }), e2;
        }, getCompressedWorker: function() {
          return new i(n.Promise.resolve(this.compressedContent)).withStreamInfo("compressedSize", this.compressedSize).withStreamInfo("uncompressedSize", this.uncompressedSize).withStreamInfo("crc32", this.crc32).withStreamInfo("compression", this.compression);
        } }, o.createWorkerFrom = function(e2, t2, r2) {
          return e2.pipe(new s()).pipe(new a("uncompressedSize")).pipe(t2.compressWorker(r2)).pipe(new a("compressedSize")).withStreamInfo("compression", t2);
        }, t.exports = o;
      }, { "./external": 6, "./stream/Crc32Probe": 25, "./stream/DataLengthProbe": 26, "./stream/DataWorker": 27 }], 3: [function(e, t, r) {
        var n = e("./stream/GenericWorker");
        r.STORE = { magic: "\0\0", compressWorker: function() {
          return new n("STORE compression");
        }, uncompressWorker: function() {
          return new n("STORE decompression");
        } }, r.DEFLATE = e("./flate");
      }, { "./flate": 7, "./stream/GenericWorker": 28 }], 4: [function(e, t, r) {
        var n = e("./utils");
        var o = (function() {
          for (var e2, t2 = [], r2 = 0; r2 < 256; r2++) {
            e2 = r2;
            for (var n2 = 0; n2 < 8; n2++) e2 = 1 & e2 ? 3988292384 ^ e2 >>> 1 : e2 >>> 1;
            t2[r2] = e2;
          }
          return t2;
        })();
        t.exports = function(e2, t2) {
          return void 0 !== e2 && e2.length ? "string" !== n.getTypeOf(e2) ? (function(e3, t3, r2, n2) {
            var i = o, s = n2 + r2;
            e3 ^= -1;
            for (var a = n2; a < s; a++) e3 = e3 >>> 8 ^ i[255 & (e3 ^ t3[a])];
            return -1 ^ e3;
          })(0 | t2, e2, e2.length, 0) : (function(e3, t3, r2, n2) {
            var i = o, s = n2 + r2;
            e3 ^= -1;
            for (var a = n2; a < s; a++) e3 = e3 >>> 8 ^ i[255 & (e3 ^ t3.charCodeAt(a))];
            return -1 ^ e3;
          })(0 | t2, e2, e2.length, 0) : 0;
        };
      }, { "./utils": 32 }], 5: [function(e, t, r) {
        r.base64 = false, r.binary = false, r.dir = false, r.createFolders = true, r.date = null, r.compression = null, r.compressionOptions = null, r.comment = null, r.unixPermissions = null, r.dosPermissions = null;
      }, {}], 6: [function(e, t, r) {
        var n = null;
        n = "undefined" != typeof Promise ? Promise : e("lie"), t.exports = { Promise: n };
      }, { lie: 37 }], 7: [function(e, t, r) {
        var n = "undefined" != typeof Uint8Array && "undefined" != typeof Uint16Array && "undefined" != typeof Uint32Array, i = e("pako"), s = e("./utils"), a = e("./stream/GenericWorker"), o = n ? "uint8array" : "array";
        function h(e2, t2) {
          a.call(this, "FlateWorker/" + e2), this._pako = null, this._pakoAction = e2, this._pakoOptions = t2, this.meta = {};
        }
        r.magic = "\b\0", s.inherits(h, a), h.prototype.processChunk = function(e2) {
          this.meta = e2.meta, null === this._pako && this._createPako(), this._pako.push(s.transformTo(o, e2.data), false);
        }, h.prototype.flush = function() {
          a.prototype.flush.call(this), null === this._pako && this._createPako(), this._pako.push([], true);
        }, h.prototype.cleanUp = function() {
          a.prototype.cleanUp.call(this), this._pako = null;
        }, h.prototype._createPako = function() {
          this._pako = new i[this._pakoAction]({ raw: true, level: this._pakoOptions.level || -1 });
          var t2 = this;
          this._pako.onData = function(e2) {
            t2.push({ data: e2, meta: t2.meta });
          };
        }, r.compressWorker = function(e2) {
          return new h("Deflate", e2);
        }, r.uncompressWorker = function() {
          return new h("Inflate", {});
        };
      }, { "./stream/GenericWorker": 28, "./utils": 32, pako: 38 }], 8: [function(e, t, r) {
        function A(e2, t2) {
          var r2, n2 = "";
          for (r2 = 0; r2 < t2; r2++) n2 += String.fromCharCode(255 & e2), e2 >>>= 8;
          return n2;
        }
        function n(e2, t2, r2, n2, i2, s2) {
          var a, o, h = e2.file, u = e2.compression, l = s2 !== O.utf8encode, f = I.transformTo("string", s2(h.name)), c = I.transformTo("string", O.utf8encode(h.name)), d = h.comment, p = I.transformTo("string", s2(d)), m = I.transformTo("string", O.utf8encode(d)), _ = c.length !== h.name.length, g = m.length !== d.length, b = "", v = "", y = "", w = h.dir, k = h.date, x = { crc32: 0, compressedSize: 0, uncompressedSize: 0 };
          t2 && !r2 || (x.crc32 = e2.crc32, x.compressedSize = e2.compressedSize, x.uncompressedSize = e2.uncompressedSize);
          var S = 0;
          t2 && (S |= 8), l || !_ && !g || (S |= 2048);
          var z = 0, C = 0;
          w && (z |= 16), "UNIX" === i2 ? (C = 798, z |= (function(e3, t3) {
            var r3 = e3;
            return e3 || (r3 = t3 ? 16893 : 33204), (65535 & r3) << 16;
          })(h.unixPermissions, w)) : (C = 20, z |= (function(e3) {
            return 63 & (e3 || 0);
          })(h.dosPermissions)), a = k.getUTCHours(), a <<= 6, a |= k.getUTCMinutes(), a <<= 5, a |= k.getUTCSeconds() / 2, o = k.getUTCFullYear() - 1980, o <<= 4, o |= k.getUTCMonth() + 1, o <<= 5, o |= k.getUTCDate(), _ && (v = A(1, 1) + A(B(f), 4) + c, b += "up" + A(v.length, 2) + v), g && (y = A(1, 1) + A(B(p), 4) + m, b += "uc" + A(y.length, 2) + y);
          var E = "";
          return E += "\n\0", E += A(S, 2), E += u.magic, E += A(a, 2), E += A(o, 2), E += A(x.crc32, 4), E += A(x.compressedSize, 4), E += A(x.uncompressedSize, 4), E += A(f.length, 2), E += A(b.length, 2), { fileRecord: R.LOCAL_FILE_HEADER + E + f + b, dirRecord: R.CENTRAL_FILE_HEADER + A(C, 2) + E + A(p.length, 2) + "\0\0\0\0" + A(z, 4) + A(n2, 4) + f + b + p };
        }
        var I = e("../utils"), i = e("../stream/GenericWorker"), O = e("../utf8"), B = e("../crc32"), R = e("../signature");
        function s(e2, t2, r2, n2) {
          i.call(this, "ZipFileWorker"), this.bytesWritten = 0, this.zipComment = t2, this.zipPlatform = r2, this.encodeFileName = n2, this.streamFiles = e2, this.accumulate = false, this.contentBuffer = [], this.dirRecords = [], this.currentSourceOffset = 0, this.entriesCount = 0, this.currentFile = null, this._sources = [];
        }
        I.inherits(s, i), s.prototype.push = function(e2) {
          var t2 = e2.meta.percent || 0, r2 = this.entriesCount, n2 = this._sources.length;
          this.accumulate ? this.contentBuffer.push(e2) : (this.bytesWritten += e2.data.length, i.prototype.push.call(this, { data: e2.data, meta: { currentFile: this.currentFile, percent: r2 ? (t2 + 100 * (r2 - n2 - 1)) / r2 : 100 } }));
        }, s.prototype.openedSource = function(e2) {
          this.currentSourceOffset = this.bytesWritten, this.currentFile = e2.file.name;
          var t2 = this.streamFiles && !e2.file.dir;
          if (t2) {
            var r2 = n(e2, t2, false, this.currentSourceOffset, this.zipPlatform, this.encodeFileName);
            this.push({ data: r2.fileRecord, meta: { percent: 0 } });
          } else this.accumulate = true;
        }, s.prototype.closedSource = function(e2) {
          this.accumulate = false;
          var t2 = this.streamFiles && !e2.file.dir, r2 = n(e2, t2, true, this.currentSourceOffset, this.zipPlatform, this.encodeFileName);
          if (this.dirRecords.push(r2.dirRecord), t2) this.push({ data: (function(e3) {
            return R.DATA_DESCRIPTOR + A(e3.crc32, 4) + A(e3.compressedSize, 4) + A(e3.uncompressedSize, 4);
          })(e2), meta: { percent: 100 } });
          else for (this.push({ data: r2.fileRecord, meta: { percent: 0 } }); this.contentBuffer.length; ) this.push(this.contentBuffer.shift());
          this.currentFile = null;
        }, s.prototype.flush = function() {
          for (var e2 = this.bytesWritten, t2 = 0; t2 < this.dirRecords.length; t2++) this.push({ data: this.dirRecords[t2], meta: { percent: 100 } });
          var r2 = this.bytesWritten - e2, n2 = (function(e3, t3, r3, n3, i2) {
            var s2 = I.transformTo("string", i2(n3));
            return R.CENTRAL_DIRECTORY_END + "\0\0\0\0" + A(e3, 2) + A(e3, 2) + A(t3, 4) + A(r3, 4) + A(s2.length, 2) + s2;
          })(this.dirRecords.length, r2, e2, this.zipComment, this.encodeFileName);
          this.push({ data: n2, meta: { percent: 100 } });
        }, s.prototype.prepareNextSource = function() {
          this.previous = this._sources.shift(), this.openedSource(this.previous.streamInfo), this.isPaused ? this.previous.pause() : this.previous.resume();
        }, s.prototype.registerPrevious = function(e2) {
          this._sources.push(e2);
          var t2 = this;
          return e2.on("data", function(e3) {
            t2.processChunk(e3);
          }), e2.on("end", function() {
            t2.closedSource(t2.previous.streamInfo), t2._sources.length ? t2.prepareNextSource() : t2.end();
          }), e2.on("error", function(e3) {
            t2.error(e3);
          }), this;
        }, s.prototype.resume = function() {
          return !!i.prototype.resume.call(this) && (!this.previous && this._sources.length ? (this.prepareNextSource(), true) : this.previous || this._sources.length || this.generatedError ? void 0 : (this.end(), true));
        }, s.prototype.error = function(e2) {
          var t2 = this._sources;
          if (!i.prototype.error.call(this, e2)) return false;
          for (var r2 = 0; r2 < t2.length; r2++) try {
            t2[r2].error(e2);
          } catch (e3) {
          }
          return true;
        }, s.prototype.lock = function() {
          i.prototype.lock.call(this);
          for (var e2 = this._sources, t2 = 0; t2 < e2.length; t2++) e2[t2].lock();
        }, t.exports = s;
      }, { "../crc32": 4, "../signature": 23, "../stream/GenericWorker": 28, "../utf8": 31, "../utils": 32 }], 9: [function(e, t, r) {
        var u = e("../compressions"), n = e("./ZipFileWorker");
        r.generateWorker = function(e2, a, t2) {
          var o = new n(a.streamFiles, t2, a.platform, a.encodeFileName), h = 0;
          try {
            e2.forEach(function(e3, t3) {
              h++;
              var r2 = (function(e4, t4) {
                var r3 = e4 || t4, n3 = u[r3];
                if (!n3) throw new Error(r3 + " is not a valid compression method !");
                return n3;
              })(t3.options.compression, a.compression), n2 = t3.options.compressionOptions || a.compressionOptions || {}, i = t3.dir, s = t3.date;
              t3._compressWorker(r2, n2).withStreamInfo("file", { name: e3, dir: i, date: s, comment: t3.comment || "", unixPermissions: t3.unixPermissions, dosPermissions: t3.dosPermissions }).pipe(o);
            }), o.entriesCount = h;
          } catch (e3) {
            o.error(e3);
          }
          return o;
        };
      }, { "../compressions": 3, "./ZipFileWorker": 8 }], 10: [function(e, t, r) {
        function n() {
          if (!(this instanceof n)) return new n();
          if (arguments.length) throw new Error("The constructor with parameters has been removed in JSZip 3.0, please check the upgrade guide.");
          this.files = /* @__PURE__ */ Object.create(null), this.comment = null, this.root = "", this.clone = function() {
            var e2 = new n();
            for (var t2 in this) "function" != typeof this[t2] && (e2[t2] = this[t2]);
            return e2;
          };
        }
        (n.prototype = e("./object")).loadAsync = e("./load"), n.support = e("./support"), n.defaults = e("./defaults"), n.version = "3.10.1", n.loadAsync = function(e2, t2) {
          return new n().loadAsync(e2, t2);
        }, n.external = e("./external"), t.exports = n;
      }, { "./defaults": 5, "./external": 6, "./load": 11, "./object": 15, "./support": 30 }], 11: [function(e, t, r) {
        var u = e("./utils"), i = e("./external"), n = e("./utf8"), s = e("./zipEntries"), a = e("./stream/Crc32Probe"), l = e("./nodejsUtils");
        function f(n2) {
          return new i.Promise(function(e2, t2) {
            var r2 = n2.decompressed.getContentWorker().pipe(new a());
            r2.on("error", function(e3) {
              t2(e3);
            }).on("end", function() {
              r2.streamInfo.crc32 !== n2.decompressed.crc32 ? t2(new Error("Corrupted zip : CRC32 mismatch")) : e2();
            }).resume();
          });
        }
        t.exports = function(e2, o) {
          var h = this;
          return o = u.extend(o || {}, { base64: false, checkCRC32: false, optimizedBinaryString: false, createFolders: false, decodeFileName: n.utf8decode }), l.isNode && l.isStream(e2) ? i.Promise.reject(new Error("JSZip can't accept a stream when loading a zip file.")) : u.prepareContent("the loaded zip file", e2, true, o.optimizedBinaryString, o.base64).then(function(e3) {
            var t2 = new s(o);
            return t2.load(e3), t2;
          }).then(function(e3) {
            var t2 = [i.Promise.resolve(e3)], r2 = e3.files;
            if (o.checkCRC32) for (var n2 = 0; n2 < r2.length; n2++) t2.push(f(r2[n2]));
            return i.Promise.all(t2);
          }).then(function(e3) {
            for (var t2 = e3.shift(), r2 = t2.files, n2 = 0; n2 < r2.length; n2++) {
              var i2 = r2[n2], s2 = i2.fileNameStr, a2 = u.resolve(i2.fileNameStr);
              h.file(a2, i2.decompressed, { binary: true, optimizedBinaryString: true, date: i2.date, dir: i2.dir, comment: i2.fileCommentStr.length ? i2.fileCommentStr : null, unixPermissions: i2.unixPermissions, dosPermissions: i2.dosPermissions, createFolders: o.createFolders }), i2.dir || (h.file(a2).unsafeOriginalName = s2);
            }
            return t2.zipComment.length && (h.comment = t2.zipComment), h;
          });
        };
      }, { "./external": 6, "./nodejsUtils": 14, "./stream/Crc32Probe": 25, "./utf8": 31, "./utils": 32, "./zipEntries": 33 }], 12: [function(e, t, r) {
        var n = e("../utils"), i = e("../stream/GenericWorker");
        function s(e2, t2) {
          i.call(this, "Nodejs stream input adapter for " + e2), this._upstreamEnded = false, this._bindStream(t2);
        }
        n.inherits(s, i), s.prototype._bindStream = function(e2) {
          var t2 = this;
          (this._stream = e2).pause(), e2.on("data", function(e3) {
            t2.push({ data: e3, meta: { percent: 0 } });
          }).on("error", function(e3) {
            t2.isPaused ? this.generatedError = e3 : t2.error(e3);
          }).on("end", function() {
            t2.isPaused ? t2._upstreamEnded = true : t2.end();
          });
        }, s.prototype.pause = function() {
          return !!i.prototype.pause.call(this) && (this._stream.pause(), true);
        }, s.prototype.resume = function() {
          return !!i.prototype.resume.call(this) && (this._upstreamEnded ? this.end() : this._stream.resume(), true);
        }, t.exports = s;
      }, { "../stream/GenericWorker": 28, "../utils": 32 }], 13: [function(e, t, r) {
        var i = e("readable-stream").Readable;
        function n(e2, t2, r2) {
          i.call(this, t2), this._helper = e2;
          var n2 = this;
          e2.on("data", function(e3, t3) {
            n2.push(e3) || n2._helper.pause(), r2 && r2(t3);
          }).on("error", function(e3) {
            n2.emit("error", e3);
          }).on("end", function() {
            n2.push(null);
          });
        }
        e("../utils").inherits(n, i), n.prototype._read = function() {
          this._helper.resume();
        }, t.exports = n;
      }, { "../utils": 32, "readable-stream": 16 }], 14: [function(e, t, r) {
        t.exports = { isNode: "undefined" != typeof Buffer, newBufferFrom: function(e2, t2) {
          if (Buffer.from && Buffer.from !== Uint8Array.from) return Buffer.from(e2, t2);
          if ("number" == typeof e2) throw new Error('The "data" argument must not be a number');
          return new Buffer(e2, t2);
        }, allocBuffer: function(e2) {
          if (Buffer.alloc) return Buffer.alloc(e2);
          var t2 = new Buffer(e2);
          return t2.fill(0), t2;
        }, isBuffer: function(e2) {
          return Buffer.isBuffer(e2);
        }, isStream: function(e2) {
          return e2 && "function" == typeof e2.on && "function" == typeof e2.pause && "function" == typeof e2.resume;
        } };
      }, {}], 15: [function(e, t, r) {
        function s(e2, t2, r2) {
          var n2, i2 = u.getTypeOf(t2), s2 = u.extend(r2 || {}, f);
          s2.date = s2.date || /* @__PURE__ */ new Date(), null !== s2.compression && (s2.compression = s2.compression.toUpperCase()), "string" == typeof s2.unixPermissions && (s2.unixPermissions = parseInt(s2.unixPermissions, 8)), s2.unixPermissions && 16384 & s2.unixPermissions && (s2.dir = true), s2.dosPermissions && 16 & s2.dosPermissions && (s2.dir = true), s2.dir && (e2 = g(e2)), s2.createFolders && (n2 = _(e2)) && b.call(this, n2, true);
          var a2 = "string" === i2 && false === s2.binary && false === s2.base64;
          r2 && void 0 !== r2.binary || (s2.binary = !a2), (t2 instanceof c && 0 === t2.uncompressedSize || s2.dir || !t2 || 0 === t2.length) && (s2.base64 = false, s2.binary = true, t2 = "", s2.compression = "STORE", i2 = "string");
          var o2 = null;
          o2 = t2 instanceof c || t2 instanceof l ? t2 : p.isNode && p.isStream(t2) ? new m(e2, t2) : u.prepareContent(e2, t2, s2.binary, s2.optimizedBinaryString, s2.base64);
          var h2 = new d(e2, o2, s2);
          this.files[e2] = h2;
        }
        var i = e("./utf8"), u = e("./utils"), l = e("./stream/GenericWorker"), a = e("./stream/StreamHelper"), f = e("./defaults"), c = e("./compressedObject"), d = e("./zipObject"), o = e("./generate"), p = e("./nodejsUtils"), m = e("./nodejs/NodejsStreamInputAdapter"), _ = function(e2) {
          "/" === e2.slice(-1) && (e2 = e2.substring(0, e2.length - 1));
          var t2 = e2.lastIndexOf("/");
          return 0 < t2 ? e2.substring(0, t2) : "";
        }, g = function(e2) {
          return "/" !== e2.slice(-1) && (e2 += "/"), e2;
        }, b = function(e2, t2) {
          return t2 = void 0 !== t2 ? t2 : f.createFolders, e2 = g(e2), this.files[e2] || s.call(this, e2, null, { dir: true, createFolders: t2 }), this.files[e2];
        };
        function h(e2) {
          return "[object RegExp]" === Object.prototype.toString.call(e2);
        }
        var n = { load: function() {
          throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
        }, forEach: function(e2) {
          var t2, r2, n2;
          for (t2 in this.files) n2 = this.files[t2], (r2 = t2.slice(this.root.length, t2.length)) && t2.slice(0, this.root.length) === this.root && e2(r2, n2);
        }, filter: function(r2) {
          var n2 = [];
          return this.forEach(function(e2, t2) {
            r2(e2, t2) && n2.push(t2);
          }), n2;
        }, file: function(e2, t2, r2) {
          if (1 !== arguments.length) return e2 = this.root + e2, s.call(this, e2, t2, r2), this;
          if (h(e2)) {
            var n2 = e2;
            return this.filter(function(e3, t3) {
              return !t3.dir && n2.test(e3);
            });
          }
          var i2 = this.files[this.root + e2];
          return i2 && !i2.dir ? i2 : null;
        }, folder: function(r2) {
          if (!r2) return this;
          if (h(r2)) return this.filter(function(e3, t3) {
            return t3.dir && r2.test(e3);
          });
          var e2 = this.root + r2, t2 = b.call(this, e2), n2 = this.clone();
          return n2.root = t2.name, n2;
        }, remove: function(r2) {
          r2 = this.root + r2;
          var e2 = this.files[r2];
          if (e2 || ("/" !== r2.slice(-1) && (r2 += "/"), e2 = this.files[r2]), e2 && !e2.dir) delete this.files[r2];
          else for (var t2 = this.filter(function(e3, t3) {
            return t3.name.slice(0, r2.length) === r2;
          }), n2 = 0; n2 < t2.length; n2++) delete this.files[t2[n2].name];
          return this;
        }, generate: function() {
          throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
        }, generateInternalStream: function(e2) {
          var t2, r2 = {};
          try {
            if ((r2 = u.extend(e2 || {}, { streamFiles: false, compression: "STORE", compressionOptions: null, type: "", platform: "DOS", comment: null, mimeType: "application/zip", encodeFileName: i.utf8encode })).type = r2.type.toLowerCase(), r2.compression = r2.compression.toUpperCase(), "binarystring" === r2.type && (r2.type = "string"), !r2.type) throw new Error("No output type specified.");
            u.checkSupport(r2.type), "darwin" !== r2.platform && "freebsd" !== r2.platform && "linux" !== r2.platform && "sunos" !== r2.platform || (r2.platform = "UNIX"), "win32" === r2.platform && (r2.platform = "DOS");
            var n2 = r2.comment || this.comment || "";
            t2 = o.generateWorker(this, r2, n2);
          } catch (e3) {
            (t2 = new l("error")).error(e3);
          }
          return new a(t2, r2.type || "string", r2.mimeType);
        }, generateAsync: function(e2, t2) {
          return this.generateInternalStream(e2).accumulate(t2);
        }, generateNodeStream: function(e2, t2) {
          return (e2 = e2 || {}).type || (e2.type = "nodebuffer"), this.generateInternalStream(e2).toNodejsStream(t2);
        } };
        t.exports = n;
      }, { "./compressedObject": 2, "./defaults": 5, "./generate": 9, "./nodejs/NodejsStreamInputAdapter": 12, "./nodejsUtils": 14, "./stream/GenericWorker": 28, "./stream/StreamHelper": 29, "./utf8": 31, "./utils": 32, "./zipObject": 35 }], 16: [function(e, t, r) {
        t.exports = e("stream");
      }, { stream: void 0 }], 17: [function(e, t, r) {
        var n = e("./DataReader");
        function i(e2) {
          n.call(this, e2);
          for (var t2 = 0; t2 < this.data.length; t2++) e2[t2] = 255 & e2[t2];
        }
        e("../utils").inherits(i, n), i.prototype.byteAt = function(e2) {
          return this.data[this.zero + e2];
        }, i.prototype.lastIndexOfSignature = function(e2) {
          for (var t2 = e2.charCodeAt(0), r2 = e2.charCodeAt(1), n2 = e2.charCodeAt(2), i2 = e2.charCodeAt(3), s = this.length - 4; 0 <= s; --s) if (this.data[s] === t2 && this.data[s + 1] === r2 && this.data[s + 2] === n2 && this.data[s + 3] === i2) return s - this.zero;
          return -1;
        }, i.prototype.readAndCheckSignature = function(e2) {
          var t2 = e2.charCodeAt(0), r2 = e2.charCodeAt(1), n2 = e2.charCodeAt(2), i2 = e2.charCodeAt(3), s = this.readData(4);
          return t2 === s[0] && r2 === s[1] && n2 === s[2] && i2 === s[3];
        }, i.prototype.readData = function(e2) {
          if (this.checkOffset(e2), 0 === e2) return [];
          var t2 = this.data.slice(this.zero + this.index, this.zero + this.index + e2);
          return this.index += e2, t2;
        }, t.exports = i;
      }, { "../utils": 32, "./DataReader": 18 }], 18: [function(e, t, r) {
        var n = e("../utils");
        function i(e2) {
          this.data = e2, this.length = e2.length, this.index = 0, this.zero = 0;
        }
        i.prototype = { checkOffset: function(e2) {
          this.checkIndex(this.index + e2);
        }, checkIndex: function(e2) {
          if (this.length < this.zero + e2 || e2 < 0) throw new Error("End of data reached (data length = " + this.length + ", asked index = " + e2 + "). Corrupted zip ?");
        }, setIndex: function(e2) {
          this.checkIndex(e2), this.index = e2;
        }, skip: function(e2) {
          this.setIndex(this.index + e2);
        }, byteAt: function() {
        }, readInt: function(e2) {
          var t2, r2 = 0;
          for (this.checkOffset(e2), t2 = this.index + e2 - 1; t2 >= this.index; t2--) r2 = (r2 << 8) + this.byteAt(t2);
          return this.index += e2, r2;
        }, readString: function(e2) {
          return n.transformTo("string", this.readData(e2));
        }, readData: function() {
        }, lastIndexOfSignature: function() {
        }, readAndCheckSignature: function() {
        }, readDate: function() {
          var e2 = this.readInt(4);
          return new Date(Date.UTC(1980 + (e2 >> 25 & 127), (e2 >> 21 & 15) - 1, e2 >> 16 & 31, e2 >> 11 & 31, e2 >> 5 & 63, (31 & e2) << 1));
        } }, t.exports = i;
      }, { "../utils": 32 }], 19: [function(e, t, r) {
        var n = e("./Uint8ArrayReader");
        function i(e2) {
          n.call(this, e2);
        }
        e("../utils").inherits(i, n), i.prototype.readData = function(e2) {
          this.checkOffset(e2);
          var t2 = this.data.slice(this.zero + this.index, this.zero + this.index + e2);
          return this.index += e2, t2;
        }, t.exports = i;
      }, { "../utils": 32, "./Uint8ArrayReader": 21 }], 20: [function(e, t, r) {
        var n = e("./DataReader");
        function i(e2) {
          n.call(this, e2);
        }
        e("../utils").inherits(i, n), i.prototype.byteAt = function(e2) {
          return this.data.charCodeAt(this.zero + e2);
        }, i.prototype.lastIndexOfSignature = function(e2) {
          return this.data.lastIndexOf(e2) - this.zero;
        }, i.prototype.readAndCheckSignature = function(e2) {
          return e2 === this.readData(4);
        }, i.prototype.readData = function(e2) {
          this.checkOffset(e2);
          var t2 = this.data.slice(this.zero + this.index, this.zero + this.index + e2);
          return this.index += e2, t2;
        }, t.exports = i;
      }, { "../utils": 32, "./DataReader": 18 }], 21: [function(e, t, r) {
        var n = e("./ArrayReader");
        function i(e2) {
          n.call(this, e2);
        }
        e("../utils").inherits(i, n), i.prototype.readData = function(e2) {
          if (this.checkOffset(e2), 0 === e2) return new Uint8Array(0);
          var t2 = this.data.subarray(this.zero + this.index, this.zero + this.index + e2);
          return this.index += e2, t2;
        }, t.exports = i;
      }, { "../utils": 32, "./ArrayReader": 17 }], 22: [function(e, t, r) {
        var n = e("../utils"), i = e("../support"), s = e("./ArrayReader"), a = e("./StringReader"), o = e("./NodeBufferReader"), h = e("./Uint8ArrayReader");
        t.exports = function(e2) {
          var t2 = n.getTypeOf(e2);
          return n.checkSupport(t2), "string" !== t2 || i.uint8array ? "nodebuffer" === t2 ? new o(e2) : i.uint8array ? new h(n.transformTo("uint8array", e2)) : new s(n.transformTo("array", e2)) : new a(e2);
        };
      }, { "../support": 30, "../utils": 32, "./ArrayReader": 17, "./NodeBufferReader": 19, "./StringReader": 20, "./Uint8ArrayReader": 21 }], 23: [function(e, t, r) {
        r.LOCAL_FILE_HEADER = "PK", r.CENTRAL_FILE_HEADER = "PK", r.CENTRAL_DIRECTORY_END = "PK", r.ZIP64_CENTRAL_DIRECTORY_LOCATOR = "PK\x07", r.ZIP64_CENTRAL_DIRECTORY_END = "PK", r.DATA_DESCRIPTOR = "PK\x07\b";
      }, {}], 24: [function(e, t, r) {
        var n = e("./GenericWorker"), i = e("../utils");
        function s(e2) {
          n.call(this, "ConvertWorker to " + e2), this.destType = e2;
        }
        i.inherits(s, n), s.prototype.processChunk = function(e2) {
          this.push({ data: i.transformTo(this.destType, e2.data), meta: e2.meta });
        }, t.exports = s;
      }, { "../utils": 32, "./GenericWorker": 28 }], 25: [function(e, t, r) {
        var n = e("./GenericWorker"), i = e("../crc32");
        function s() {
          n.call(this, "Crc32Probe"), this.withStreamInfo("crc32", 0);
        }
        e("../utils").inherits(s, n), s.prototype.processChunk = function(e2) {
          this.streamInfo.crc32 = i(e2.data, this.streamInfo.crc32 || 0), this.push(e2);
        }, t.exports = s;
      }, { "../crc32": 4, "../utils": 32, "./GenericWorker": 28 }], 26: [function(e, t, r) {
        var n = e("../utils"), i = e("./GenericWorker");
        function s(e2) {
          i.call(this, "DataLengthProbe for " + e2), this.propName = e2, this.withStreamInfo(e2, 0);
        }
        n.inherits(s, i), s.prototype.processChunk = function(e2) {
          if (e2) {
            var t2 = this.streamInfo[this.propName] || 0;
            this.streamInfo[this.propName] = t2 + e2.data.length;
          }
          i.prototype.processChunk.call(this, e2);
        }, t.exports = s;
      }, { "../utils": 32, "./GenericWorker": 28 }], 27: [function(e, t, r) {
        var n = e("../utils"), i = e("./GenericWorker");
        function s(e2) {
          i.call(this, "DataWorker");
          var t2 = this;
          this.dataIsReady = false, this.index = 0, this.max = 0, this.data = null, this.type = "", this._tickScheduled = false, e2.then(function(e3) {
            t2.dataIsReady = true, t2.data = e3, t2.max = e3 && e3.length || 0, t2.type = n.getTypeOf(e3), t2.isPaused || t2._tickAndRepeat();
          }, function(e3) {
            t2.error(e3);
          });
        }
        n.inherits(s, i), s.prototype.cleanUp = function() {
          i.prototype.cleanUp.call(this), this.data = null;
        }, s.prototype.resume = function() {
          return !!i.prototype.resume.call(this) && (!this._tickScheduled && this.dataIsReady && (this._tickScheduled = true, n.delay(this._tickAndRepeat, [], this)), true);
        }, s.prototype._tickAndRepeat = function() {
          this._tickScheduled = false, this.isPaused || this.isFinished || (this._tick(), this.isFinished || (n.delay(this._tickAndRepeat, [], this), this._tickScheduled = true));
        }, s.prototype._tick = function() {
          if (this.isPaused || this.isFinished) return false;
          var e2 = null, t2 = Math.min(this.max, this.index + 16384);
          if (this.index >= this.max) return this.end();
          switch (this.type) {
            case "string":
              e2 = this.data.substring(this.index, t2);
              break;
            case "uint8array":
              e2 = this.data.subarray(this.index, t2);
              break;
            case "array":
            case "nodebuffer":
              e2 = this.data.slice(this.index, t2);
          }
          return this.index = t2, this.push({ data: e2, meta: { percent: this.max ? this.index / this.max * 100 : 0 } });
        }, t.exports = s;
      }, { "../utils": 32, "./GenericWorker": 28 }], 28: [function(e, t, r) {
        function n(e2) {
          this.name = e2 || "default", this.streamInfo = {}, this.generatedError = null, this.extraStreamInfo = {}, this.isPaused = true, this.isFinished = false, this.isLocked = false, this._listeners = { data: [], end: [], error: [] }, this.previous = null;
        }
        n.prototype = { push: function(e2) {
          this.emit("data", e2);
        }, end: function() {
          if (this.isFinished) return false;
          this.flush();
          try {
            this.emit("end"), this.cleanUp(), this.isFinished = true;
          } catch (e2) {
            this.emit("error", e2);
          }
          return true;
        }, error: function(e2) {
          return !this.isFinished && (this.isPaused ? this.generatedError = e2 : (this.isFinished = true, this.emit("error", e2), this.previous && this.previous.error(e2), this.cleanUp()), true);
        }, on: function(e2, t2) {
          return this._listeners[e2].push(t2), this;
        }, cleanUp: function() {
          this.streamInfo = this.generatedError = this.extraStreamInfo = null, this._listeners = [];
        }, emit: function(e2, t2) {
          if (this._listeners[e2]) for (var r2 = 0; r2 < this._listeners[e2].length; r2++) this._listeners[e2][r2].call(this, t2);
        }, pipe: function(e2) {
          return e2.registerPrevious(this);
        }, registerPrevious: function(e2) {
          if (this.isLocked) throw new Error("The stream '" + this + "' has already been used.");
          this.streamInfo = e2.streamInfo, this.mergeStreamInfo(), this.previous = e2;
          var t2 = this;
          return e2.on("data", function(e3) {
            t2.processChunk(e3);
          }), e2.on("end", function() {
            t2.end();
          }), e2.on("error", function(e3) {
            t2.error(e3);
          }), this;
        }, pause: function() {
          return !this.isPaused && !this.isFinished && (this.isPaused = true, this.previous && this.previous.pause(), true);
        }, resume: function() {
          if (!this.isPaused || this.isFinished) return false;
          var e2 = this.isPaused = false;
          return this.generatedError && (this.error(this.generatedError), e2 = true), this.previous && this.previous.resume(), !e2;
        }, flush: function() {
        }, processChunk: function(e2) {
          this.push(e2);
        }, withStreamInfo: function(e2, t2) {
          return this.extraStreamInfo[e2] = t2, this.mergeStreamInfo(), this;
        }, mergeStreamInfo: function() {
          for (var e2 in this.extraStreamInfo) Object.prototype.hasOwnProperty.call(this.extraStreamInfo, e2) && (this.streamInfo[e2] = this.extraStreamInfo[e2]);
        }, lock: function() {
          if (this.isLocked) throw new Error("The stream '" + this + "' has already been used.");
          this.isLocked = true, this.previous && this.previous.lock();
        }, toString: function() {
          var e2 = "Worker " + this.name;
          return this.previous ? this.previous + " -> " + e2 : e2;
        } }, t.exports = n;
      }, {}], 29: [function(e, t, r) {
        var h = e("../utils"), i = e("./ConvertWorker"), s = e("./GenericWorker"), u = e("../base64"), n = e("../support"), a = e("../external"), o = null;
        if (n.nodestream) try {
          o = e("../nodejs/NodejsStreamOutputAdapter");
        } catch (e2) {
        }
        function l(e2, o2) {
          return new a.Promise(function(t2, r2) {
            var n2 = [], i2 = e2._internalType, s2 = e2._outputType, a2 = e2._mimeType;
            e2.on("data", function(e3, t3) {
              n2.push(e3), o2 && o2(t3);
            }).on("error", function(e3) {
              n2 = [], r2(e3);
            }).on("end", function() {
              try {
                var e3 = (function(e4, t3, r3) {
                  switch (e4) {
                    case "blob":
                      return h.newBlob(h.transformTo("arraybuffer", t3), r3);
                    case "base64":
                      return u.encode(t3);
                    default:
                      return h.transformTo(e4, t3);
                  }
                })(s2, (function(e4, t3) {
                  var r3, n3 = 0, i3 = null, s3 = 0;
                  for (r3 = 0; r3 < t3.length; r3++) s3 += t3[r3].length;
                  switch (e4) {
                    case "string":
                      return t3.join("");
                    case "array":
                      return Array.prototype.concat.apply([], t3);
                    case "uint8array":
                      for (i3 = new Uint8Array(s3), r3 = 0; r3 < t3.length; r3++) i3.set(t3[r3], n3), n3 += t3[r3].length;
                      return i3;
                    case "nodebuffer":
                      return Buffer.concat(t3);
                    default:
                      throw new Error("concat : unsupported type '" + e4 + "'");
                  }
                })(i2, n2), a2);
                t2(e3);
              } catch (e4) {
                r2(e4);
              }
              n2 = [];
            }).resume();
          });
        }
        function f(e2, t2, r2) {
          var n2 = t2;
          switch (t2) {
            case "blob":
            case "arraybuffer":
              n2 = "uint8array";
              break;
            case "base64":
              n2 = "string";
          }
          try {
            this._internalType = n2, this._outputType = t2, this._mimeType = r2, h.checkSupport(n2), this._worker = e2.pipe(new i(n2)), e2.lock();
          } catch (e3) {
            this._worker = new s("error"), this._worker.error(e3);
          }
        }
        f.prototype = { accumulate: function(e2) {
          return l(this, e2);
        }, on: function(e2, t2) {
          var r2 = this;
          return "data" === e2 ? this._worker.on(e2, function(e3) {
            t2.call(r2, e3.data, e3.meta);
          }) : this._worker.on(e2, function() {
            h.delay(t2, arguments, r2);
          }), this;
        }, resume: function() {
          return h.delay(this._worker.resume, [], this._worker), this;
        }, pause: function() {
          return this._worker.pause(), this;
        }, toNodejsStream: function(e2) {
          if (h.checkSupport("nodestream"), "nodebuffer" !== this._outputType) throw new Error(this._outputType + " is not supported by this method");
          return new o(this, { objectMode: "nodebuffer" !== this._outputType }, e2);
        } }, t.exports = f;
      }, { "../base64": 1, "../external": 6, "../nodejs/NodejsStreamOutputAdapter": 13, "../support": 30, "../utils": 32, "./ConvertWorker": 24, "./GenericWorker": 28 }], 30: [function(e, t, r) {
        if (r.base64 = true, r.array = true, r.string = true, r.arraybuffer = "undefined" != typeof ArrayBuffer && "undefined" != typeof Uint8Array, r.nodebuffer = "undefined" != typeof Buffer, r.uint8array = "undefined" != typeof Uint8Array, "undefined" == typeof ArrayBuffer) r.blob = false;
        else {
          var n = new ArrayBuffer(0);
          try {
            r.blob = 0 === new Blob([n], { type: "application/zip" }).size;
          } catch (e2) {
            try {
              var i = new (self.BlobBuilder || self.WebKitBlobBuilder || self.MozBlobBuilder || self.MSBlobBuilder)();
              i.append(n), r.blob = 0 === i.getBlob("application/zip").size;
            } catch (e3) {
              r.blob = false;
            }
          }
        }
        try {
          r.nodestream = !!e("readable-stream").Readable;
        } catch (e2) {
          r.nodestream = false;
        }
      }, { "readable-stream": 16 }], 31: [function(e, t, s) {
        for (var o = e("./utils"), h = e("./support"), r = e("./nodejsUtils"), n = e("./stream/GenericWorker"), u = new Array(256), i = 0; i < 256; i++) u[i] = 252 <= i ? 6 : 248 <= i ? 5 : 240 <= i ? 4 : 224 <= i ? 3 : 192 <= i ? 2 : 1;
        u[254] = u[254] = 1;
        function a() {
          n.call(this, "utf-8 decode"), this.leftOver = null;
        }
        function l() {
          n.call(this, "utf-8 encode");
        }
        s.utf8encode = function(e2) {
          return h.nodebuffer ? r.newBufferFrom(e2, "utf-8") : (function(e3) {
            var t2, r2, n2, i2, s2, a2 = e3.length, o2 = 0;
            for (i2 = 0; i2 < a2; i2++) 55296 == (64512 & (r2 = e3.charCodeAt(i2))) && i2 + 1 < a2 && 56320 == (64512 & (n2 = e3.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), o2 += r2 < 128 ? 1 : r2 < 2048 ? 2 : r2 < 65536 ? 3 : 4;
            for (t2 = h.uint8array ? new Uint8Array(o2) : new Array(o2), i2 = s2 = 0; s2 < o2; i2++) 55296 == (64512 & (r2 = e3.charCodeAt(i2))) && i2 + 1 < a2 && 56320 == (64512 & (n2 = e3.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), r2 < 128 ? t2[s2++] = r2 : (r2 < 2048 ? t2[s2++] = 192 | r2 >>> 6 : (r2 < 65536 ? t2[s2++] = 224 | r2 >>> 12 : (t2[s2++] = 240 | r2 >>> 18, t2[s2++] = 128 | r2 >>> 12 & 63), t2[s2++] = 128 | r2 >>> 6 & 63), t2[s2++] = 128 | 63 & r2);
            return t2;
          })(e2);
        }, s.utf8decode = function(e2) {
          return h.nodebuffer ? o.transformTo("nodebuffer", e2).toString("utf-8") : (function(e3) {
            var t2, r2, n2, i2, s2 = e3.length, a2 = new Array(2 * s2);
            for (t2 = r2 = 0; t2 < s2; ) if ((n2 = e3[t2++]) < 128) a2[r2++] = n2;
            else if (4 < (i2 = u[n2])) a2[r2++] = 65533, t2 += i2 - 1;
            else {
              for (n2 &= 2 === i2 ? 31 : 3 === i2 ? 15 : 7; 1 < i2 && t2 < s2; ) n2 = n2 << 6 | 63 & e3[t2++], i2--;
              1 < i2 ? a2[r2++] = 65533 : n2 < 65536 ? a2[r2++] = n2 : (n2 -= 65536, a2[r2++] = 55296 | n2 >> 10 & 1023, a2[r2++] = 56320 | 1023 & n2);
            }
            return a2.length !== r2 && (a2.subarray ? a2 = a2.subarray(0, r2) : a2.length = r2), o.applyFromCharCode(a2);
          })(e2 = o.transformTo(h.uint8array ? "uint8array" : "array", e2));
        }, o.inherits(a, n), a.prototype.processChunk = function(e2) {
          var t2 = o.transformTo(h.uint8array ? "uint8array" : "array", e2.data);
          if (this.leftOver && this.leftOver.length) {
            if (h.uint8array) {
              var r2 = t2;
              (t2 = new Uint8Array(r2.length + this.leftOver.length)).set(this.leftOver, 0), t2.set(r2, this.leftOver.length);
            } else t2 = this.leftOver.concat(t2);
            this.leftOver = null;
          }
          var n2 = (function(e3, t3) {
            var r3;
            for ((t3 = t3 || e3.length) > e3.length && (t3 = e3.length), r3 = t3 - 1; 0 <= r3 && 128 == (192 & e3[r3]); ) r3--;
            return r3 < 0 ? t3 : 0 === r3 ? t3 : r3 + u[e3[r3]] > t3 ? r3 : t3;
          })(t2), i2 = t2;
          n2 !== t2.length && (h.uint8array ? (i2 = t2.subarray(0, n2), this.leftOver = t2.subarray(n2, t2.length)) : (i2 = t2.slice(0, n2), this.leftOver = t2.slice(n2, t2.length))), this.push({ data: s.utf8decode(i2), meta: e2.meta });
        }, a.prototype.flush = function() {
          this.leftOver && this.leftOver.length && (this.push({ data: s.utf8decode(this.leftOver), meta: {} }), this.leftOver = null);
        }, s.Utf8DecodeWorker = a, o.inherits(l, n), l.prototype.processChunk = function(e2) {
          this.push({ data: s.utf8encode(e2.data), meta: e2.meta });
        }, s.Utf8EncodeWorker = l;
      }, { "./nodejsUtils": 14, "./stream/GenericWorker": 28, "./support": 30, "./utils": 32 }], 32: [function(e, t, a) {
        var o = e("./support"), h = e("./base64"), r = e("./nodejsUtils"), u = e("./external");
        function n(e2) {
          return e2;
        }
        function l(e2, t2) {
          for (var r2 = 0; r2 < e2.length; ++r2) t2[r2] = 255 & e2.charCodeAt(r2);
          return t2;
        }
        e("setimmediate"), a.newBlob = function(t2, r2) {
          a.checkSupport("blob");
          try {
            return new Blob([t2], { type: r2 });
          } catch (e2) {
            try {
              var n2 = new (self.BlobBuilder || self.WebKitBlobBuilder || self.MozBlobBuilder || self.MSBlobBuilder)();
              return n2.append(t2), n2.getBlob(r2);
            } catch (e3) {
              throw new Error("Bug : can't construct the Blob.");
            }
          }
        };
        var i = { stringifyByChunk: function(e2, t2, r2) {
          var n2 = [], i2 = 0, s2 = e2.length;
          if (s2 <= r2) return String.fromCharCode.apply(null, e2);
          for (; i2 < s2; ) "array" === t2 || "nodebuffer" === t2 ? n2.push(String.fromCharCode.apply(null, e2.slice(i2, Math.min(i2 + r2, s2)))) : n2.push(String.fromCharCode.apply(null, e2.subarray(i2, Math.min(i2 + r2, s2)))), i2 += r2;
          return n2.join("");
        }, stringifyByChar: function(e2) {
          for (var t2 = "", r2 = 0; r2 < e2.length; r2++) t2 += String.fromCharCode(e2[r2]);
          return t2;
        }, applyCanBeUsed: { uint8array: (function() {
          try {
            return o.uint8array && 1 === String.fromCharCode.apply(null, new Uint8Array(1)).length;
          } catch (e2) {
            return false;
          }
        })(), nodebuffer: (function() {
          try {
            return o.nodebuffer && 1 === String.fromCharCode.apply(null, r.allocBuffer(1)).length;
          } catch (e2) {
            return false;
          }
        })() } };
        function s(e2) {
          var t2 = 65536, r2 = a.getTypeOf(e2), n2 = true;
          if ("uint8array" === r2 ? n2 = i.applyCanBeUsed.uint8array : "nodebuffer" === r2 && (n2 = i.applyCanBeUsed.nodebuffer), n2) for (; 1 < t2; ) try {
            return i.stringifyByChunk(e2, r2, t2);
          } catch (e3) {
            t2 = Math.floor(t2 / 2);
          }
          return i.stringifyByChar(e2);
        }
        function f(e2, t2) {
          for (var r2 = 0; r2 < e2.length; r2++) t2[r2] = e2[r2];
          return t2;
        }
        a.applyFromCharCode = s;
        var c = {};
        c.string = { string: n, array: function(e2) {
          return l(e2, new Array(e2.length));
        }, arraybuffer: function(e2) {
          return c.string.uint8array(e2).buffer;
        }, uint8array: function(e2) {
          return l(e2, new Uint8Array(e2.length));
        }, nodebuffer: function(e2) {
          return l(e2, r.allocBuffer(e2.length));
        } }, c.array = { string: s, array: n, arraybuffer: function(e2) {
          return new Uint8Array(e2).buffer;
        }, uint8array: function(e2) {
          return new Uint8Array(e2);
        }, nodebuffer: function(e2) {
          return r.newBufferFrom(e2);
        } }, c.arraybuffer = { string: function(e2) {
          return s(new Uint8Array(e2));
        }, array: function(e2) {
          return f(new Uint8Array(e2), new Array(e2.byteLength));
        }, arraybuffer: n, uint8array: function(e2) {
          return new Uint8Array(e2);
        }, nodebuffer: function(e2) {
          return r.newBufferFrom(new Uint8Array(e2));
        } }, c.uint8array = { string: s, array: function(e2) {
          return f(e2, new Array(e2.length));
        }, arraybuffer: function(e2) {
          return e2.buffer;
        }, uint8array: n, nodebuffer: function(e2) {
          return r.newBufferFrom(e2);
        } }, c.nodebuffer = { string: s, array: function(e2) {
          return f(e2, new Array(e2.length));
        }, arraybuffer: function(e2) {
          return c.nodebuffer.uint8array(e2).buffer;
        }, uint8array: function(e2) {
          return f(e2, new Uint8Array(e2.length));
        }, nodebuffer: n }, a.transformTo = function(e2, t2) {
          if (t2 = t2 || "", !e2) return t2;
          a.checkSupport(e2);
          var r2 = a.getTypeOf(t2);
          return c[r2][e2](t2);
        }, a.resolve = function(e2) {
          for (var t2 = e2.split("/"), r2 = [], n2 = 0; n2 < t2.length; n2++) {
            var i2 = t2[n2];
            "." === i2 || "" === i2 && 0 !== n2 && n2 !== t2.length - 1 || (".." === i2 ? r2.pop() : r2.push(i2));
          }
          return r2.join("/");
        }, a.getTypeOf = function(e2) {
          return "string" == typeof e2 ? "string" : "[object Array]" === Object.prototype.toString.call(e2) ? "array" : o.nodebuffer && r.isBuffer(e2) ? "nodebuffer" : o.uint8array && e2 instanceof Uint8Array ? "uint8array" : o.arraybuffer && e2 instanceof ArrayBuffer ? "arraybuffer" : void 0;
        }, a.checkSupport = function(e2) {
          if (!o[e2.toLowerCase()]) throw new Error(e2 + " is not supported by this platform");
        }, a.MAX_VALUE_16BITS = 65535, a.MAX_VALUE_32BITS = -1, a.pretty = function(e2) {
          var t2, r2, n2 = "";
          for (r2 = 0; r2 < (e2 || "").length; r2++) n2 += "\\x" + ((t2 = e2.charCodeAt(r2)) < 16 ? "0" : "") + t2.toString(16).toUpperCase();
          return n2;
        }, a.delay = function(e2, t2, r2) {
          setImmediate(function() {
            e2.apply(r2 || null, t2 || []);
          });
        }, a.inherits = function(e2, t2) {
          function r2() {
          }
          r2.prototype = t2.prototype, e2.prototype = new r2();
        }, a.extend = function() {
          var e2, t2, r2 = {};
          for (e2 = 0; e2 < arguments.length; e2++) for (t2 in arguments[e2]) Object.prototype.hasOwnProperty.call(arguments[e2], t2) && void 0 === r2[t2] && (r2[t2] = arguments[e2][t2]);
          return r2;
        }, a.prepareContent = function(r2, e2, n2, i2, s2) {
          return u.Promise.resolve(e2).then(function(n3) {
            return o.blob && (n3 instanceof Blob || -1 !== ["[object File]", "[object Blob]"].indexOf(Object.prototype.toString.call(n3))) && "undefined" != typeof FileReader ? new u.Promise(function(t2, r3) {
              var e3 = new FileReader();
              e3.onload = function(e4) {
                t2(e4.target.result);
              }, e3.onerror = function(e4) {
                r3(e4.target.error);
              }, e3.readAsArrayBuffer(n3);
            }) : n3;
          }).then(function(e3) {
            var t2 = a.getTypeOf(e3);
            return t2 ? ("arraybuffer" === t2 ? e3 = a.transformTo("uint8array", e3) : "string" === t2 && (s2 ? e3 = h.decode(e3) : n2 && true !== i2 && (e3 = (function(e4) {
              return l(e4, o.uint8array ? new Uint8Array(e4.length) : new Array(e4.length));
            })(e3))), e3) : u.Promise.reject(new Error("Can't read the data of '" + r2 + "'. Is it in a supported JavaScript type (String, Blob, ArrayBuffer, etc) ?"));
          });
        };
      }, { "./base64": 1, "./external": 6, "./nodejsUtils": 14, "./support": 30, setimmediate: 54 }], 33: [function(e, t, r) {
        var n = e("./reader/readerFor"), i = e("./utils"), s = e("./signature"), a = e("./zipEntry"), o = e("./support");
        function h(e2) {
          this.files = [], this.loadOptions = e2;
        }
        h.prototype = { checkSignature: function(e2) {
          if (!this.reader.readAndCheckSignature(e2)) {
            this.reader.index -= 4;
            var t2 = this.reader.readString(4);
            throw new Error("Corrupted zip or bug: unexpected signature (" + i.pretty(t2) + ", expected " + i.pretty(e2) + ")");
          }
        }, isSignature: function(e2, t2) {
          var r2 = this.reader.index;
          this.reader.setIndex(e2);
          var n2 = this.reader.readString(4) === t2;
          return this.reader.setIndex(r2), n2;
        }, readBlockEndOfCentral: function() {
          this.diskNumber = this.reader.readInt(2), this.diskWithCentralDirStart = this.reader.readInt(2), this.centralDirRecordsOnThisDisk = this.reader.readInt(2), this.centralDirRecords = this.reader.readInt(2), this.centralDirSize = this.reader.readInt(4), this.centralDirOffset = this.reader.readInt(4), this.zipCommentLength = this.reader.readInt(2);
          var e2 = this.reader.readData(this.zipCommentLength), t2 = o.uint8array ? "uint8array" : "array", r2 = i.transformTo(t2, e2);
          this.zipComment = this.loadOptions.decodeFileName(r2);
        }, readBlockZip64EndOfCentral: function() {
          this.zip64EndOfCentralSize = this.reader.readInt(8), this.reader.skip(4), this.diskNumber = this.reader.readInt(4), this.diskWithCentralDirStart = this.reader.readInt(4), this.centralDirRecordsOnThisDisk = this.reader.readInt(8), this.centralDirRecords = this.reader.readInt(8), this.centralDirSize = this.reader.readInt(8), this.centralDirOffset = this.reader.readInt(8), this.zip64ExtensibleData = {};
          for (var e2, t2, r2, n2 = this.zip64EndOfCentralSize - 44; 0 < n2; ) e2 = this.reader.readInt(2), t2 = this.reader.readInt(4), r2 = this.reader.readData(t2), this.zip64ExtensibleData[e2] = { id: e2, length: t2, value: r2 };
        }, readBlockZip64EndOfCentralLocator: function() {
          if (this.diskWithZip64CentralDirStart = this.reader.readInt(4), this.relativeOffsetEndOfZip64CentralDir = this.reader.readInt(8), this.disksCount = this.reader.readInt(4), 1 < this.disksCount) throw new Error("Multi-volumes zip are not supported");
        }, readLocalFiles: function() {
          var e2, t2;
          for (e2 = 0; e2 < this.files.length; e2++) t2 = this.files[e2], this.reader.setIndex(t2.localHeaderOffset), this.checkSignature(s.LOCAL_FILE_HEADER), t2.readLocalPart(this.reader), t2.handleUTF8(), t2.processAttributes();
        }, readCentralDir: function() {
          var e2;
          for (this.reader.setIndex(this.centralDirOffset); this.reader.readAndCheckSignature(s.CENTRAL_FILE_HEADER); ) (e2 = new a({ zip64: this.zip64 }, this.loadOptions)).readCentralPart(this.reader), this.files.push(e2);
          if (this.centralDirRecords !== this.files.length && 0 !== this.centralDirRecords && 0 === this.files.length) throw new Error("Corrupted zip or bug: expected " + this.centralDirRecords + " records in central dir, got " + this.files.length);
        }, readEndOfCentral: function() {
          var e2 = this.reader.lastIndexOfSignature(s.CENTRAL_DIRECTORY_END);
          if (e2 < 0) throw !this.isSignature(0, s.LOCAL_FILE_HEADER) ? new Error("Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html") : new Error("Corrupted zip: can't find end of central directory");
          this.reader.setIndex(e2);
          var t2 = e2;
          if (this.checkSignature(s.CENTRAL_DIRECTORY_END), this.readBlockEndOfCentral(), this.diskNumber === i.MAX_VALUE_16BITS || this.diskWithCentralDirStart === i.MAX_VALUE_16BITS || this.centralDirRecordsOnThisDisk === i.MAX_VALUE_16BITS || this.centralDirRecords === i.MAX_VALUE_16BITS || this.centralDirSize === i.MAX_VALUE_32BITS || this.centralDirOffset === i.MAX_VALUE_32BITS) {
            if (this.zip64 = true, (e2 = this.reader.lastIndexOfSignature(s.ZIP64_CENTRAL_DIRECTORY_LOCATOR)) < 0) throw new Error("Corrupted zip: can't find the ZIP64 end of central directory locator");
            if (this.reader.setIndex(e2), this.checkSignature(s.ZIP64_CENTRAL_DIRECTORY_LOCATOR), this.readBlockZip64EndOfCentralLocator(), !this.isSignature(this.relativeOffsetEndOfZip64CentralDir, s.ZIP64_CENTRAL_DIRECTORY_END) && (this.relativeOffsetEndOfZip64CentralDir = this.reader.lastIndexOfSignature(s.ZIP64_CENTRAL_DIRECTORY_END), this.relativeOffsetEndOfZip64CentralDir < 0)) throw new Error("Corrupted zip: can't find the ZIP64 end of central directory");
            this.reader.setIndex(this.relativeOffsetEndOfZip64CentralDir), this.checkSignature(s.ZIP64_CENTRAL_DIRECTORY_END), this.readBlockZip64EndOfCentral();
          }
          var r2 = this.centralDirOffset + this.centralDirSize;
          this.zip64 && (r2 += 20, r2 += 12 + this.zip64EndOfCentralSize);
          var n2 = t2 - r2;
          if (0 < n2) this.isSignature(t2, s.CENTRAL_FILE_HEADER) || (this.reader.zero = n2);
          else if (n2 < 0) throw new Error("Corrupted zip: missing " + Math.abs(n2) + " bytes.");
        }, prepareReader: function(e2) {
          this.reader = n(e2);
        }, load: function(e2) {
          this.prepareReader(e2), this.readEndOfCentral(), this.readCentralDir(), this.readLocalFiles();
        } }, t.exports = h;
      }, { "./reader/readerFor": 22, "./signature": 23, "./support": 30, "./utils": 32, "./zipEntry": 34 }], 34: [function(e, t, r) {
        var n = e("./reader/readerFor"), s = e("./utils"), i = e("./compressedObject"), a = e("./crc32"), o = e("./utf8"), h = e("./compressions"), u = e("./support");
        function l(e2, t2) {
          this.options = e2, this.loadOptions = t2;
        }
        l.prototype = { isEncrypted: function() {
          return 1 == (1 & this.bitFlag);
        }, useUTF8: function() {
          return 2048 == (2048 & this.bitFlag);
        }, readLocalPart: function(e2) {
          var t2, r2;
          if (e2.skip(22), this.fileNameLength = e2.readInt(2), r2 = e2.readInt(2), this.fileName = e2.readData(this.fileNameLength), e2.skip(r2), -1 === this.compressedSize || -1 === this.uncompressedSize) throw new Error("Bug or corrupted zip : didn't get enough information from the central directory (compressedSize === -1 || uncompressedSize === -1)");
          if (null === (t2 = (function(e3) {
            for (var t3 in h) if (Object.prototype.hasOwnProperty.call(h, t3) && h[t3].magic === e3) return h[t3];
            return null;
          })(this.compressionMethod))) throw new Error("Corrupted zip : compression " + s.pretty(this.compressionMethod) + " unknown (inner file : " + s.transformTo("string", this.fileName) + ")");
          this.decompressed = new i(this.compressedSize, this.uncompressedSize, this.crc32, t2, e2.readData(this.compressedSize));
        }, readCentralPart: function(e2) {
          this.versionMadeBy = e2.readInt(2), e2.skip(2), this.bitFlag = e2.readInt(2), this.compressionMethod = e2.readString(2), this.date = e2.readDate(), this.crc32 = e2.readInt(4), this.compressedSize = e2.readInt(4), this.uncompressedSize = e2.readInt(4);
          var t2 = e2.readInt(2);
          if (this.extraFieldsLength = e2.readInt(2), this.fileCommentLength = e2.readInt(2), this.diskNumberStart = e2.readInt(2), this.internalFileAttributes = e2.readInt(2), this.externalFileAttributes = e2.readInt(4), this.localHeaderOffset = e2.readInt(4), this.isEncrypted()) throw new Error("Encrypted zip are not supported");
          e2.skip(t2), this.readExtraFields(e2), this.parseZIP64ExtraField(e2), this.fileComment = e2.readData(this.fileCommentLength);
        }, processAttributes: function() {
          this.unixPermissions = null, this.dosPermissions = null;
          var e2 = this.versionMadeBy >> 8;
          this.dir = !!(16 & this.externalFileAttributes), 0 == e2 && (this.dosPermissions = 63 & this.externalFileAttributes), 3 == e2 && (this.unixPermissions = this.externalFileAttributes >> 16 & 65535), this.dir || "/" !== this.fileNameStr.slice(-1) || (this.dir = true);
        }, parseZIP64ExtraField: function() {
          if (this.extraFields[1]) {
            var e2 = n(this.extraFields[1].value);
            this.uncompressedSize === s.MAX_VALUE_32BITS && (this.uncompressedSize = e2.readInt(8)), this.compressedSize === s.MAX_VALUE_32BITS && (this.compressedSize = e2.readInt(8)), this.localHeaderOffset === s.MAX_VALUE_32BITS && (this.localHeaderOffset = e2.readInt(8)), this.diskNumberStart === s.MAX_VALUE_32BITS && (this.diskNumberStart = e2.readInt(4));
          }
        }, readExtraFields: function(e2) {
          var t2, r2, n2, i2 = e2.index + this.extraFieldsLength;
          for (this.extraFields || (this.extraFields = {}); e2.index + 4 < i2; ) t2 = e2.readInt(2), r2 = e2.readInt(2), n2 = e2.readData(r2), this.extraFields[t2] = { id: t2, length: r2, value: n2 };
          e2.setIndex(i2);
        }, handleUTF8: function() {
          var e2 = u.uint8array ? "uint8array" : "array";
          if (this.useUTF8()) this.fileNameStr = o.utf8decode(this.fileName), this.fileCommentStr = o.utf8decode(this.fileComment);
          else {
            var t2 = this.findExtraFieldUnicodePath();
            if (null !== t2) this.fileNameStr = t2;
            else {
              var r2 = s.transformTo(e2, this.fileName);
              this.fileNameStr = this.loadOptions.decodeFileName(r2);
            }
            var n2 = this.findExtraFieldUnicodeComment();
            if (null !== n2) this.fileCommentStr = n2;
            else {
              var i2 = s.transformTo(e2, this.fileComment);
              this.fileCommentStr = this.loadOptions.decodeFileName(i2);
            }
          }
        }, findExtraFieldUnicodePath: function() {
          var e2 = this.extraFields[28789];
          if (e2) {
            var t2 = n(e2.value);
            return 1 !== t2.readInt(1) ? null : a(this.fileName) !== t2.readInt(4) ? null : o.utf8decode(t2.readData(e2.length - 5));
          }
          return null;
        }, findExtraFieldUnicodeComment: function() {
          var e2 = this.extraFields[25461];
          if (e2) {
            var t2 = n(e2.value);
            return 1 !== t2.readInt(1) ? null : a(this.fileComment) !== t2.readInt(4) ? null : o.utf8decode(t2.readData(e2.length - 5));
          }
          return null;
        } }, t.exports = l;
      }, { "./compressedObject": 2, "./compressions": 3, "./crc32": 4, "./reader/readerFor": 22, "./support": 30, "./utf8": 31, "./utils": 32 }], 35: [function(e, t, r) {
        function n(e2, t2, r2) {
          this.name = e2, this.dir = r2.dir, this.date = r2.date, this.comment = r2.comment, this.unixPermissions = r2.unixPermissions, this.dosPermissions = r2.dosPermissions, this._data = t2, this._dataBinary = r2.binary, this.options = { compression: r2.compression, compressionOptions: r2.compressionOptions };
        }
        var s = e("./stream/StreamHelper"), i = e("./stream/DataWorker"), a = e("./utf8"), o = e("./compressedObject"), h = e("./stream/GenericWorker");
        n.prototype = { internalStream: function(e2) {
          var t2 = null, r2 = "string";
          try {
            if (!e2) throw new Error("No output type specified.");
            var n2 = "string" === (r2 = e2.toLowerCase()) || "text" === r2;
            "binarystring" !== r2 && "text" !== r2 || (r2 = "string"), t2 = this._decompressWorker();
            var i2 = !this._dataBinary;
            i2 && !n2 && (t2 = t2.pipe(new a.Utf8EncodeWorker())), !i2 && n2 && (t2 = t2.pipe(new a.Utf8DecodeWorker()));
          } catch (e3) {
            (t2 = new h("error")).error(e3);
          }
          return new s(t2, r2, "");
        }, async: function(e2, t2) {
          return this.internalStream(e2).accumulate(t2);
        }, nodeStream: function(e2, t2) {
          return this.internalStream(e2 || "nodebuffer").toNodejsStream(t2);
        }, _compressWorker: function(e2, t2) {
          if (this._data instanceof o && this._data.compression.magic === e2.magic) return this._data.getCompressedWorker();
          var r2 = this._decompressWorker();
          return this._dataBinary || (r2 = r2.pipe(new a.Utf8EncodeWorker())), o.createWorkerFrom(r2, e2, t2);
        }, _decompressWorker: function() {
          return this._data instanceof o ? this._data.getContentWorker() : this._data instanceof h ? this._data : new i(this._data);
        } };
        for (var u = ["asText", "asBinary", "asNodeBuffer", "asUint8Array", "asArrayBuffer"], l = function() {
          throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
        }, f = 0; f < u.length; f++) n.prototype[u[f]] = l;
        t.exports = n;
      }, { "./compressedObject": 2, "./stream/DataWorker": 27, "./stream/GenericWorker": 28, "./stream/StreamHelper": 29, "./utf8": 31 }], 36: [function(e, l, t) {
        (function(t2) {
          var r, n, e2 = t2.MutationObserver || t2.WebKitMutationObserver;
          if (e2) {
            var i = 0, s = new e2(u), a = t2.document.createTextNode("");
            s.observe(a, { characterData: true }), r = function() {
              a.data = i = ++i % 2;
            };
          } else if (t2.setImmediate || void 0 === t2.MessageChannel) r = "document" in t2 && "onreadystatechange" in t2.document.createElement("script") ? function() {
            var e3 = t2.document.createElement("script");
            e3.onreadystatechange = function() {
              u(), e3.onreadystatechange = null, e3.parentNode.removeChild(e3), e3 = null;
            }, t2.document.documentElement.appendChild(e3);
          } : function() {
            setTimeout(u, 0);
          };
          else {
            var o = new t2.MessageChannel();
            o.port1.onmessage = u, r = function() {
              o.port2.postMessage(0);
            };
          }
          var h = [];
          function u() {
            var e3, t3;
            n = true;
            for (var r2 = h.length; r2; ) {
              for (t3 = h, h = [], e3 = -1; ++e3 < r2; ) t3[e3]();
              r2 = h.length;
            }
            n = false;
          }
          l.exports = function(e3) {
            1 !== h.push(e3) || n || r();
          };
        }).call(this, "undefined" != typeof commonjsGlobal ? commonjsGlobal : "undefined" != typeof self ? self : "undefined" != typeof window ? window : {});
      }, {}], 37: [function(e, t, r) {
        var i = e("immediate");
        function u() {
        }
        var l = {}, s = ["REJECTED"], a = ["FULFILLED"], n = ["PENDING"];
        function o(e2) {
          if ("function" != typeof e2) throw new TypeError("resolver must be a function");
          this.state = n, this.queue = [], this.outcome = void 0, e2 !== u && d(this, e2);
        }
        function h(e2, t2, r2) {
          this.promise = e2, "function" == typeof t2 && (this.onFulfilled = t2, this.callFulfilled = this.otherCallFulfilled), "function" == typeof r2 && (this.onRejected = r2, this.callRejected = this.otherCallRejected);
        }
        function f(t2, r2, n2) {
          i(function() {
            var e2;
            try {
              e2 = r2(n2);
            } catch (e3) {
              return l.reject(t2, e3);
            }
            e2 === t2 ? l.reject(t2, new TypeError("Cannot resolve promise with itself")) : l.resolve(t2, e2);
          });
        }
        function c(e2) {
          var t2 = e2 && e2.then;
          if (e2 && ("object" == typeof e2 || "function" == typeof e2) && "function" == typeof t2) return function() {
            t2.apply(e2, arguments);
          };
        }
        function d(t2, e2) {
          var r2 = false;
          function n2(e3) {
            r2 || (r2 = true, l.reject(t2, e3));
          }
          function i2(e3) {
            r2 || (r2 = true, l.resolve(t2, e3));
          }
          var s2 = p(function() {
            e2(i2, n2);
          });
          "error" === s2.status && n2(s2.value);
        }
        function p(e2, t2) {
          var r2 = {};
          try {
            r2.value = e2(t2), r2.status = "success";
          } catch (e3) {
            r2.status = "error", r2.value = e3;
          }
          return r2;
        }
        (t.exports = o).prototype.finally = function(t2) {
          if ("function" != typeof t2) return this;
          var r2 = this.constructor;
          return this.then(function(e2) {
            return r2.resolve(t2()).then(function() {
              return e2;
            });
          }, function(e2) {
            return r2.resolve(t2()).then(function() {
              throw e2;
            });
          });
        }, o.prototype.catch = function(e2) {
          return this.then(null, e2);
        }, o.prototype.then = function(e2, t2) {
          if ("function" != typeof e2 && this.state === a || "function" != typeof t2 && this.state === s) return this;
          var r2 = new this.constructor(u);
          this.state !== n ? f(r2, this.state === a ? e2 : t2, this.outcome) : this.queue.push(new h(r2, e2, t2));
          return r2;
        }, h.prototype.callFulfilled = function(e2) {
          l.resolve(this.promise, e2);
        }, h.prototype.otherCallFulfilled = function(e2) {
          f(this.promise, this.onFulfilled, e2);
        }, h.prototype.callRejected = function(e2) {
          l.reject(this.promise, e2);
        }, h.prototype.otherCallRejected = function(e2) {
          f(this.promise, this.onRejected, e2);
        }, l.resolve = function(e2, t2) {
          var r2 = p(c, t2);
          if ("error" === r2.status) return l.reject(e2, r2.value);
          var n2 = r2.value;
          if (n2) d(e2, n2);
          else {
            e2.state = a, e2.outcome = t2;
            for (var i2 = -1, s2 = e2.queue.length; ++i2 < s2; ) e2.queue[i2].callFulfilled(t2);
          }
          return e2;
        }, l.reject = function(e2, t2) {
          e2.state = s, e2.outcome = t2;
          for (var r2 = -1, n2 = e2.queue.length; ++r2 < n2; ) e2.queue[r2].callRejected(t2);
          return e2;
        }, o.resolve = function(e2) {
          if (e2 instanceof this) return e2;
          return l.resolve(new this(u), e2);
        }, o.reject = function(e2) {
          var t2 = new this(u);
          return l.reject(t2, e2);
        }, o.all = function(e2) {
          var r2 = this;
          if ("[object Array]" !== Object.prototype.toString.call(e2)) return this.reject(new TypeError("must be an array"));
          var n2 = e2.length, i2 = false;
          if (!n2) return this.resolve([]);
          var s2 = new Array(n2), a2 = 0, t2 = -1, o2 = new this(u);
          for (; ++t2 < n2; ) h2(e2[t2], t2);
          return o2;
          function h2(e3, t3) {
            r2.resolve(e3).then(function(e4) {
              s2[t3] = e4, ++a2 !== n2 || i2 || (i2 = true, l.resolve(o2, s2));
            }, function(e4) {
              i2 || (i2 = true, l.reject(o2, e4));
            });
          }
        }, o.race = function(e2) {
          var t2 = this;
          if ("[object Array]" !== Object.prototype.toString.call(e2)) return this.reject(new TypeError("must be an array"));
          var r2 = e2.length, n2 = false;
          if (!r2) return this.resolve([]);
          var i2 = -1, s2 = new this(u);
          for (; ++i2 < r2; ) a2 = e2[i2], t2.resolve(a2).then(function(e3) {
            n2 || (n2 = true, l.resolve(s2, e3));
          }, function(e3) {
            n2 || (n2 = true, l.reject(s2, e3));
          });
          var a2;
          return s2;
        };
      }, { immediate: 36 }], 38: [function(e, t, r) {
        var n = {};
        (0, e("./lib/utils/common").assign)(n, e("./lib/deflate"), e("./lib/inflate"), e("./lib/zlib/constants")), t.exports = n;
      }, { "./lib/deflate": 39, "./lib/inflate": 40, "./lib/utils/common": 41, "./lib/zlib/constants": 44 }], 39: [function(e, t, r) {
        var a = e("./zlib/deflate"), o = e("./utils/common"), h = e("./utils/strings"), i = e("./zlib/messages"), s = e("./zlib/zstream"), u = Object.prototype.toString, l = 0, f = -1, c = 0, d = 8;
        function p(e2) {
          if (!(this instanceof p)) return new p(e2);
          this.options = o.assign({ level: f, method: d, chunkSize: 16384, windowBits: 15, memLevel: 8, strategy: c, to: "" }, e2 || {});
          var t2 = this.options;
          t2.raw && 0 < t2.windowBits ? t2.windowBits = -t2.windowBits : t2.gzip && 0 < t2.windowBits && t2.windowBits < 16 && (t2.windowBits += 16), this.err = 0, this.msg = "", this.ended = false, this.chunks = [], this.strm = new s(), this.strm.avail_out = 0;
          var r2 = a.deflateInit2(this.strm, t2.level, t2.method, t2.windowBits, t2.memLevel, t2.strategy);
          if (r2 !== l) throw new Error(i[r2]);
          if (t2.header && a.deflateSetHeader(this.strm, t2.header), t2.dictionary) {
            var n2;
            if (n2 = "string" == typeof t2.dictionary ? h.string2buf(t2.dictionary) : "[object ArrayBuffer]" === u.call(t2.dictionary) ? new Uint8Array(t2.dictionary) : t2.dictionary, (r2 = a.deflateSetDictionary(this.strm, n2)) !== l) throw new Error(i[r2]);
            this._dict_set = true;
          }
        }
        function n(e2, t2) {
          var r2 = new p(t2);
          if (r2.push(e2, true), r2.err) throw r2.msg || i[r2.err];
          return r2.result;
        }
        p.prototype.push = function(e2, t2) {
          var r2, n2, i2 = this.strm, s2 = this.options.chunkSize;
          if (this.ended) return false;
          n2 = t2 === ~~t2 ? t2 : true === t2 ? 4 : 0, "string" == typeof e2 ? i2.input = h.string2buf(e2) : "[object ArrayBuffer]" === u.call(e2) ? i2.input = new Uint8Array(e2) : i2.input = e2, i2.next_in = 0, i2.avail_in = i2.input.length;
          do {
            if (0 === i2.avail_out && (i2.output = new o.Buf8(s2), i2.next_out = 0, i2.avail_out = s2), 1 !== (r2 = a.deflate(i2, n2)) && r2 !== l) return this.onEnd(r2), !(this.ended = true);
            0 !== i2.avail_out && (0 !== i2.avail_in || 4 !== n2 && 2 !== n2) || ("string" === this.options.to ? this.onData(h.buf2binstring(o.shrinkBuf(i2.output, i2.next_out))) : this.onData(o.shrinkBuf(i2.output, i2.next_out)));
          } while ((0 < i2.avail_in || 0 === i2.avail_out) && 1 !== r2);
          return 4 === n2 ? (r2 = a.deflateEnd(this.strm), this.onEnd(r2), this.ended = true, r2 === l) : 2 !== n2 || (this.onEnd(l), !(i2.avail_out = 0));
        }, p.prototype.onData = function(e2) {
          this.chunks.push(e2);
        }, p.prototype.onEnd = function(e2) {
          e2 === l && ("string" === this.options.to ? this.result = this.chunks.join("") : this.result = o.flattenChunks(this.chunks)), this.chunks = [], this.err = e2, this.msg = this.strm.msg;
        }, r.Deflate = p, r.deflate = n, r.deflateRaw = function(e2, t2) {
          return (t2 = t2 || {}).raw = true, n(e2, t2);
        }, r.gzip = function(e2, t2) {
          return (t2 = t2 || {}).gzip = true, n(e2, t2);
        };
      }, { "./utils/common": 41, "./utils/strings": 42, "./zlib/deflate": 46, "./zlib/messages": 51, "./zlib/zstream": 53 }], 40: [function(e, t, r) {
        var c = e("./zlib/inflate"), d = e("./utils/common"), p = e("./utils/strings"), m = e("./zlib/constants"), n = e("./zlib/messages"), i = e("./zlib/zstream"), s = e("./zlib/gzheader"), _ = Object.prototype.toString;
        function a(e2) {
          if (!(this instanceof a)) return new a(e2);
          this.options = d.assign({ chunkSize: 16384, windowBits: 0, to: "" }, e2 || {});
          var t2 = this.options;
          t2.raw && 0 <= t2.windowBits && t2.windowBits < 16 && (t2.windowBits = -t2.windowBits, 0 === t2.windowBits && (t2.windowBits = -15)), !(0 <= t2.windowBits && t2.windowBits < 16) || e2 && e2.windowBits || (t2.windowBits += 32), 15 < t2.windowBits && t2.windowBits < 48 && 0 == (15 & t2.windowBits) && (t2.windowBits |= 15), this.err = 0, this.msg = "", this.ended = false, this.chunks = [], this.strm = new i(), this.strm.avail_out = 0;
          var r2 = c.inflateInit2(this.strm, t2.windowBits);
          if (r2 !== m.Z_OK) throw new Error(n[r2]);
          this.header = new s(), c.inflateGetHeader(this.strm, this.header);
        }
        function o(e2, t2) {
          var r2 = new a(t2);
          if (r2.push(e2, true), r2.err) throw r2.msg || n[r2.err];
          return r2.result;
        }
        a.prototype.push = function(e2, t2) {
          var r2, n2, i2, s2, a2, o2, h = this.strm, u = this.options.chunkSize, l = this.options.dictionary, f = false;
          if (this.ended) return false;
          n2 = t2 === ~~t2 ? t2 : true === t2 ? m.Z_FINISH : m.Z_NO_FLUSH, "string" == typeof e2 ? h.input = p.binstring2buf(e2) : "[object ArrayBuffer]" === _.call(e2) ? h.input = new Uint8Array(e2) : h.input = e2, h.next_in = 0, h.avail_in = h.input.length;
          do {
            if (0 === h.avail_out && (h.output = new d.Buf8(u), h.next_out = 0, h.avail_out = u), (r2 = c.inflate(h, m.Z_NO_FLUSH)) === m.Z_NEED_DICT && l && (o2 = "string" == typeof l ? p.string2buf(l) : "[object ArrayBuffer]" === _.call(l) ? new Uint8Array(l) : l, r2 = c.inflateSetDictionary(this.strm, o2)), r2 === m.Z_BUF_ERROR && true === f && (r2 = m.Z_OK, f = false), r2 !== m.Z_STREAM_END && r2 !== m.Z_OK) return this.onEnd(r2), !(this.ended = true);
            h.next_out && (0 !== h.avail_out && r2 !== m.Z_STREAM_END && (0 !== h.avail_in || n2 !== m.Z_FINISH && n2 !== m.Z_SYNC_FLUSH) || ("string" === this.options.to ? (i2 = p.utf8border(h.output, h.next_out), s2 = h.next_out - i2, a2 = p.buf2string(h.output, i2), h.next_out = s2, h.avail_out = u - s2, s2 && d.arraySet(h.output, h.output, i2, s2, 0), this.onData(a2)) : this.onData(d.shrinkBuf(h.output, h.next_out)))), 0 === h.avail_in && 0 === h.avail_out && (f = true);
          } while ((0 < h.avail_in || 0 === h.avail_out) && r2 !== m.Z_STREAM_END);
          return r2 === m.Z_STREAM_END && (n2 = m.Z_FINISH), n2 === m.Z_FINISH ? (r2 = c.inflateEnd(this.strm), this.onEnd(r2), this.ended = true, r2 === m.Z_OK) : n2 !== m.Z_SYNC_FLUSH || (this.onEnd(m.Z_OK), !(h.avail_out = 0));
        }, a.prototype.onData = function(e2) {
          this.chunks.push(e2);
        }, a.prototype.onEnd = function(e2) {
          e2 === m.Z_OK && ("string" === this.options.to ? this.result = this.chunks.join("") : this.result = d.flattenChunks(this.chunks)), this.chunks = [], this.err = e2, this.msg = this.strm.msg;
        }, r.Inflate = a, r.inflate = o, r.inflateRaw = function(e2, t2) {
          return (t2 = t2 || {}).raw = true, o(e2, t2);
        }, r.ungzip = o;
      }, { "./utils/common": 41, "./utils/strings": 42, "./zlib/constants": 44, "./zlib/gzheader": 47, "./zlib/inflate": 49, "./zlib/messages": 51, "./zlib/zstream": 53 }], 41: [function(e, t, r) {
        var n = "undefined" != typeof Uint8Array && "undefined" != typeof Uint16Array && "undefined" != typeof Int32Array;
        r.assign = function(e2) {
          for (var t2 = Array.prototype.slice.call(arguments, 1); t2.length; ) {
            var r2 = t2.shift();
            if (r2) {
              if ("object" != typeof r2) throw new TypeError(r2 + "must be non-object");
              for (var n2 in r2) r2.hasOwnProperty(n2) && (e2[n2] = r2[n2]);
            }
          }
          return e2;
        }, r.shrinkBuf = function(e2, t2) {
          return e2.length === t2 ? e2 : e2.subarray ? e2.subarray(0, t2) : (e2.length = t2, e2);
        };
        var i = { arraySet: function(e2, t2, r2, n2, i2) {
          if (t2.subarray && e2.subarray) e2.set(t2.subarray(r2, r2 + n2), i2);
          else for (var s2 = 0; s2 < n2; s2++) e2[i2 + s2] = t2[r2 + s2];
        }, flattenChunks: function(e2) {
          var t2, r2, n2, i2, s2, a;
          for (t2 = n2 = 0, r2 = e2.length; t2 < r2; t2++) n2 += e2[t2].length;
          for (a = new Uint8Array(n2), t2 = i2 = 0, r2 = e2.length; t2 < r2; t2++) s2 = e2[t2], a.set(s2, i2), i2 += s2.length;
          return a;
        } }, s = { arraySet: function(e2, t2, r2, n2, i2) {
          for (var s2 = 0; s2 < n2; s2++) e2[i2 + s2] = t2[r2 + s2];
        }, flattenChunks: function(e2) {
          return [].concat.apply([], e2);
        } };
        r.setTyped = function(e2) {
          e2 ? (r.Buf8 = Uint8Array, r.Buf16 = Uint16Array, r.Buf32 = Int32Array, r.assign(r, i)) : (r.Buf8 = Array, r.Buf16 = Array, r.Buf32 = Array, r.assign(r, s));
        }, r.setTyped(n);
      }, {}], 42: [function(e, t, r) {
        var h = e("./common"), i = true, s = true;
        try {
          String.fromCharCode.apply(null, [0]);
        } catch (e2) {
          i = false;
        }
        try {
          String.fromCharCode.apply(null, new Uint8Array(1));
        } catch (e2) {
          s = false;
        }
        for (var u = new h.Buf8(256), n = 0; n < 256; n++) u[n] = 252 <= n ? 6 : 248 <= n ? 5 : 240 <= n ? 4 : 224 <= n ? 3 : 192 <= n ? 2 : 1;
        function l(e2, t2) {
          if (t2 < 65537 && (e2.subarray && s || !e2.subarray && i)) return String.fromCharCode.apply(null, h.shrinkBuf(e2, t2));
          for (var r2 = "", n2 = 0; n2 < t2; n2++) r2 += String.fromCharCode(e2[n2]);
          return r2;
        }
        u[254] = u[254] = 1, r.string2buf = function(e2) {
          var t2, r2, n2, i2, s2, a = e2.length, o = 0;
          for (i2 = 0; i2 < a; i2++) 55296 == (64512 & (r2 = e2.charCodeAt(i2))) && i2 + 1 < a && 56320 == (64512 & (n2 = e2.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), o += r2 < 128 ? 1 : r2 < 2048 ? 2 : r2 < 65536 ? 3 : 4;
          for (t2 = new h.Buf8(o), i2 = s2 = 0; s2 < o; i2++) 55296 == (64512 & (r2 = e2.charCodeAt(i2))) && i2 + 1 < a && 56320 == (64512 & (n2 = e2.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), r2 < 128 ? t2[s2++] = r2 : (r2 < 2048 ? t2[s2++] = 192 | r2 >>> 6 : (r2 < 65536 ? t2[s2++] = 224 | r2 >>> 12 : (t2[s2++] = 240 | r2 >>> 18, t2[s2++] = 128 | r2 >>> 12 & 63), t2[s2++] = 128 | r2 >>> 6 & 63), t2[s2++] = 128 | 63 & r2);
          return t2;
        }, r.buf2binstring = function(e2) {
          return l(e2, e2.length);
        }, r.binstring2buf = function(e2) {
          for (var t2 = new h.Buf8(e2.length), r2 = 0, n2 = t2.length; r2 < n2; r2++) t2[r2] = e2.charCodeAt(r2);
          return t2;
        }, r.buf2string = function(e2, t2) {
          var r2, n2, i2, s2, a = t2 || e2.length, o = new Array(2 * a);
          for (r2 = n2 = 0; r2 < a; ) if ((i2 = e2[r2++]) < 128) o[n2++] = i2;
          else if (4 < (s2 = u[i2])) o[n2++] = 65533, r2 += s2 - 1;
          else {
            for (i2 &= 2 === s2 ? 31 : 3 === s2 ? 15 : 7; 1 < s2 && r2 < a; ) i2 = i2 << 6 | 63 & e2[r2++], s2--;
            1 < s2 ? o[n2++] = 65533 : i2 < 65536 ? o[n2++] = i2 : (i2 -= 65536, o[n2++] = 55296 | i2 >> 10 & 1023, o[n2++] = 56320 | 1023 & i2);
          }
          return l(o, n2);
        }, r.utf8border = function(e2, t2) {
          var r2;
          for ((t2 = t2 || e2.length) > e2.length && (t2 = e2.length), r2 = t2 - 1; 0 <= r2 && 128 == (192 & e2[r2]); ) r2--;
          return r2 < 0 ? t2 : 0 === r2 ? t2 : r2 + u[e2[r2]] > t2 ? r2 : t2;
        };
      }, { "./common": 41 }], 43: [function(e, t, r) {
        t.exports = function(e2, t2, r2, n) {
          for (var i = 65535 & e2 | 0, s = e2 >>> 16 & 65535 | 0, a = 0; 0 !== r2; ) {
            for (r2 -= a = 2e3 < r2 ? 2e3 : r2; s = s + (i = i + t2[n++] | 0) | 0, --a; ) ;
            i %= 65521, s %= 65521;
          }
          return i | s << 16 | 0;
        };
      }, {}], 44: [function(e, t, r) {
        t.exports = { Z_NO_FLUSH: 0, Z_PARTIAL_FLUSH: 1, Z_SYNC_FLUSH: 2, Z_FULL_FLUSH: 3, Z_FINISH: 4, Z_BLOCK: 5, Z_TREES: 6, Z_OK: 0, Z_STREAM_END: 1, Z_NEED_DICT: 2, Z_ERRNO: -1, Z_STREAM_ERROR: -2, Z_DATA_ERROR: -3, Z_BUF_ERROR: -5, Z_NO_COMPRESSION: 0, Z_BEST_SPEED: 1, Z_BEST_COMPRESSION: 9, Z_DEFAULT_COMPRESSION: -1, Z_FILTERED: 1, Z_HUFFMAN_ONLY: 2, Z_RLE: 3, Z_FIXED: 4, Z_DEFAULT_STRATEGY: 0, Z_BINARY: 0, Z_TEXT: 1, Z_UNKNOWN: 2, Z_DEFLATED: 8 };
      }, {}], 45: [function(e, t, r) {
        var o = (function() {
          for (var e2, t2 = [], r2 = 0; r2 < 256; r2++) {
            e2 = r2;
            for (var n = 0; n < 8; n++) e2 = 1 & e2 ? 3988292384 ^ e2 >>> 1 : e2 >>> 1;
            t2[r2] = e2;
          }
          return t2;
        })();
        t.exports = function(e2, t2, r2, n) {
          var i = o, s = n + r2;
          e2 ^= -1;
          for (var a = n; a < s; a++) e2 = e2 >>> 8 ^ i[255 & (e2 ^ t2[a])];
          return -1 ^ e2;
        };
      }, {}], 46: [function(e, t, r) {
        var h, c = e("../utils/common"), u = e("./trees"), d = e("./adler32"), p = e("./crc32"), n = e("./messages"), l = 0, f = 4, m = 0, _ = -2, g = -1, b = 4, i = 2, v = 8, y = 9, s = 286, a = 30, o = 19, w = 2 * s + 1, k = 15, x = 3, S = 258, z = S + x + 1, C = 42, E = 113, A = 1, I = 2, O = 3, B = 4;
        function R(e2, t2) {
          return e2.msg = n[t2], t2;
        }
        function T(e2) {
          return (e2 << 1) - (4 < e2 ? 9 : 0);
        }
        function D(e2) {
          for (var t2 = e2.length; 0 <= --t2; ) e2[t2] = 0;
        }
        function F(e2) {
          var t2 = e2.state, r2 = t2.pending;
          r2 > e2.avail_out && (r2 = e2.avail_out), 0 !== r2 && (c.arraySet(e2.output, t2.pending_buf, t2.pending_out, r2, e2.next_out), e2.next_out += r2, t2.pending_out += r2, e2.total_out += r2, e2.avail_out -= r2, t2.pending -= r2, 0 === t2.pending && (t2.pending_out = 0));
        }
        function N(e2, t2) {
          u._tr_flush_block(e2, 0 <= e2.block_start ? e2.block_start : -1, e2.strstart - e2.block_start, t2), e2.block_start = e2.strstart, F(e2.strm);
        }
        function U(e2, t2) {
          e2.pending_buf[e2.pending++] = t2;
        }
        function P(e2, t2) {
          e2.pending_buf[e2.pending++] = t2 >>> 8 & 255, e2.pending_buf[e2.pending++] = 255 & t2;
        }
        function L(e2, t2) {
          var r2, n2, i2 = e2.max_chain_length, s2 = e2.strstart, a2 = e2.prev_length, o2 = e2.nice_match, h2 = e2.strstart > e2.w_size - z ? e2.strstart - (e2.w_size - z) : 0, u2 = e2.window, l2 = e2.w_mask, f2 = e2.prev, c2 = e2.strstart + S, d2 = u2[s2 + a2 - 1], p2 = u2[s2 + a2];
          e2.prev_length >= e2.good_match && (i2 >>= 2), o2 > e2.lookahead && (o2 = e2.lookahead);
          do {
            if (u2[(r2 = t2) + a2] === p2 && u2[r2 + a2 - 1] === d2 && u2[r2] === u2[s2] && u2[++r2] === u2[s2 + 1]) {
              s2 += 2, r2++;
              do {
              } while (u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && u2[++s2] === u2[++r2] && s2 < c2);
              if (n2 = S - (c2 - s2), s2 = c2 - S, a2 < n2) {
                if (e2.match_start = t2, o2 <= (a2 = n2)) break;
                d2 = u2[s2 + a2 - 1], p2 = u2[s2 + a2];
              }
            }
          } while ((t2 = f2[t2 & l2]) > h2 && 0 != --i2);
          return a2 <= e2.lookahead ? a2 : e2.lookahead;
        }
        function j(e2) {
          var t2, r2, n2, i2, s2, a2, o2, h2, u2, l2, f2 = e2.w_size;
          do {
            if (i2 = e2.window_size - e2.lookahead - e2.strstart, e2.strstart >= f2 + (f2 - z)) {
              for (c.arraySet(e2.window, e2.window, f2, f2, 0), e2.match_start -= f2, e2.strstart -= f2, e2.block_start -= f2, t2 = r2 = e2.hash_size; n2 = e2.head[--t2], e2.head[t2] = f2 <= n2 ? n2 - f2 : 0, --r2; ) ;
              for (t2 = r2 = f2; n2 = e2.prev[--t2], e2.prev[t2] = f2 <= n2 ? n2 - f2 : 0, --r2; ) ;
              i2 += f2;
            }
            if (0 === e2.strm.avail_in) break;
            if (a2 = e2.strm, o2 = e2.window, h2 = e2.strstart + e2.lookahead, u2 = i2, l2 = void 0, l2 = a2.avail_in, u2 < l2 && (l2 = u2), r2 = 0 === l2 ? 0 : (a2.avail_in -= l2, c.arraySet(o2, a2.input, a2.next_in, l2, h2), 1 === a2.state.wrap ? a2.adler = d(a2.adler, o2, l2, h2) : 2 === a2.state.wrap && (a2.adler = p(a2.adler, o2, l2, h2)), a2.next_in += l2, a2.total_in += l2, l2), e2.lookahead += r2, e2.lookahead + e2.insert >= x) for (s2 = e2.strstart - e2.insert, e2.ins_h = e2.window[s2], e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[s2 + 1]) & e2.hash_mask; e2.insert && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[s2 + x - 1]) & e2.hash_mask, e2.prev[s2 & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = s2, s2++, e2.insert--, !(e2.lookahead + e2.insert < x)); ) ;
          } while (e2.lookahead < z && 0 !== e2.strm.avail_in);
        }
        function Z(e2, t2) {
          for (var r2, n2; ; ) {
            if (e2.lookahead < z) {
              if (j(e2), e2.lookahead < z && t2 === l) return A;
              if (0 === e2.lookahead) break;
            }
            if (r2 = 0, e2.lookahead >= x && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart), 0 !== r2 && e2.strstart - r2 <= e2.w_size - z && (e2.match_length = L(e2, r2)), e2.match_length >= x) if (n2 = u._tr_tally(e2, e2.strstart - e2.match_start, e2.match_length - x), e2.lookahead -= e2.match_length, e2.match_length <= e2.max_lazy_match && e2.lookahead >= x) {
              for (e2.match_length--; e2.strstart++, e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart, 0 != --e2.match_length; ) ;
              e2.strstart++;
            } else e2.strstart += e2.match_length, e2.match_length = 0, e2.ins_h = e2.window[e2.strstart], e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + 1]) & e2.hash_mask;
            else n2 = u._tr_tally(e2, 0, e2.window[e2.strstart]), e2.lookahead--, e2.strstart++;
            if (n2 && (N(e2, false), 0 === e2.strm.avail_out)) return A;
          }
          return e2.insert = e2.strstart < x - 1 ? e2.strstart : x - 1, t2 === f ? (N(e2, true), 0 === e2.strm.avail_out ? O : B) : e2.last_lit && (N(e2, false), 0 === e2.strm.avail_out) ? A : I;
        }
        function W(e2, t2) {
          for (var r2, n2, i2; ; ) {
            if (e2.lookahead < z) {
              if (j(e2), e2.lookahead < z && t2 === l) return A;
              if (0 === e2.lookahead) break;
            }
            if (r2 = 0, e2.lookahead >= x && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart), e2.prev_length = e2.match_length, e2.prev_match = e2.match_start, e2.match_length = x - 1, 0 !== r2 && e2.prev_length < e2.max_lazy_match && e2.strstart - r2 <= e2.w_size - z && (e2.match_length = L(e2, r2), e2.match_length <= 5 && (1 === e2.strategy || e2.match_length === x && 4096 < e2.strstart - e2.match_start) && (e2.match_length = x - 1)), e2.prev_length >= x && e2.match_length <= e2.prev_length) {
              for (i2 = e2.strstart + e2.lookahead - x, n2 = u._tr_tally(e2, e2.strstart - 1 - e2.prev_match, e2.prev_length - x), e2.lookahead -= e2.prev_length - 1, e2.prev_length -= 2; ++e2.strstart <= i2 && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart), 0 != --e2.prev_length; ) ;
              if (e2.match_available = 0, e2.match_length = x - 1, e2.strstart++, n2 && (N(e2, false), 0 === e2.strm.avail_out)) return A;
            } else if (e2.match_available) {
              if ((n2 = u._tr_tally(e2, 0, e2.window[e2.strstart - 1])) && N(e2, false), e2.strstart++, e2.lookahead--, 0 === e2.strm.avail_out) return A;
            } else e2.match_available = 1, e2.strstart++, e2.lookahead--;
          }
          return e2.match_available && (n2 = u._tr_tally(e2, 0, e2.window[e2.strstart - 1]), e2.match_available = 0), e2.insert = e2.strstart < x - 1 ? e2.strstart : x - 1, t2 === f ? (N(e2, true), 0 === e2.strm.avail_out ? O : B) : e2.last_lit && (N(e2, false), 0 === e2.strm.avail_out) ? A : I;
        }
        function M(e2, t2, r2, n2, i2) {
          this.good_length = e2, this.max_lazy = t2, this.nice_length = r2, this.max_chain = n2, this.func = i2;
        }
        function H() {
          this.strm = null, this.status = 0, this.pending_buf = null, this.pending_buf_size = 0, this.pending_out = 0, this.pending = 0, this.wrap = 0, this.gzhead = null, this.gzindex = 0, this.method = v, this.last_flush = -1, this.w_size = 0, this.w_bits = 0, this.w_mask = 0, this.window = null, this.window_size = 0, this.prev = null, this.head = null, this.ins_h = 0, this.hash_size = 0, this.hash_bits = 0, this.hash_mask = 0, this.hash_shift = 0, this.block_start = 0, this.match_length = 0, this.prev_match = 0, this.match_available = 0, this.strstart = 0, this.match_start = 0, this.lookahead = 0, this.prev_length = 0, this.max_chain_length = 0, this.max_lazy_match = 0, this.level = 0, this.strategy = 0, this.good_match = 0, this.nice_match = 0, this.dyn_ltree = new c.Buf16(2 * w), this.dyn_dtree = new c.Buf16(2 * (2 * a + 1)), this.bl_tree = new c.Buf16(2 * (2 * o + 1)), D(this.dyn_ltree), D(this.dyn_dtree), D(this.bl_tree), this.l_desc = null, this.d_desc = null, this.bl_desc = null, this.bl_count = new c.Buf16(k + 1), this.heap = new c.Buf16(2 * s + 1), D(this.heap), this.heap_len = 0, this.heap_max = 0, this.depth = new c.Buf16(2 * s + 1), D(this.depth), this.l_buf = 0, this.lit_bufsize = 0, this.last_lit = 0, this.d_buf = 0, this.opt_len = 0, this.static_len = 0, this.matches = 0, this.insert = 0, this.bi_buf = 0, this.bi_valid = 0;
        }
        function G(e2) {
          var t2;
          return e2 && e2.state ? (e2.total_in = e2.total_out = 0, e2.data_type = i, (t2 = e2.state).pending = 0, t2.pending_out = 0, t2.wrap < 0 && (t2.wrap = -t2.wrap), t2.status = t2.wrap ? C : E, e2.adler = 2 === t2.wrap ? 0 : 1, t2.last_flush = l, u._tr_init(t2), m) : R(e2, _);
        }
        function K(e2) {
          var t2 = G(e2);
          return t2 === m && (function(e3) {
            e3.window_size = 2 * e3.w_size, D(e3.head), e3.max_lazy_match = h[e3.level].max_lazy, e3.good_match = h[e3.level].good_length, e3.nice_match = h[e3.level].nice_length, e3.max_chain_length = h[e3.level].max_chain, e3.strstart = 0, e3.block_start = 0, e3.lookahead = 0, e3.insert = 0, e3.match_length = e3.prev_length = x - 1, e3.match_available = 0, e3.ins_h = 0;
          })(e2.state), t2;
        }
        function Y(e2, t2, r2, n2, i2, s2) {
          if (!e2) return _;
          var a2 = 1;
          if (t2 === g && (t2 = 6), n2 < 0 ? (a2 = 0, n2 = -n2) : 15 < n2 && (a2 = 2, n2 -= 16), i2 < 1 || y < i2 || r2 !== v || n2 < 8 || 15 < n2 || t2 < 0 || 9 < t2 || s2 < 0 || b < s2) return R(e2, _);
          8 === n2 && (n2 = 9);
          var o2 = new H();
          return (e2.state = o2).strm = e2, o2.wrap = a2, o2.gzhead = null, o2.w_bits = n2, o2.w_size = 1 << o2.w_bits, o2.w_mask = o2.w_size - 1, o2.hash_bits = i2 + 7, o2.hash_size = 1 << o2.hash_bits, o2.hash_mask = o2.hash_size - 1, o2.hash_shift = ~~((o2.hash_bits + x - 1) / x), o2.window = new c.Buf8(2 * o2.w_size), o2.head = new c.Buf16(o2.hash_size), o2.prev = new c.Buf16(o2.w_size), o2.lit_bufsize = 1 << i2 + 6, o2.pending_buf_size = 4 * o2.lit_bufsize, o2.pending_buf = new c.Buf8(o2.pending_buf_size), o2.d_buf = 1 * o2.lit_bufsize, o2.l_buf = 3 * o2.lit_bufsize, o2.level = t2, o2.strategy = s2, o2.method = r2, K(e2);
        }
        h = [new M(0, 0, 0, 0, function(e2, t2) {
          var r2 = 65535;
          for (r2 > e2.pending_buf_size - 5 && (r2 = e2.pending_buf_size - 5); ; ) {
            if (e2.lookahead <= 1) {
              if (j(e2), 0 === e2.lookahead && t2 === l) return A;
              if (0 === e2.lookahead) break;
            }
            e2.strstart += e2.lookahead, e2.lookahead = 0;
            var n2 = e2.block_start + r2;
            if ((0 === e2.strstart || e2.strstart >= n2) && (e2.lookahead = e2.strstart - n2, e2.strstart = n2, N(e2, false), 0 === e2.strm.avail_out)) return A;
            if (e2.strstart - e2.block_start >= e2.w_size - z && (N(e2, false), 0 === e2.strm.avail_out)) return A;
          }
          return e2.insert = 0, t2 === f ? (N(e2, true), 0 === e2.strm.avail_out ? O : B) : (e2.strstart > e2.block_start && (N(e2, false), e2.strm.avail_out), A);
        }), new M(4, 4, 8, 4, Z), new M(4, 5, 16, 8, Z), new M(4, 6, 32, 32, Z), new M(4, 4, 16, 16, W), new M(8, 16, 32, 32, W), new M(8, 16, 128, 128, W), new M(8, 32, 128, 256, W), new M(32, 128, 258, 1024, W), new M(32, 258, 258, 4096, W)], r.deflateInit = function(e2, t2) {
          return Y(e2, t2, v, 15, 8, 0);
        }, r.deflateInit2 = Y, r.deflateReset = K, r.deflateResetKeep = G, r.deflateSetHeader = function(e2, t2) {
          return e2 && e2.state ? 2 !== e2.state.wrap ? _ : (e2.state.gzhead = t2, m) : _;
        }, r.deflate = function(e2, t2) {
          var r2, n2, i2, s2;
          if (!e2 || !e2.state || 5 < t2 || t2 < 0) return e2 ? R(e2, _) : _;
          if (n2 = e2.state, !e2.output || !e2.input && 0 !== e2.avail_in || 666 === n2.status && t2 !== f) return R(e2, 0 === e2.avail_out ? -5 : _);
          if (n2.strm = e2, r2 = n2.last_flush, n2.last_flush = t2, n2.status === C) if (2 === n2.wrap) e2.adler = 0, U(n2, 31), U(n2, 139), U(n2, 8), n2.gzhead ? (U(n2, (n2.gzhead.text ? 1 : 0) + (n2.gzhead.hcrc ? 2 : 0) + (n2.gzhead.extra ? 4 : 0) + (n2.gzhead.name ? 8 : 0) + (n2.gzhead.comment ? 16 : 0)), U(n2, 255 & n2.gzhead.time), U(n2, n2.gzhead.time >> 8 & 255), U(n2, n2.gzhead.time >> 16 & 255), U(n2, n2.gzhead.time >> 24 & 255), U(n2, 9 === n2.level ? 2 : 2 <= n2.strategy || n2.level < 2 ? 4 : 0), U(n2, 255 & n2.gzhead.os), n2.gzhead.extra && n2.gzhead.extra.length && (U(n2, 255 & n2.gzhead.extra.length), U(n2, n2.gzhead.extra.length >> 8 & 255)), n2.gzhead.hcrc && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending, 0)), n2.gzindex = 0, n2.status = 69) : (U(n2, 0), U(n2, 0), U(n2, 0), U(n2, 0), U(n2, 0), U(n2, 9 === n2.level ? 2 : 2 <= n2.strategy || n2.level < 2 ? 4 : 0), U(n2, 3), n2.status = E);
          else {
            var a2 = v + (n2.w_bits - 8 << 4) << 8;
            a2 |= (2 <= n2.strategy || n2.level < 2 ? 0 : n2.level < 6 ? 1 : 6 === n2.level ? 2 : 3) << 6, 0 !== n2.strstart && (a2 |= 32), a2 += 31 - a2 % 31, n2.status = E, P(n2, a2), 0 !== n2.strstart && (P(n2, e2.adler >>> 16), P(n2, 65535 & e2.adler)), e2.adler = 1;
          }
          if (69 === n2.status) if (n2.gzhead.extra) {
            for (i2 = n2.pending; n2.gzindex < (65535 & n2.gzhead.extra.length) && (n2.pending !== n2.pending_buf_size || (n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), F(e2), i2 = n2.pending, n2.pending !== n2.pending_buf_size)); ) U(n2, 255 & n2.gzhead.extra[n2.gzindex]), n2.gzindex++;
            n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), n2.gzindex === n2.gzhead.extra.length && (n2.gzindex = 0, n2.status = 73);
          } else n2.status = 73;
          if (73 === n2.status) if (n2.gzhead.name) {
            i2 = n2.pending;
            do {
              if (n2.pending === n2.pending_buf_size && (n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), F(e2), i2 = n2.pending, n2.pending === n2.pending_buf_size)) {
                s2 = 1;
                break;
              }
              s2 = n2.gzindex < n2.gzhead.name.length ? 255 & n2.gzhead.name.charCodeAt(n2.gzindex++) : 0, U(n2, s2);
            } while (0 !== s2);
            n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), 0 === s2 && (n2.gzindex = 0, n2.status = 91);
          } else n2.status = 91;
          if (91 === n2.status) if (n2.gzhead.comment) {
            i2 = n2.pending;
            do {
              if (n2.pending === n2.pending_buf_size && (n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), F(e2), i2 = n2.pending, n2.pending === n2.pending_buf_size)) {
                s2 = 1;
                break;
              }
              s2 = n2.gzindex < n2.gzhead.comment.length ? 255 & n2.gzhead.comment.charCodeAt(n2.gzindex++) : 0, U(n2, s2);
            } while (0 !== s2);
            n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), 0 === s2 && (n2.status = 103);
          } else n2.status = 103;
          if (103 === n2.status && (n2.gzhead.hcrc ? (n2.pending + 2 > n2.pending_buf_size && F(e2), n2.pending + 2 <= n2.pending_buf_size && (U(n2, 255 & e2.adler), U(n2, e2.adler >> 8 & 255), e2.adler = 0, n2.status = E)) : n2.status = E), 0 !== n2.pending) {
            if (F(e2), 0 === e2.avail_out) return n2.last_flush = -1, m;
          } else if (0 === e2.avail_in && T(t2) <= T(r2) && t2 !== f) return R(e2, -5);
          if (666 === n2.status && 0 !== e2.avail_in) return R(e2, -5);
          if (0 !== e2.avail_in || 0 !== n2.lookahead || t2 !== l && 666 !== n2.status) {
            var o2 = 2 === n2.strategy ? (function(e3, t3) {
              for (var r3; ; ) {
                if (0 === e3.lookahead && (j(e3), 0 === e3.lookahead)) {
                  if (t3 === l) return A;
                  break;
                }
                if (e3.match_length = 0, r3 = u._tr_tally(e3, 0, e3.window[e3.strstart]), e3.lookahead--, e3.strstart++, r3 && (N(e3, false), 0 === e3.strm.avail_out)) return A;
              }
              return e3.insert = 0, t3 === f ? (N(e3, true), 0 === e3.strm.avail_out ? O : B) : e3.last_lit && (N(e3, false), 0 === e3.strm.avail_out) ? A : I;
            })(n2, t2) : 3 === n2.strategy ? (function(e3, t3) {
              for (var r3, n3, i3, s3, a3 = e3.window; ; ) {
                if (e3.lookahead <= S) {
                  if (j(e3), e3.lookahead <= S && t3 === l) return A;
                  if (0 === e3.lookahead) break;
                }
                if (e3.match_length = 0, e3.lookahead >= x && 0 < e3.strstart && (n3 = a3[i3 = e3.strstart - 1]) === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3]) {
                  s3 = e3.strstart + S;
                  do {
                  } while (n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && i3 < s3);
                  e3.match_length = S - (s3 - i3), e3.match_length > e3.lookahead && (e3.match_length = e3.lookahead);
                }
                if (e3.match_length >= x ? (r3 = u._tr_tally(e3, 1, e3.match_length - x), e3.lookahead -= e3.match_length, e3.strstart += e3.match_length, e3.match_length = 0) : (r3 = u._tr_tally(e3, 0, e3.window[e3.strstart]), e3.lookahead--, e3.strstart++), r3 && (N(e3, false), 0 === e3.strm.avail_out)) return A;
              }
              return e3.insert = 0, t3 === f ? (N(e3, true), 0 === e3.strm.avail_out ? O : B) : e3.last_lit && (N(e3, false), 0 === e3.strm.avail_out) ? A : I;
            })(n2, t2) : h[n2.level].func(n2, t2);
            if (o2 !== O && o2 !== B || (n2.status = 666), o2 === A || o2 === O) return 0 === e2.avail_out && (n2.last_flush = -1), m;
            if (o2 === I && (1 === t2 ? u._tr_align(n2) : 5 !== t2 && (u._tr_stored_block(n2, 0, 0, false), 3 === t2 && (D(n2.head), 0 === n2.lookahead && (n2.strstart = 0, n2.block_start = 0, n2.insert = 0))), F(e2), 0 === e2.avail_out)) return n2.last_flush = -1, m;
          }
          return t2 !== f ? m : n2.wrap <= 0 ? 1 : (2 === n2.wrap ? (U(n2, 255 & e2.adler), U(n2, e2.adler >> 8 & 255), U(n2, e2.adler >> 16 & 255), U(n2, e2.adler >> 24 & 255), U(n2, 255 & e2.total_in), U(n2, e2.total_in >> 8 & 255), U(n2, e2.total_in >> 16 & 255), U(n2, e2.total_in >> 24 & 255)) : (P(n2, e2.adler >>> 16), P(n2, 65535 & e2.adler)), F(e2), 0 < n2.wrap && (n2.wrap = -n2.wrap), 0 !== n2.pending ? m : 1);
        }, r.deflateEnd = function(e2) {
          var t2;
          return e2 && e2.state ? (t2 = e2.state.status) !== C && 69 !== t2 && 73 !== t2 && 91 !== t2 && 103 !== t2 && t2 !== E && 666 !== t2 ? R(e2, _) : (e2.state = null, t2 === E ? R(e2, -3) : m) : _;
        }, r.deflateSetDictionary = function(e2, t2) {
          var r2, n2, i2, s2, a2, o2, h2, u2, l2 = t2.length;
          if (!e2 || !e2.state) return _;
          if (2 === (s2 = (r2 = e2.state).wrap) || 1 === s2 && r2.status !== C || r2.lookahead) return _;
          for (1 === s2 && (e2.adler = d(e2.adler, t2, l2, 0)), r2.wrap = 0, l2 >= r2.w_size && (0 === s2 && (D(r2.head), r2.strstart = 0, r2.block_start = 0, r2.insert = 0), u2 = new c.Buf8(r2.w_size), c.arraySet(u2, t2, l2 - r2.w_size, r2.w_size, 0), t2 = u2, l2 = r2.w_size), a2 = e2.avail_in, o2 = e2.next_in, h2 = e2.input, e2.avail_in = l2, e2.next_in = 0, e2.input = t2, j(r2); r2.lookahead >= x; ) {
            for (n2 = r2.strstart, i2 = r2.lookahead - (x - 1); r2.ins_h = (r2.ins_h << r2.hash_shift ^ r2.window[n2 + x - 1]) & r2.hash_mask, r2.prev[n2 & r2.w_mask] = r2.head[r2.ins_h], r2.head[r2.ins_h] = n2, n2++, --i2; ) ;
            r2.strstart = n2, r2.lookahead = x - 1, j(r2);
          }
          return r2.strstart += r2.lookahead, r2.block_start = r2.strstart, r2.insert = r2.lookahead, r2.lookahead = 0, r2.match_length = r2.prev_length = x - 1, r2.match_available = 0, e2.next_in = o2, e2.input = h2, e2.avail_in = a2, r2.wrap = s2, m;
        }, r.deflateInfo = "pako deflate (from Nodeca project)";
      }, { "../utils/common": 41, "./adler32": 43, "./crc32": 45, "./messages": 51, "./trees": 52 }], 47: [function(e, t, r) {
        t.exports = function() {
          this.text = 0, this.time = 0, this.xflags = 0, this.os = 0, this.extra = null, this.extra_len = 0, this.name = "", this.comment = "", this.hcrc = 0, this.done = false;
        };
      }, {}], 48: [function(e, t, r) {
        t.exports = function(e2, t2) {
          var r2, n, i, s, a, o, h, u, l, f, c, d, p, m, _, g, b, v, y, w, k, x, S, z, C;
          r2 = e2.state, n = e2.next_in, z = e2.input, i = n + (e2.avail_in - 5), s = e2.next_out, C = e2.output, a = s - (t2 - e2.avail_out), o = s + (e2.avail_out - 257), h = r2.dmax, u = r2.wsize, l = r2.whave, f = r2.wnext, c = r2.window, d = r2.hold, p = r2.bits, m = r2.lencode, _ = r2.distcode, g = (1 << r2.lenbits) - 1, b = (1 << r2.distbits) - 1;
          e: do {
            p < 15 && (d += z[n++] << p, p += 8, d += z[n++] << p, p += 8), v = m[d & g];
            t: for (; ; ) {
              if (d >>>= y = v >>> 24, p -= y, 0 === (y = v >>> 16 & 255)) C[s++] = 65535 & v;
              else {
                if (!(16 & y)) {
                  if (0 == (64 & y)) {
                    v = m[(65535 & v) + (d & (1 << y) - 1)];
                    continue t;
                  }
                  if (32 & y) {
                    r2.mode = 12;
                    break e;
                  }
                  e2.msg = "invalid literal/length code", r2.mode = 30;
                  break e;
                }
                w = 65535 & v, (y &= 15) && (p < y && (d += z[n++] << p, p += 8), w += d & (1 << y) - 1, d >>>= y, p -= y), p < 15 && (d += z[n++] << p, p += 8, d += z[n++] << p, p += 8), v = _[d & b];
                r: for (; ; ) {
                  if (d >>>= y = v >>> 24, p -= y, !(16 & (y = v >>> 16 & 255))) {
                    if (0 == (64 & y)) {
                      v = _[(65535 & v) + (d & (1 << y) - 1)];
                      continue r;
                    }
                    e2.msg = "invalid distance code", r2.mode = 30;
                    break e;
                  }
                  if (k = 65535 & v, p < (y &= 15) && (d += z[n++] << p, (p += 8) < y && (d += z[n++] << p, p += 8)), h < (k += d & (1 << y) - 1)) {
                    e2.msg = "invalid distance too far back", r2.mode = 30;
                    break e;
                  }
                  if (d >>>= y, p -= y, (y = s - a) < k) {
                    if (l < (y = k - y) && r2.sane) {
                      e2.msg = "invalid distance too far back", r2.mode = 30;
                      break e;
                    }
                    if (S = c, (x = 0) === f) {
                      if (x += u - y, y < w) {
                        for (w -= y; C[s++] = c[x++], --y; ) ;
                        x = s - k, S = C;
                      }
                    } else if (f < y) {
                      if (x += u + f - y, (y -= f) < w) {
                        for (w -= y; C[s++] = c[x++], --y; ) ;
                        if (x = 0, f < w) {
                          for (w -= y = f; C[s++] = c[x++], --y; ) ;
                          x = s - k, S = C;
                        }
                      }
                    } else if (x += f - y, y < w) {
                      for (w -= y; C[s++] = c[x++], --y; ) ;
                      x = s - k, S = C;
                    }
                    for (; 2 < w; ) C[s++] = S[x++], C[s++] = S[x++], C[s++] = S[x++], w -= 3;
                    w && (C[s++] = S[x++], 1 < w && (C[s++] = S[x++]));
                  } else {
                    for (x = s - k; C[s++] = C[x++], C[s++] = C[x++], C[s++] = C[x++], 2 < (w -= 3); ) ;
                    w && (C[s++] = C[x++], 1 < w && (C[s++] = C[x++]));
                  }
                  break;
                }
              }
              break;
            }
          } while (n < i && s < o);
          n -= w = p >> 3, d &= (1 << (p -= w << 3)) - 1, e2.next_in = n, e2.next_out = s, e2.avail_in = n < i ? i - n + 5 : 5 - (n - i), e2.avail_out = s < o ? o - s + 257 : 257 - (s - o), r2.hold = d, r2.bits = p;
        };
      }, {}], 49: [function(e, t, r) {
        var I = e("../utils/common"), O = e("./adler32"), B = e("./crc32"), R = e("./inffast"), T = e("./inftrees"), D = 1, F = 2, N = 0, U = -2, P = 1, n = 852, i = 592;
        function L(e2) {
          return (e2 >>> 24 & 255) + (e2 >>> 8 & 65280) + ((65280 & e2) << 8) + ((255 & e2) << 24);
        }
        function s() {
          this.mode = 0, this.last = false, this.wrap = 0, this.havedict = false, this.flags = 0, this.dmax = 0, this.check = 0, this.total = 0, this.head = null, this.wbits = 0, this.wsize = 0, this.whave = 0, this.wnext = 0, this.window = null, this.hold = 0, this.bits = 0, this.length = 0, this.offset = 0, this.extra = 0, this.lencode = null, this.distcode = null, this.lenbits = 0, this.distbits = 0, this.ncode = 0, this.nlen = 0, this.ndist = 0, this.have = 0, this.next = null, this.lens = new I.Buf16(320), this.work = new I.Buf16(288), this.lendyn = null, this.distdyn = null, this.sane = 0, this.back = 0, this.was = 0;
        }
        function a(e2) {
          var t2;
          return e2 && e2.state ? (t2 = e2.state, e2.total_in = e2.total_out = t2.total = 0, e2.msg = "", t2.wrap && (e2.adler = 1 & t2.wrap), t2.mode = P, t2.last = 0, t2.havedict = 0, t2.dmax = 32768, t2.head = null, t2.hold = 0, t2.bits = 0, t2.lencode = t2.lendyn = new I.Buf32(n), t2.distcode = t2.distdyn = new I.Buf32(i), t2.sane = 1, t2.back = -1, N) : U;
        }
        function o(e2) {
          var t2;
          return e2 && e2.state ? ((t2 = e2.state).wsize = 0, t2.whave = 0, t2.wnext = 0, a(e2)) : U;
        }
        function h(e2, t2) {
          var r2, n2;
          return e2 && e2.state ? (n2 = e2.state, t2 < 0 ? (r2 = 0, t2 = -t2) : (r2 = 1 + (t2 >> 4), t2 < 48 && (t2 &= 15)), t2 && (t2 < 8 || 15 < t2) ? U : (null !== n2.window && n2.wbits !== t2 && (n2.window = null), n2.wrap = r2, n2.wbits = t2, o(e2))) : U;
        }
        function u(e2, t2) {
          var r2, n2;
          return e2 ? (n2 = new s(), (e2.state = n2).window = null, (r2 = h(e2, t2)) !== N && (e2.state = null), r2) : U;
        }
        var l, f, c = true;
        function j(e2) {
          if (c) {
            var t2;
            for (l = new I.Buf32(512), f = new I.Buf32(32), t2 = 0; t2 < 144; ) e2.lens[t2++] = 8;
            for (; t2 < 256; ) e2.lens[t2++] = 9;
            for (; t2 < 280; ) e2.lens[t2++] = 7;
            for (; t2 < 288; ) e2.lens[t2++] = 8;
            for (T(D, e2.lens, 0, 288, l, 0, e2.work, { bits: 9 }), t2 = 0; t2 < 32; ) e2.lens[t2++] = 5;
            T(F, e2.lens, 0, 32, f, 0, e2.work, { bits: 5 }), c = false;
          }
          e2.lencode = l, e2.lenbits = 9, e2.distcode = f, e2.distbits = 5;
        }
        function Z(e2, t2, r2, n2) {
          var i2, s2 = e2.state;
          return null === s2.window && (s2.wsize = 1 << s2.wbits, s2.wnext = 0, s2.whave = 0, s2.window = new I.Buf8(s2.wsize)), n2 >= s2.wsize ? (I.arraySet(s2.window, t2, r2 - s2.wsize, s2.wsize, 0), s2.wnext = 0, s2.whave = s2.wsize) : (n2 < (i2 = s2.wsize - s2.wnext) && (i2 = n2), I.arraySet(s2.window, t2, r2 - n2, i2, s2.wnext), (n2 -= i2) ? (I.arraySet(s2.window, t2, r2 - n2, n2, 0), s2.wnext = n2, s2.whave = s2.wsize) : (s2.wnext += i2, s2.wnext === s2.wsize && (s2.wnext = 0), s2.whave < s2.wsize && (s2.whave += i2))), 0;
        }
        r.inflateReset = o, r.inflateReset2 = h, r.inflateResetKeep = a, r.inflateInit = function(e2) {
          return u(e2, 15);
        }, r.inflateInit2 = u, r.inflate = function(e2, t2) {
          var r2, n2, i2, s2, a2, o2, h2, u2, l2, f2, c2, d, p, m, _, g, b, v, y, w, k, x, S, z, C = 0, E = new I.Buf8(4), A = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
          if (!e2 || !e2.state || !e2.output || !e2.input && 0 !== e2.avail_in) return U;
          12 === (r2 = e2.state).mode && (r2.mode = 13), a2 = e2.next_out, i2 = e2.output, h2 = e2.avail_out, s2 = e2.next_in, n2 = e2.input, o2 = e2.avail_in, u2 = r2.hold, l2 = r2.bits, f2 = o2, c2 = h2, x = N;
          e: for (; ; ) switch (r2.mode) {
            case P:
              if (0 === r2.wrap) {
                r2.mode = 13;
                break;
              }
              for (; l2 < 16; ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s2++] << l2, l2 += 8;
              }
              if (2 & r2.wrap && 35615 === u2) {
                E[r2.check = 0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0), l2 = u2 = 0, r2.mode = 2;
                break;
              }
              if (r2.flags = 0, r2.head && (r2.head.done = false), !(1 & r2.wrap) || (((255 & u2) << 8) + (u2 >> 8)) % 31) {
                e2.msg = "incorrect header check", r2.mode = 30;
                break;
              }
              if (8 != (15 & u2)) {
                e2.msg = "unknown compression method", r2.mode = 30;
                break;
              }
              if (l2 -= 4, k = 8 + (15 & (u2 >>>= 4)), 0 === r2.wbits) r2.wbits = k;
              else if (k > r2.wbits) {
                e2.msg = "invalid window size", r2.mode = 30;
                break;
              }
              r2.dmax = 1 << k, e2.adler = r2.check = 1, r2.mode = 512 & u2 ? 10 : 12, l2 = u2 = 0;
              break;
            case 2:
              for (; l2 < 16; ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s2++] << l2, l2 += 8;
              }
              if (r2.flags = u2, 8 != (255 & r2.flags)) {
                e2.msg = "unknown compression method", r2.mode = 30;
                break;
              }
              if (57344 & r2.flags) {
                e2.msg = "unknown header flags set", r2.mode = 30;
                break;
              }
              r2.head && (r2.head.text = u2 >> 8 & 1), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0)), l2 = u2 = 0, r2.mode = 3;
            case 3:
              for (; l2 < 32; ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s2++] << l2, l2 += 8;
              }
              r2.head && (r2.head.time = u2), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, E[2] = u2 >>> 16 & 255, E[3] = u2 >>> 24 & 255, r2.check = B(r2.check, E, 4, 0)), l2 = u2 = 0, r2.mode = 4;
            case 4:
              for (; l2 < 16; ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s2++] << l2, l2 += 8;
              }
              r2.head && (r2.head.xflags = 255 & u2, r2.head.os = u2 >> 8), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0)), l2 = u2 = 0, r2.mode = 5;
            case 5:
              if (1024 & r2.flags) {
                for (; l2 < 16; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                r2.length = u2, r2.head && (r2.head.extra_len = u2), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0)), l2 = u2 = 0;
              } else r2.head && (r2.head.extra = null);
              r2.mode = 6;
            case 6:
              if (1024 & r2.flags && (o2 < (d = r2.length) && (d = o2), d && (r2.head && (k = r2.head.extra_len - r2.length, r2.head.extra || (r2.head.extra = new Array(r2.head.extra_len)), I.arraySet(r2.head.extra, n2, s2, d, k)), 512 & r2.flags && (r2.check = B(r2.check, n2, d, s2)), o2 -= d, s2 += d, r2.length -= d), r2.length)) break e;
              r2.length = 0, r2.mode = 7;
            case 7:
              if (2048 & r2.flags) {
                if (0 === o2) break e;
                for (d = 0; k = n2[s2 + d++], r2.head && k && r2.length < 65536 && (r2.head.name += String.fromCharCode(k)), k && d < o2; ) ;
                if (512 & r2.flags && (r2.check = B(r2.check, n2, d, s2)), o2 -= d, s2 += d, k) break e;
              } else r2.head && (r2.head.name = null);
              r2.length = 0, r2.mode = 8;
            case 8:
              if (4096 & r2.flags) {
                if (0 === o2) break e;
                for (d = 0; k = n2[s2 + d++], r2.head && k && r2.length < 65536 && (r2.head.comment += String.fromCharCode(k)), k && d < o2; ) ;
                if (512 & r2.flags && (r2.check = B(r2.check, n2, d, s2)), o2 -= d, s2 += d, k) break e;
              } else r2.head && (r2.head.comment = null);
              r2.mode = 9;
            case 9:
              if (512 & r2.flags) {
                for (; l2 < 16; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                if (u2 !== (65535 & r2.check)) {
                  e2.msg = "header crc mismatch", r2.mode = 30;
                  break;
                }
                l2 = u2 = 0;
              }
              r2.head && (r2.head.hcrc = r2.flags >> 9 & 1, r2.head.done = true), e2.adler = r2.check = 0, r2.mode = 12;
              break;
            case 10:
              for (; l2 < 32; ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s2++] << l2, l2 += 8;
              }
              e2.adler = r2.check = L(u2), l2 = u2 = 0, r2.mode = 11;
            case 11:
              if (0 === r2.havedict) return e2.next_out = a2, e2.avail_out = h2, e2.next_in = s2, e2.avail_in = o2, r2.hold = u2, r2.bits = l2, 2;
              e2.adler = r2.check = 1, r2.mode = 12;
            case 12:
              if (5 === t2 || 6 === t2) break e;
            case 13:
              if (r2.last) {
                u2 >>>= 7 & l2, l2 -= 7 & l2, r2.mode = 27;
                break;
              }
              for (; l2 < 3; ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s2++] << l2, l2 += 8;
              }
              switch (r2.last = 1 & u2, l2 -= 1, 3 & (u2 >>>= 1)) {
                case 0:
                  r2.mode = 14;
                  break;
                case 1:
                  if (j(r2), r2.mode = 20, 6 !== t2) break;
                  u2 >>>= 2, l2 -= 2;
                  break e;
                case 2:
                  r2.mode = 17;
                  break;
                case 3:
                  e2.msg = "invalid block type", r2.mode = 30;
              }
              u2 >>>= 2, l2 -= 2;
              break;
            case 14:
              for (u2 >>>= 7 & l2, l2 -= 7 & l2; l2 < 32; ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s2++] << l2, l2 += 8;
              }
              if ((65535 & u2) != (u2 >>> 16 ^ 65535)) {
                e2.msg = "invalid stored block lengths", r2.mode = 30;
                break;
              }
              if (r2.length = 65535 & u2, l2 = u2 = 0, r2.mode = 15, 6 === t2) break e;
            case 15:
              r2.mode = 16;
            case 16:
              if (d = r2.length) {
                if (o2 < d && (d = o2), h2 < d && (d = h2), 0 === d) break e;
                I.arraySet(i2, n2, s2, d, a2), o2 -= d, s2 += d, h2 -= d, a2 += d, r2.length -= d;
                break;
              }
              r2.mode = 12;
              break;
            case 17:
              for (; l2 < 14; ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s2++] << l2, l2 += 8;
              }
              if (r2.nlen = 257 + (31 & u2), u2 >>>= 5, l2 -= 5, r2.ndist = 1 + (31 & u2), u2 >>>= 5, l2 -= 5, r2.ncode = 4 + (15 & u2), u2 >>>= 4, l2 -= 4, 286 < r2.nlen || 30 < r2.ndist) {
                e2.msg = "too many length or distance symbols", r2.mode = 30;
                break;
              }
              r2.have = 0, r2.mode = 18;
            case 18:
              for (; r2.have < r2.ncode; ) {
                for (; l2 < 3; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                r2.lens[A[r2.have++]] = 7 & u2, u2 >>>= 3, l2 -= 3;
              }
              for (; r2.have < 19; ) r2.lens[A[r2.have++]] = 0;
              if (r2.lencode = r2.lendyn, r2.lenbits = 7, S = { bits: r2.lenbits }, x = T(0, r2.lens, 0, 19, r2.lencode, 0, r2.work, S), r2.lenbits = S.bits, x) {
                e2.msg = "invalid code lengths set", r2.mode = 30;
                break;
              }
              r2.have = 0, r2.mode = 19;
            case 19:
              for (; r2.have < r2.nlen + r2.ndist; ) {
                for (; g = (C = r2.lencode[u2 & (1 << r2.lenbits) - 1]) >>> 16 & 255, b = 65535 & C, !((_ = C >>> 24) <= l2); ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                if (b < 16) u2 >>>= _, l2 -= _, r2.lens[r2.have++] = b;
                else {
                  if (16 === b) {
                    for (z = _ + 2; l2 < z; ) {
                      if (0 === o2) break e;
                      o2--, u2 += n2[s2++] << l2, l2 += 8;
                    }
                    if (u2 >>>= _, l2 -= _, 0 === r2.have) {
                      e2.msg = "invalid bit length repeat", r2.mode = 30;
                      break;
                    }
                    k = r2.lens[r2.have - 1], d = 3 + (3 & u2), u2 >>>= 2, l2 -= 2;
                  } else if (17 === b) {
                    for (z = _ + 3; l2 < z; ) {
                      if (0 === o2) break e;
                      o2--, u2 += n2[s2++] << l2, l2 += 8;
                    }
                    l2 -= _, k = 0, d = 3 + (7 & (u2 >>>= _)), u2 >>>= 3, l2 -= 3;
                  } else {
                    for (z = _ + 7; l2 < z; ) {
                      if (0 === o2) break e;
                      o2--, u2 += n2[s2++] << l2, l2 += 8;
                    }
                    l2 -= _, k = 0, d = 11 + (127 & (u2 >>>= _)), u2 >>>= 7, l2 -= 7;
                  }
                  if (r2.have + d > r2.nlen + r2.ndist) {
                    e2.msg = "invalid bit length repeat", r2.mode = 30;
                    break;
                  }
                  for (; d--; ) r2.lens[r2.have++] = k;
                }
              }
              if (30 === r2.mode) break;
              if (0 === r2.lens[256]) {
                e2.msg = "invalid code -- missing end-of-block", r2.mode = 30;
                break;
              }
              if (r2.lenbits = 9, S = { bits: r2.lenbits }, x = T(D, r2.lens, 0, r2.nlen, r2.lencode, 0, r2.work, S), r2.lenbits = S.bits, x) {
                e2.msg = "invalid literal/lengths set", r2.mode = 30;
                break;
              }
              if (r2.distbits = 6, r2.distcode = r2.distdyn, S = { bits: r2.distbits }, x = T(F, r2.lens, r2.nlen, r2.ndist, r2.distcode, 0, r2.work, S), r2.distbits = S.bits, x) {
                e2.msg = "invalid distances set", r2.mode = 30;
                break;
              }
              if (r2.mode = 20, 6 === t2) break e;
            case 20:
              r2.mode = 21;
            case 21:
              if (6 <= o2 && 258 <= h2) {
                e2.next_out = a2, e2.avail_out = h2, e2.next_in = s2, e2.avail_in = o2, r2.hold = u2, r2.bits = l2, R(e2, c2), a2 = e2.next_out, i2 = e2.output, h2 = e2.avail_out, s2 = e2.next_in, n2 = e2.input, o2 = e2.avail_in, u2 = r2.hold, l2 = r2.bits, 12 === r2.mode && (r2.back = -1);
                break;
              }
              for (r2.back = 0; g = (C = r2.lencode[u2 & (1 << r2.lenbits) - 1]) >>> 16 & 255, b = 65535 & C, !((_ = C >>> 24) <= l2); ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s2++] << l2, l2 += 8;
              }
              if (g && 0 == (240 & g)) {
                for (v = _, y = g, w = b; g = (C = r2.lencode[w + ((u2 & (1 << v + y) - 1) >> v)]) >>> 16 & 255, b = 65535 & C, !(v + (_ = C >>> 24) <= l2); ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                u2 >>>= v, l2 -= v, r2.back += v;
              }
              if (u2 >>>= _, l2 -= _, r2.back += _, r2.length = b, 0 === g) {
                r2.mode = 26;
                break;
              }
              if (32 & g) {
                r2.back = -1, r2.mode = 12;
                break;
              }
              if (64 & g) {
                e2.msg = "invalid literal/length code", r2.mode = 30;
                break;
              }
              r2.extra = 15 & g, r2.mode = 22;
            case 22:
              if (r2.extra) {
                for (z = r2.extra; l2 < z; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                r2.length += u2 & (1 << r2.extra) - 1, u2 >>>= r2.extra, l2 -= r2.extra, r2.back += r2.extra;
              }
              r2.was = r2.length, r2.mode = 23;
            case 23:
              for (; g = (C = r2.distcode[u2 & (1 << r2.distbits) - 1]) >>> 16 & 255, b = 65535 & C, !((_ = C >>> 24) <= l2); ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s2++] << l2, l2 += 8;
              }
              if (0 == (240 & g)) {
                for (v = _, y = g, w = b; g = (C = r2.distcode[w + ((u2 & (1 << v + y) - 1) >> v)]) >>> 16 & 255, b = 65535 & C, !(v + (_ = C >>> 24) <= l2); ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                u2 >>>= v, l2 -= v, r2.back += v;
              }
              if (u2 >>>= _, l2 -= _, r2.back += _, 64 & g) {
                e2.msg = "invalid distance code", r2.mode = 30;
                break;
              }
              r2.offset = b, r2.extra = 15 & g, r2.mode = 24;
            case 24:
              if (r2.extra) {
                for (z = r2.extra; l2 < z; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                r2.offset += u2 & (1 << r2.extra) - 1, u2 >>>= r2.extra, l2 -= r2.extra, r2.back += r2.extra;
              }
              if (r2.offset > r2.dmax) {
                e2.msg = "invalid distance too far back", r2.mode = 30;
                break;
              }
              r2.mode = 25;
            case 25:
              if (0 === h2) break e;
              if (d = c2 - h2, r2.offset > d) {
                if ((d = r2.offset - d) > r2.whave && r2.sane) {
                  e2.msg = "invalid distance too far back", r2.mode = 30;
                  break;
                }
                p = d > r2.wnext ? (d -= r2.wnext, r2.wsize - d) : r2.wnext - d, d > r2.length && (d = r2.length), m = r2.window;
              } else m = i2, p = a2 - r2.offset, d = r2.length;
              for (h2 < d && (d = h2), h2 -= d, r2.length -= d; i2[a2++] = m[p++], --d; ) ;
              0 === r2.length && (r2.mode = 21);
              break;
            case 26:
              if (0 === h2) break e;
              i2[a2++] = r2.length, h2--, r2.mode = 21;
              break;
            case 27:
              if (r2.wrap) {
                for (; l2 < 32; ) {
                  if (0 === o2) break e;
                  o2--, u2 |= n2[s2++] << l2, l2 += 8;
                }
                if (c2 -= h2, e2.total_out += c2, r2.total += c2, c2 && (e2.adler = r2.check = r2.flags ? B(r2.check, i2, c2, a2 - c2) : O(r2.check, i2, c2, a2 - c2)), c2 = h2, (r2.flags ? u2 : L(u2)) !== r2.check) {
                  e2.msg = "incorrect data check", r2.mode = 30;
                  break;
                }
                l2 = u2 = 0;
              }
              r2.mode = 28;
            case 28:
              if (r2.wrap && r2.flags) {
                for (; l2 < 32; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s2++] << l2, l2 += 8;
                }
                if (u2 !== (4294967295 & r2.total)) {
                  e2.msg = "incorrect length check", r2.mode = 30;
                  break;
                }
                l2 = u2 = 0;
              }
              r2.mode = 29;
            case 29:
              x = 1;
              break e;
            case 30:
              x = -3;
              break e;
            case 31:
              return -4;
            case 32:
            default:
              return U;
          }
          return e2.next_out = a2, e2.avail_out = h2, e2.next_in = s2, e2.avail_in = o2, r2.hold = u2, r2.bits = l2, (r2.wsize || c2 !== e2.avail_out && r2.mode < 30 && (r2.mode < 27 || 4 !== t2)) && Z(e2, e2.output, e2.next_out, c2 - e2.avail_out) ? (r2.mode = 31, -4) : (f2 -= e2.avail_in, c2 -= e2.avail_out, e2.total_in += f2, e2.total_out += c2, r2.total += c2, r2.wrap && c2 && (e2.adler = r2.check = r2.flags ? B(r2.check, i2, c2, e2.next_out - c2) : O(r2.check, i2, c2, e2.next_out - c2)), e2.data_type = r2.bits + (r2.last ? 64 : 0) + (12 === r2.mode ? 128 : 0) + (20 === r2.mode || 15 === r2.mode ? 256 : 0), (0 == f2 && 0 === c2 || 4 === t2) && x === N && (x = -5), x);
        }, r.inflateEnd = function(e2) {
          if (!e2 || !e2.state) return U;
          var t2 = e2.state;
          return t2.window && (t2.window = null), e2.state = null, N;
        }, r.inflateGetHeader = function(e2, t2) {
          var r2;
          return e2 && e2.state ? 0 == (2 & (r2 = e2.state).wrap) ? U : ((r2.head = t2).done = false, N) : U;
        }, r.inflateSetDictionary = function(e2, t2) {
          var r2, n2 = t2.length;
          return e2 && e2.state ? 0 !== (r2 = e2.state).wrap && 11 !== r2.mode ? U : 11 === r2.mode && O(1, t2, n2, 0) !== r2.check ? -3 : Z(e2, t2, n2, n2) ? (r2.mode = 31, -4) : (r2.havedict = 1, N) : U;
        }, r.inflateInfo = "pako inflate (from Nodeca project)";
      }, { "../utils/common": 41, "./adler32": 43, "./crc32": 45, "./inffast": 48, "./inftrees": 50 }], 50: [function(e, t, r) {
        var D = e("../utils/common"), F = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0], N = [16, 16, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 18, 19, 19, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 16, 72, 78], U = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577, 0, 0], P = [16, 16, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24, 24, 25, 25, 26, 26, 27, 27, 28, 28, 29, 29, 64, 64];
        t.exports = function(e2, t2, r2, n, i, s, a, o) {
          var h, u, l, f, c, d, p, m, _, g = o.bits, b = 0, v = 0, y = 0, w = 0, k = 0, x = 0, S = 0, z = 0, C = 0, E = 0, A = null, I = 0, O = new D.Buf16(16), B = new D.Buf16(16), R = null, T = 0;
          for (b = 0; b <= 15; b++) O[b] = 0;
          for (v = 0; v < n; v++) O[t2[r2 + v]]++;
          for (k = g, w = 15; 1 <= w && 0 === O[w]; w--) ;
          if (w < k && (k = w), 0 === w) return i[s++] = 20971520, i[s++] = 20971520, o.bits = 1, 0;
          for (y = 1; y < w && 0 === O[y]; y++) ;
          for (k < y && (k = y), b = z = 1; b <= 15; b++) if (z <<= 1, (z -= O[b]) < 0) return -1;
          if (0 < z && (0 === e2 || 1 !== w)) return -1;
          for (B[1] = 0, b = 1; b < 15; b++) B[b + 1] = B[b] + O[b];
          for (v = 0; v < n; v++) 0 !== t2[r2 + v] && (a[B[t2[r2 + v]]++] = v);
          if (d = 0 === e2 ? (A = R = a, 19) : 1 === e2 ? (A = F, I -= 257, R = N, T -= 257, 256) : (A = U, R = P, -1), b = y, c = s, S = v = E = 0, l = -1, f = (C = 1 << (x = k)) - 1, 1 === e2 && 852 < C || 2 === e2 && 592 < C) return 1;
          for (; ; ) {
            for (p = b - S, _ = a[v] < d ? (m = 0, a[v]) : a[v] > d ? (m = R[T + a[v]], A[I + a[v]]) : (m = 96, 0), h = 1 << b - S, y = u = 1 << x; i[c + (E >> S) + (u -= h)] = p << 24 | m << 16 | _ | 0, 0 !== u; ) ;
            for (h = 1 << b - 1; E & h; ) h >>= 1;
            if (0 !== h ? (E &= h - 1, E += h) : E = 0, v++, 0 == --O[b]) {
              if (b === w) break;
              b = t2[r2 + a[v]];
            }
            if (k < b && (E & f) !== l) {
              for (0 === S && (S = k), c += y, z = 1 << (x = b - S); x + S < w && !((z -= O[x + S]) <= 0); ) x++, z <<= 1;
              if (C += 1 << x, 1 === e2 && 852 < C || 2 === e2 && 592 < C) return 1;
              i[l = E & f] = k << 24 | x << 16 | c - s | 0;
            }
          }
          return 0 !== E && (i[c + E] = b - S << 24 | 64 << 16 | 0), o.bits = k, 0;
        };
      }, { "../utils/common": 41 }], 51: [function(e, t, r) {
        t.exports = { 2: "need dictionary", 1: "stream end", 0: "", "-1": "file error", "-2": "stream error", "-3": "data error", "-4": "insufficient memory", "-5": "buffer error", "-6": "incompatible version" };
      }, {}], 52: [function(e, t, r) {
        var i = e("../utils/common"), o = 0, h = 1;
        function n(e2) {
          for (var t2 = e2.length; 0 <= --t2; ) e2[t2] = 0;
        }
        var s = 0, a = 29, u = 256, l = u + 1 + a, f = 30, c = 19, _ = 2 * l + 1, g = 15, d = 16, p = 7, m = 256, b = 16, v = 17, y = 18, w = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0], k = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13], x = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7], S = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15], z = new Array(2 * (l + 2));
        n(z);
        var C = new Array(2 * f);
        n(C);
        var E = new Array(512);
        n(E);
        var A = new Array(256);
        n(A);
        var I = new Array(a);
        n(I);
        var O, B, R, T = new Array(f);
        function D(e2, t2, r2, n2, i2) {
          this.static_tree = e2, this.extra_bits = t2, this.extra_base = r2, this.elems = n2, this.max_length = i2, this.has_stree = e2 && e2.length;
        }
        function F(e2, t2) {
          this.dyn_tree = e2, this.max_code = 0, this.stat_desc = t2;
        }
        function N(e2) {
          return e2 < 256 ? E[e2] : E[256 + (e2 >>> 7)];
        }
        function U(e2, t2) {
          e2.pending_buf[e2.pending++] = 255 & t2, e2.pending_buf[e2.pending++] = t2 >>> 8 & 255;
        }
        function P(e2, t2, r2) {
          e2.bi_valid > d - r2 ? (e2.bi_buf |= t2 << e2.bi_valid & 65535, U(e2, e2.bi_buf), e2.bi_buf = t2 >> d - e2.bi_valid, e2.bi_valid += r2 - d) : (e2.bi_buf |= t2 << e2.bi_valid & 65535, e2.bi_valid += r2);
        }
        function L(e2, t2, r2) {
          P(e2, r2[2 * t2], r2[2 * t2 + 1]);
        }
        function j(e2, t2) {
          for (var r2 = 0; r2 |= 1 & e2, e2 >>>= 1, r2 <<= 1, 0 < --t2; ) ;
          return r2 >>> 1;
        }
        function Z(e2, t2, r2) {
          var n2, i2, s2 = new Array(g + 1), a2 = 0;
          for (n2 = 1; n2 <= g; n2++) s2[n2] = a2 = a2 + r2[n2 - 1] << 1;
          for (i2 = 0; i2 <= t2; i2++) {
            var o2 = e2[2 * i2 + 1];
            0 !== o2 && (e2[2 * i2] = j(s2[o2]++, o2));
          }
        }
        function W(e2) {
          var t2;
          for (t2 = 0; t2 < l; t2++) e2.dyn_ltree[2 * t2] = 0;
          for (t2 = 0; t2 < f; t2++) e2.dyn_dtree[2 * t2] = 0;
          for (t2 = 0; t2 < c; t2++) e2.bl_tree[2 * t2] = 0;
          e2.dyn_ltree[2 * m] = 1, e2.opt_len = e2.static_len = 0, e2.last_lit = e2.matches = 0;
        }
        function M(e2) {
          8 < e2.bi_valid ? U(e2, e2.bi_buf) : 0 < e2.bi_valid && (e2.pending_buf[e2.pending++] = e2.bi_buf), e2.bi_buf = 0, e2.bi_valid = 0;
        }
        function H(e2, t2, r2, n2) {
          var i2 = 2 * t2, s2 = 2 * r2;
          return e2[i2] < e2[s2] || e2[i2] === e2[s2] && n2[t2] <= n2[r2];
        }
        function G(e2, t2, r2) {
          for (var n2 = e2.heap[r2], i2 = r2 << 1; i2 <= e2.heap_len && (i2 < e2.heap_len && H(t2, e2.heap[i2 + 1], e2.heap[i2], e2.depth) && i2++, !H(t2, n2, e2.heap[i2], e2.depth)); ) e2.heap[r2] = e2.heap[i2], r2 = i2, i2 <<= 1;
          e2.heap[r2] = n2;
        }
        function K(e2, t2, r2) {
          var n2, i2, s2, a2, o2 = 0;
          if (0 !== e2.last_lit) for (; n2 = e2.pending_buf[e2.d_buf + 2 * o2] << 8 | e2.pending_buf[e2.d_buf + 2 * o2 + 1], i2 = e2.pending_buf[e2.l_buf + o2], o2++, 0 === n2 ? L(e2, i2, t2) : (L(e2, (s2 = A[i2]) + u + 1, t2), 0 !== (a2 = w[s2]) && P(e2, i2 -= I[s2], a2), L(e2, s2 = N(--n2), r2), 0 !== (a2 = k[s2]) && P(e2, n2 -= T[s2], a2)), o2 < e2.last_lit; ) ;
          L(e2, m, t2);
        }
        function Y(e2, t2) {
          var r2, n2, i2, s2 = t2.dyn_tree, a2 = t2.stat_desc.static_tree, o2 = t2.stat_desc.has_stree, h2 = t2.stat_desc.elems, u2 = -1;
          for (e2.heap_len = 0, e2.heap_max = _, r2 = 0; r2 < h2; r2++) 0 !== s2[2 * r2] ? (e2.heap[++e2.heap_len] = u2 = r2, e2.depth[r2] = 0) : s2[2 * r2 + 1] = 0;
          for (; e2.heap_len < 2; ) s2[2 * (i2 = e2.heap[++e2.heap_len] = u2 < 2 ? ++u2 : 0)] = 1, e2.depth[i2] = 0, e2.opt_len--, o2 && (e2.static_len -= a2[2 * i2 + 1]);
          for (t2.max_code = u2, r2 = e2.heap_len >> 1; 1 <= r2; r2--) G(e2, s2, r2);
          for (i2 = h2; r2 = e2.heap[1], e2.heap[1] = e2.heap[e2.heap_len--], G(e2, s2, 1), n2 = e2.heap[1], e2.heap[--e2.heap_max] = r2, e2.heap[--e2.heap_max] = n2, s2[2 * i2] = s2[2 * r2] + s2[2 * n2], e2.depth[i2] = (e2.depth[r2] >= e2.depth[n2] ? e2.depth[r2] : e2.depth[n2]) + 1, s2[2 * r2 + 1] = s2[2 * n2 + 1] = i2, e2.heap[1] = i2++, G(e2, s2, 1), 2 <= e2.heap_len; ) ;
          e2.heap[--e2.heap_max] = e2.heap[1], (function(e3, t3) {
            var r3, n3, i3, s3, a3, o3, h3 = t3.dyn_tree, u3 = t3.max_code, l2 = t3.stat_desc.static_tree, f2 = t3.stat_desc.has_stree, c2 = t3.stat_desc.extra_bits, d2 = t3.stat_desc.extra_base, p2 = t3.stat_desc.max_length, m2 = 0;
            for (s3 = 0; s3 <= g; s3++) e3.bl_count[s3] = 0;
            for (h3[2 * e3.heap[e3.heap_max] + 1] = 0, r3 = e3.heap_max + 1; r3 < _; r3++) p2 < (s3 = h3[2 * h3[2 * (n3 = e3.heap[r3]) + 1] + 1] + 1) && (s3 = p2, m2++), h3[2 * n3 + 1] = s3, u3 < n3 || (e3.bl_count[s3]++, a3 = 0, d2 <= n3 && (a3 = c2[n3 - d2]), o3 = h3[2 * n3], e3.opt_len += o3 * (s3 + a3), f2 && (e3.static_len += o3 * (l2[2 * n3 + 1] + a3)));
            if (0 !== m2) {
              do {
                for (s3 = p2 - 1; 0 === e3.bl_count[s3]; ) s3--;
                e3.bl_count[s3]--, e3.bl_count[s3 + 1] += 2, e3.bl_count[p2]--, m2 -= 2;
              } while (0 < m2);
              for (s3 = p2; 0 !== s3; s3--) for (n3 = e3.bl_count[s3]; 0 !== n3; ) u3 < (i3 = e3.heap[--r3]) || (h3[2 * i3 + 1] !== s3 && (e3.opt_len += (s3 - h3[2 * i3 + 1]) * h3[2 * i3], h3[2 * i3 + 1] = s3), n3--);
            }
          })(e2, t2), Z(s2, u2, e2.bl_count);
        }
        function X(e2, t2, r2) {
          var n2, i2, s2 = -1, a2 = t2[1], o2 = 0, h2 = 7, u2 = 4;
          for (0 === a2 && (h2 = 138, u2 = 3), t2[2 * (r2 + 1) + 1] = 65535, n2 = 0; n2 <= r2; n2++) i2 = a2, a2 = t2[2 * (n2 + 1) + 1], ++o2 < h2 && i2 === a2 || (o2 < u2 ? e2.bl_tree[2 * i2] += o2 : 0 !== i2 ? (i2 !== s2 && e2.bl_tree[2 * i2]++, e2.bl_tree[2 * b]++) : o2 <= 10 ? e2.bl_tree[2 * v]++ : e2.bl_tree[2 * y]++, s2 = i2, u2 = (o2 = 0) === a2 ? (h2 = 138, 3) : i2 === a2 ? (h2 = 6, 3) : (h2 = 7, 4));
        }
        function V(e2, t2, r2) {
          var n2, i2, s2 = -1, a2 = t2[1], o2 = 0, h2 = 7, u2 = 4;
          for (0 === a2 && (h2 = 138, u2 = 3), n2 = 0; n2 <= r2; n2++) if (i2 = a2, a2 = t2[2 * (n2 + 1) + 1], !(++o2 < h2 && i2 === a2)) {
            if (o2 < u2) for (; L(e2, i2, e2.bl_tree), 0 != --o2; ) ;
            else 0 !== i2 ? (i2 !== s2 && (L(e2, i2, e2.bl_tree), o2--), L(e2, b, e2.bl_tree), P(e2, o2 - 3, 2)) : o2 <= 10 ? (L(e2, v, e2.bl_tree), P(e2, o2 - 3, 3)) : (L(e2, y, e2.bl_tree), P(e2, o2 - 11, 7));
            s2 = i2, u2 = (o2 = 0) === a2 ? (h2 = 138, 3) : i2 === a2 ? (h2 = 6, 3) : (h2 = 7, 4);
          }
        }
        n(T);
        var q = false;
        function J(e2, t2, r2, n2) {
          P(e2, (s << 1) + (n2 ? 1 : 0), 3), (function(e3, t3, r3, n3) {
            M(e3), U(e3, r3), U(e3, ~r3), i.arraySet(e3.pending_buf, e3.window, t3, r3, e3.pending), e3.pending += r3;
          })(e2, t2, r2);
        }
        r._tr_init = function(e2) {
          q || ((function() {
            var e3, t2, r2, n2, i2, s2 = new Array(g + 1);
            for (n2 = r2 = 0; n2 < a - 1; n2++) for (I[n2] = r2, e3 = 0; e3 < 1 << w[n2]; e3++) A[r2++] = n2;
            for (A[r2 - 1] = n2, n2 = i2 = 0; n2 < 16; n2++) for (T[n2] = i2, e3 = 0; e3 < 1 << k[n2]; e3++) E[i2++] = n2;
            for (i2 >>= 7; n2 < f; n2++) for (T[n2] = i2 << 7, e3 = 0; e3 < 1 << k[n2] - 7; e3++) E[256 + i2++] = n2;
            for (t2 = 0; t2 <= g; t2++) s2[t2] = 0;
            for (e3 = 0; e3 <= 143; ) z[2 * e3 + 1] = 8, e3++, s2[8]++;
            for (; e3 <= 255; ) z[2 * e3 + 1] = 9, e3++, s2[9]++;
            for (; e3 <= 279; ) z[2 * e3 + 1] = 7, e3++, s2[7]++;
            for (; e3 <= 287; ) z[2 * e3 + 1] = 8, e3++, s2[8]++;
            for (Z(z, l + 1, s2), e3 = 0; e3 < f; e3++) C[2 * e3 + 1] = 5, C[2 * e3] = j(e3, 5);
            O = new D(z, w, u + 1, l, g), B = new D(C, k, 0, f, g), R = new D(new Array(0), x, 0, c, p);
          })(), q = true), e2.l_desc = new F(e2.dyn_ltree, O), e2.d_desc = new F(e2.dyn_dtree, B), e2.bl_desc = new F(e2.bl_tree, R), e2.bi_buf = 0, e2.bi_valid = 0, W(e2);
        }, r._tr_stored_block = J, r._tr_flush_block = function(e2, t2, r2, n2) {
          var i2, s2, a2 = 0;
          0 < e2.level ? (2 === e2.strm.data_type && (e2.strm.data_type = (function(e3) {
            var t3, r3 = 4093624447;
            for (t3 = 0; t3 <= 31; t3++, r3 >>>= 1) if (1 & r3 && 0 !== e3.dyn_ltree[2 * t3]) return o;
            if (0 !== e3.dyn_ltree[18] || 0 !== e3.dyn_ltree[20] || 0 !== e3.dyn_ltree[26]) return h;
            for (t3 = 32; t3 < u; t3++) if (0 !== e3.dyn_ltree[2 * t3]) return h;
            return o;
          })(e2)), Y(e2, e2.l_desc), Y(e2, e2.d_desc), a2 = (function(e3) {
            var t3;
            for (X(e3, e3.dyn_ltree, e3.l_desc.max_code), X(e3, e3.dyn_dtree, e3.d_desc.max_code), Y(e3, e3.bl_desc), t3 = c - 1; 3 <= t3 && 0 === e3.bl_tree[2 * S[t3] + 1]; t3--) ;
            return e3.opt_len += 3 * (t3 + 1) + 5 + 5 + 4, t3;
          })(e2), i2 = e2.opt_len + 3 + 7 >>> 3, (s2 = e2.static_len + 3 + 7 >>> 3) <= i2 && (i2 = s2)) : i2 = s2 = r2 + 5, r2 + 4 <= i2 && -1 !== t2 ? J(e2, t2, r2, n2) : 4 === e2.strategy || s2 === i2 ? (P(e2, 2 + (n2 ? 1 : 0), 3), K(e2, z, C)) : (P(e2, 4 + (n2 ? 1 : 0), 3), (function(e3, t3, r3, n3) {
            var i3;
            for (P(e3, t3 - 257, 5), P(e3, r3 - 1, 5), P(e3, n3 - 4, 4), i3 = 0; i3 < n3; i3++) P(e3, e3.bl_tree[2 * S[i3] + 1], 3);
            V(e3, e3.dyn_ltree, t3 - 1), V(e3, e3.dyn_dtree, r3 - 1);
          })(e2, e2.l_desc.max_code + 1, e2.d_desc.max_code + 1, a2 + 1), K(e2, e2.dyn_ltree, e2.dyn_dtree)), W(e2), n2 && M(e2);
        }, r._tr_tally = function(e2, t2, r2) {
          return e2.pending_buf[e2.d_buf + 2 * e2.last_lit] = t2 >>> 8 & 255, e2.pending_buf[e2.d_buf + 2 * e2.last_lit + 1] = 255 & t2, e2.pending_buf[e2.l_buf + e2.last_lit] = 255 & r2, e2.last_lit++, 0 === t2 ? e2.dyn_ltree[2 * r2]++ : (e2.matches++, t2--, e2.dyn_ltree[2 * (A[r2] + u + 1)]++, e2.dyn_dtree[2 * N(t2)]++), e2.last_lit === e2.lit_bufsize - 1;
        }, r._tr_align = function(e2) {
          P(e2, 2, 3), L(e2, m, z), (function(e3) {
            16 === e3.bi_valid ? (U(e3, e3.bi_buf), e3.bi_buf = 0, e3.bi_valid = 0) : 8 <= e3.bi_valid && (e3.pending_buf[e3.pending++] = 255 & e3.bi_buf, e3.bi_buf >>= 8, e3.bi_valid -= 8);
          })(e2);
        };
      }, { "../utils/common": 41 }], 53: [function(e, t, r) {
        t.exports = function() {
          this.input = null, this.next_in = 0, this.avail_in = 0, this.total_in = 0, this.output = null, this.next_out = 0, this.avail_out = 0, this.total_out = 0, this.msg = "", this.state = null, this.data_type = 2, this.adler = 0;
        };
      }, {}], 54: [function(e, t, r) {
        (function(e2) {
          !(function(r2, n) {
            if (!r2.setImmediate) {
              var i, s, t2, a, o = 1, h = {}, u = false, l = r2.document, e3 = Object.getPrototypeOf && Object.getPrototypeOf(r2);
              e3 = e3 && e3.setTimeout ? e3 : r2, i = "[object process]" === {}.toString.call(r2.process) ? function(e4) {
                process.nextTick(function() {
                  c(e4);
                });
              } : (function() {
                if (r2.postMessage && !r2.importScripts) {
                  var e4 = true, t3 = r2.onmessage;
                  return r2.onmessage = function() {
                    e4 = false;
                  }, r2.postMessage("", "*"), r2.onmessage = t3, e4;
                }
              })() ? (a = "setImmediate$" + Math.random() + "$", r2.addEventListener ? r2.addEventListener("message", d, false) : r2.attachEvent("onmessage", d), function(e4) {
                r2.postMessage(a + e4, "*");
              }) : r2.MessageChannel ? ((t2 = new MessageChannel()).port1.onmessage = function(e4) {
                c(e4.data);
              }, function(e4) {
                t2.port2.postMessage(e4);
              }) : l && "onreadystatechange" in l.createElement("script") ? (s = l.documentElement, function(e4) {
                var t3 = l.createElement("script");
                t3.onreadystatechange = function() {
                  c(e4), t3.onreadystatechange = null, s.removeChild(t3), t3 = null;
                }, s.appendChild(t3);
              }) : function(e4) {
                setTimeout(c, 0, e4);
              }, e3.setImmediate = function(e4) {
                "function" != typeof e4 && (e4 = new Function("" + e4));
                for (var t3 = new Array(arguments.length - 1), r3 = 0; r3 < t3.length; r3++) t3[r3] = arguments[r3 + 1];
                var n2 = { callback: e4, args: t3 };
                return h[o] = n2, i(o), o++;
              }, e3.clearImmediate = f;
            }
            function f(e4) {
              delete h[e4];
            }
            function c(e4) {
              if (u) setTimeout(c, 0, e4);
              else {
                var t3 = h[e4];
                if (t3) {
                  u = true;
                  try {
                    !(function(e5) {
                      var t4 = e5.callback, r3 = e5.args;
                      switch (r3.length) {
                        case 0:
                          t4();
                          break;
                        case 1:
                          t4(r3[0]);
                          break;
                        case 2:
                          t4(r3[0], r3[1]);
                          break;
                        case 3:
                          t4(r3[0], r3[1], r3[2]);
                          break;
                        default:
                          t4.apply(n, r3);
                      }
                    })(t3);
                  } finally {
                    f(e4), u = false;
                  }
                }
              }
            }
            function d(e4) {
              e4.source === r2 && "string" == typeof e4.data && 0 === e4.data.indexOf(a) && c(+e4.data.slice(a.length));
            }
          })("undefined" == typeof self ? void 0 === e2 ? this : e2 : self);
        }).call(this, "undefined" != typeof commonjsGlobal ? commonjsGlobal : "undefined" != typeof self ? self : "undefined" != typeof window ? window : {});
      }, {}] }, {}, [10])(10);
    });
  })(jszip_min);
  return jszip_min.exports;
}
var jszip_minExports = requireJszip_min();
const JSZip = /* @__PURE__ */ getDefaultExportFromCjs(jszip_minExports);
const MEIFANNAO_CATALOG_URL = "https://www.meifannao.cn/myApi/api/pc/browser_list";
const MEIFANNAO_EXTENSION_ID = "meifannao";
function pickMeifannaoPack(payload) {
  if (!payload || typeof payload !== "object") return null;
  const data = payload.data;
  if (!data || !Array.isArray(data.downlist)) return null;
  const items = data.downlist.filter(
    (item) => Boolean(item) && typeof item === "object"
  );
  const preferred = items.find((item) => String(item.browername ?? "") === "Chrome") ?? items[0];
  if (!preferred) return null;
  const url = String(preferred.downUrl ?? "").trim();
  if (!url.startsWith("https://")) return null;
  const version = String(preferred.version ?? "").trim() || "0";
  return { url, version };
}
function safeZipEntryPath(name) {
  const rel = name.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel || rel.endsWith("/")) return null;
  const parts = rel.split("/").filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) return null;
  return parts.join("/");
}
const ELECTRON_DROP_PERMISSIONS = /* @__PURE__ */ new Set(["webNavigation"]);
function adaptGuestExtensionManifest(dir) {
  const file = path.join(dir, "manifest.json");
  if (!fs.existsSync(file)) return false;
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return false;
  }
  const current = Array.isArray(manifest.permissions) ? manifest.permissions.filter((item) => typeof item === "string") : [];
  const next = current.filter((item) => !ELECTRON_DROP_PERMISSIONS.has(item));
  if (!next.includes("unlimitedStorage")) next.push("unlimitedStorage");
  if (next.length === current.length && next.every((item, i) => item === current[i])) {
    return false;
  }
  manifest.permissions = next;
  fs.writeFileSync(file, JSON.stringify(manifest));
  return true;
}
function findExtensionRoot(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  if (fs.existsSync(path.join(dir, "manifest.json"))) return dir;
  for (const name of fs.readdirSync(dir)) {
    const child = path.join(dir, name);
    if (fs.statSync(child).isDirectory() && fs.existsSync(path.join(child, "manifest.json"))) {
      return child;
    }
  }
  return null;
}
const META_FILE = "qiwork-sync.json";
function readMeta(dir) {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(dir, META_FILE), "utf8")
    );
    if (typeof raw.url !== "string" || typeof raw.version !== "string") {
      return null;
    }
    return { url: raw.url, version: raw.version };
  } catch {
    return null;
  }
}
async function fetchJson(url) {
  const response = await electron.net.fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`catalog request failed (${response.status})`);
  }
  return response.json();
}
async function downloadHttpsFile(url, filePath) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error("extension pack must be https");
  }
  await promises.mkdir(path.dirname(filePath), { recursive: true });
  const response = await electron.net.fetch(parsed.toString(), { method: "GET" });
  if (!response.ok || !response.body) {
    throw new Error(`extension download failed (${response.status})`);
  }
  const nodeStream = node_stream.Readable.fromWeb(
    response.body
  );
  await promises$1.pipeline(nodeStream, fs.createWriteStream(filePath));
}
async function extractZip(zipPath, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const destRoot = path.normalize(dest);
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const rel = safeZipEntryPath(name);
    if (!rel) continue;
    const out = path.join(dest, ...rel.split("/"));
    const normalized = path.normalize(out);
    if (normalized !== destRoot && !normalized.startsWith(destRoot + path.sep)) {
      continue;
    }
    await promises.mkdir(path.dirname(out), { recursive: true });
    await promises.writeFile(out, await entry.async("nodebuffer"));
  }
}
function replaceDir(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
}
function cachedMeifannaoDir() {
  const dir = findExtensionRoot(userGuestExtensionDir(MEIFANNAO_EXTENSION_ID));
  if (dir) adaptGuestExtensionManifest(dir);
  return dir;
}
async function syncMeifannaoExtension() {
  const installDir = userGuestExtensionDir(MEIFANNAO_EXTENSION_ID);
  const cached = findExtensionRoot(installDir);
  const pack = pickMeifannaoPack(await fetchJson(MEIFANNAO_CATALOG_URL));
  if (!pack) return { dir: cached, changed: false };
  const current = readMeta(installDir);
  if (current?.url === pack.url && current.version === pack.version && cached) {
    return { dir: cached, changed: false };
  }
  const staging = `${installDir}.next`;
  const zipPath = `${installDir}.zip`;
  fs.rmSync(staging, { recursive: true, force: true });
  try {
    await downloadHttpsFile(pack.url, zipPath);
    await extractZip(zipPath, staging);
    const unpacked = findExtensionRoot(staging);
    if (!unpacked) {
      throw new Error("extension pack has no manifest.json");
    }
    if (unpacked !== staging) {
      const ready = `${staging}.ready`;
      fs.rmSync(ready, { recursive: true, force: true });
      replaceDir(unpacked, ready);
      fs.rmSync(staging, { recursive: true, force: true });
      replaceDir(ready, installDir);
    } else {
      replaceDir(staging, installDir);
    }
    const unpackedDir = findExtensionRoot(installDir);
    if (unpackedDir) adaptGuestExtensionManifest(unpackedDir);
    fs.writeFileSync(path.join(installDir, META_FILE), JSON.stringify(pack));
  } finally {
    fs.rmSync(zipPath, { force: true });
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(`${staging}.ready`, { recursive: true, force: true });
  }
  return { dir: findExtensionRoot(installDir), changed: true };
}
class GuestHistoryClient {
  process = null;
  generation = 0;
  pending = /* @__PURE__ */ new Map();
  opened = false;
  async recent(limit = 100) {
    await this.ensure();
    return await this.call("recent", { limit });
  }
  async record(item) {
    await this.ensure();
    await this.call("record", item);
  }
  async clear() {
    await this.ensure();
    await this.call("clear");
  }
  async clearBefore(before) {
    await this.ensure();
    await this.call("clearBefore", { before });
  }
  async query(text, limit = 500) {
    await this.ensure();
    return await this.call("query", { text, limit });
  }
  async remove(urls) {
    await this.ensure();
    await this.call("remove", { urls });
  }
  shutdown() {
    this.rejectAll(new Error("history utility stopped"));
    try {
      this.process?.kill();
    } catch {
    }
    this.process = null;
    this.opened = false;
  }
  async ensure() {
    const proc = this.ensureProcess();
    if (this.opened) return;
    const databasePath = path.join(electron.app.getPath("userData"), "guest-browser", "history.sqlite");
    await this.call("open", { databasePath });
    if (this.process === proc) this.opened = true;
  }
  ensureProcess() {
    if (this.process?.pid) return this.process;
    const generation = ++this.generation;
    const proc = electron.utilityProcess.fork(historyUtilityPath(), [], {
      serviceName: "QIWork Browser History",
      stdio: "pipe"
    });
    this.process = proc;
    this.opened = false;
    proc.on("message", (message) => {
      if (!message || typeof message !== "object") return;
      const response = message;
      if (typeof response.id !== "string" || response.generation !== generation) return;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new Error(response.error || "history utility failed"));
    });
    proc.on("exit", () => {
      if (this.process === proc) {
        this.process = null;
        this.opened = false;
        this.rejectGeneration(generation, new Error("history utility exited"));
      }
    });
    return proc;
  }
  call(type, payload) {
    const proc = this.ensureProcess();
    const id = crypto.randomUUID();
    const generation = this.generation;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, generation });
      proc.postMessage({ id, generation, type, payload });
    });
  }
  rejectGeneration(generation, error) {
    for (const [id, pending] of this.pending) {
      if (pending.generation === generation) {
        this.pending.delete(id);
        pending.reject(error);
      }
    }
  }
  rejectAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
const guestHistory = new GuestHistoryClient();
function showDesktopNotification(title, body) {
  if (!electron.Notification.isSupported()) return;
  const notification = new electron.Notification({ title, body });
  notification.show();
}
const CRYPTO_DIR = "crypto";
const ENVELOPE_FILE = "master_key.enc";
const PLAIN_FALLBACK_FILE = "master_key.plain";
let cachedHex = null;
function cryptoDir() {
  return path.join(electron.app.getPath("userData"), CRYPTO_DIR);
}
function envelopePath() {
  return path.join(cryptoDir(), ENVELOPE_FILE);
}
function plainFallbackPath() {
  return path.join(cryptoDir(), PLAIN_FALLBACK_FILE);
}
function ensureDir() {
  fs.mkdirSync(cryptoDir(), { recursive: true });
}
function readEnvelope() {
  const p = envelopePath();
  if (!fs.existsSync(p)) return null;
  try {
    const b64 = fs.readFileSync(p, "utf8").trim();
    if (!b64) return null;
    const buf = Buffer.from(b64, "base64");
    const hex = electron.safeStorage.decryptString(buf).trim();
    if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
    return hex.toLowerCase();
  } catch (err) {
    console.error("[crypto] failed to decrypt master key envelope:", err);
    return null;
  }
}
function writeEnvelope(hex) {
  ensureDir();
  const encrypted = electron.safeStorage.encryptString(hex);
  fs.writeFileSync(envelopePath(), encrypted.toString("base64"), {
    mode: 384
  });
}
function readPlainFallback() {
  const p = plainFallbackPath();
  if (!fs.existsSync(p)) return null;
  try {
    const hex = fs.readFileSync(p, "utf8").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hex)) return null;
    return hex;
  } catch {
    return null;
  }
}
function writePlainFallback(hex) {
  ensureDir();
  console.warn(
    "[crypto] safeStorage unavailable; master key stored as plain file with mode 0600"
  );
  fs.writeFileSync(plainFallbackPath(), hex, { mode: 384 });
}
function generateHex() {
  return crypto.randomBytes(32).toString("hex");
}
function getOrCreateMasterKeyHex() {
  if (cachedHex) return cachedHex;
  if (electron.safeStorage.isEncryptionAvailable()) {
    const existing = readEnvelope();
    if (existing) {
      cachedHex = existing;
      return cachedHex;
    }
    const hex2 = generateHex();
    writeEnvelope(hex2);
    cachedHex = hex2;
    return cachedHex;
  }
  const plain = readPlainFallback();
  if (plain) {
    cachedHex = plain;
    return cachedHex;
  }
  const hex = generateHex();
  writePlainFallback(hex);
  cachedHex = hex;
  return cachedHex;
}
function cryptoEnv() {
  return {
    QIWORK_MASTER_KEY_HEX: getOrCreateMasterKeyHex()
  };
}
function allocateLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    const onError = (err) => {
      server.close();
      reject(err);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("failed to allocate loopback port"));
        return;
      }
      const { port } = addr;
      server.removeListener("error", onError);
      server.close((err) => err ? reject(err) : resolve(port));
    });
  });
}
function waitForProcessExit(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
  });
}
function finishedWithin(promise, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      }
    );
  });
}
const PREFIX = "QIWORK-RUNTIME ";
function parsePort(token) {
  const hostPort = token.trim();
  const colon = hostPort.lastIndexOf(":");
  const raw = colon >= 0 ? hostPort.slice(colon + 1) : hostPort;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return port;
}
function parseRuntimeAnnounce(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith(PREFIX)) return null;
  const rest = trimmed.slice(PREFIX.length);
  const [verb, a, ...tail] = rest.split(/\s+/);
  if (verb === "listen" && (a === "backend" || a === "connect")) {
    const port = parsePort(tail[0] ?? "");
    if (port === null) return null;
    return { kind: "listen", sidecar: a, port };
  }
  if (verb === "cap" && (a === "core" || a === "agent")) {
    return { kind: "cap", cap: a };
  }
  if (verb === "fail" && (a === "backend" || a === "agent")) {
    const message = tail.join(" ").trim();
    return { kind: "fail", sidecar: a, message };
  }
  return null;
}
function emptyRuntimeState(generation = 0) {
  return {
    generation,
    backend: { state: "starting", port: null, error: "" },
    connect: { state: "starting", port: null, error: "" },
    caps: { core: false, agent: "starting", agentError: "" }
  };
}
function failBackend(state2, message) {
  if (state2.backend.state === "failed") return state2;
  return {
    ...state2,
    backend: {
      ...state2.backend,
      state: "failed",
      error: message
    },
    caps: { core: false, agent: "starting", agentError: "" }
  };
}
function reduceRuntimeState(state2, event) {
  if (event.kind === "listen") {
    if (event.sidecar === "backend") {
      return {
        ...state2,
        backend: { state: "up", port: event.port, error: "" }
      };
    }
    return {
      ...state2,
      connect: { state: "up", port: event.port, error: "" }
    };
  }
  if (event.kind === "cap") {
    if (event.cap === "core") {
      return { ...state2, caps: { ...state2.caps, core: true } };
    }
    return {
      ...state2,
      caps: { ...state2.caps, agent: "ready", agentError: "" }
    };
  }
  if (event.kind === "fail") {
    if (event.sidecar === "backend") {
      return failBackend(state2, event.message);
    }
    return {
      ...state2,
      caps: {
        ...state2.caps,
        agent: "failed",
        agentError: event.message
      }
    };
  }
  if (event.kind === "connect-degraded") {
    return {
      ...state2,
      connect: {
        ...state2.connect,
        state: "degraded",
        error: event.message
      }
    };
  }
  return failBackend(state2, event.message);
}
const MAX_CAPTURED_STDERR_CHARS = 4e3;
const STDERR_TRUNCATION_MARKER = "\n[...stderr truncated...]\n";
const CONNECT_ANNOUNCE_TIMEOUT_MS = 9e4;
const CAPABILITY_TIMEOUT_MS = 18e4;
function trimCapturedStderr(text) {
  if ([...text].length <= MAX_CAPTURED_STDERR_CHARS) return text;
  const chars = [...text];
  const markerLen = [...STDERR_TRUNCATION_MARKER].length;
  const keep = MAX_CAPTURED_STDERR_CHARS - markerLen;
  const head = Math.floor(keep / 2);
  const tail = keep - head;
  return chars.slice(0, head).join("") + STDERR_TRUNCATION_MARKER + chars.slice(-tail).join("");
}
function findFile(candidates) {
  return candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile()) ?? null;
}
class SidecarManager {
  generation = 0;
  gatewayChild = null;
  connectChild = null;
  state = emptyRuntimeState();
  gatewayPid = null;
  desktopHostEnv = null;
  connectDeadlineTimer = null;
  coreDeadlineTimer = null;
  agentDeadlineTimer = null;
  expectedBackendPort = null;
  expectedConnectPort = null;
  setDesktopHostEnv(env) {
    this.desktopHostEnv = env;
  }
  getRuntimeState() {
    return this.state;
  }
  getGatewayPid() {
    return this.gatewayPid;
  }
  async start(win) {
    const gen = ++this.generation;
    this.clearStartupState(gen);
    this.publish(win);
    try {
      const connectPort = await allocateLoopbackPort();
      const backendPort = await allocateLoopbackPort();
      if (!this.isCurrent(gen)) return;
      this.expectedConnectPort = connectPort;
      this.expectedBackendPort = backendPort;
      this.spawnConnect(win, gen, connectPort);
      this.spawnBackend(win, gen, backendPort, connectPort);
      this.armConnectDeadline(win, gen);
      this.armCoreDeadline(win, gen);
    } catch (error) {
      if (!this.isCurrent(gen)) return;
      this.killChild(this.connectChild);
      this.killChild(this.gatewayChild);
      this.failBackend(
        win,
        error instanceof Error ? error.message : String(error),
        "后端启动失败"
      );
    }
  }
  async restart(win) {
    this.stop();
    await this.start(win);
  }
  stop() {
    this.generation += 1;
    this.clearDeadlines();
    this.killChild(this.connectChild);
    this.killChild(this.gatewayChild);
    this.connectChild = null;
    this.gatewayChild = null;
    this.gatewayPid = null;
    this.expectedBackendPort = null;
    this.expectedConnectPort = null;
  }
  /** SIGTERM children and wait for exit. Does not SIGKILL on timeout. */
  async stopAndWait(timeoutMs) {
    const children = [this.connectChild, this.gatewayChild].filter(
      (child) => Boolean(child)
    );
    if (children.length === 0) {
      this.stop();
      return true;
    }
    const exited = Promise.all(children.map((child) => waitForProcessExit(child)));
    this.stop();
    return finishedWithin(exited, timeoutMs);
  }
  clearStartupState(generation) {
    this.state = emptyRuntimeState(generation);
    this.gatewayPid = null;
    this.expectedBackendPort = null;
    this.expectedConnectPort = null;
    this.clearDeadlines();
  }
  isCurrent(gen) {
    return gen === this.generation;
  }
  publish(win) {
    if (win.isDestroyed()) return;
    win.webContents.send(ipcEvents.IpcListen.runtimeState, this.getRuntimeState());
  }
  armConnectDeadline(win, gen) {
    this.clearConnectDeadline();
    this.connectDeadlineTimer = setTimeout(() => {
      if (!this.isCurrent(gen)) return;
      this.degradeConnect(
        win,
        `qiworkconnect:${gen} announce timed out; sync degraded`
      );
    }, CONNECT_ANNOUNCE_TIMEOUT_MS);
  }
  armCoreDeadline(win, gen) {
    this.clearCoreDeadline();
    this.coreDeadlineTimer = setTimeout(() => {
      if (!this.isCurrent(gen) || this.state.caps.core) return;
      this.failBackend(
        win,
        `backend:${gen} core capability timed out`,
        "后端启动超时"
      );
      terminateChildTree(this.gatewayChild, this.gatewayPid);
    }, CAPABILITY_TIMEOUT_MS);
  }
  armAgentDeadline(win, gen) {
    this.clearAgentDeadline();
    this.agentDeadlineTimer = setTimeout(() => {
      if (!this.isCurrent(gen) || this.state.caps.agent !== "starting") return;
      this.state = reduceRuntimeState(this.state, {
        kind: "fail",
        sidecar: "agent",
        message: `backend:${gen} agent capability timed out`
      });
      this.publish(win);
    }, CAPABILITY_TIMEOUT_MS);
  }
  clearConnectDeadline() {
    if (this.connectDeadlineTimer) {
      clearTimeout(this.connectDeadlineTimer);
      this.connectDeadlineTimer = null;
    }
  }
  clearCoreDeadline() {
    if (this.coreDeadlineTimer) {
      clearTimeout(this.coreDeadlineTimer);
      this.coreDeadlineTimer = null;
    }
  }
  clearAgentDeadline() {
    if (this.agentDeadlineTimer) {
      clearTimeout(this.agentDeadlineTimer);
      this.agentDeadlineTimer = null;
    }
  }
  clearDeadlines() {
    this.clearConnectDeadline();
    this.clearCoreDeadline();
    this.clearAgentDeadline();
  }
  degradeConnect(win, message) {
    if (this.state.connect.state === "degraded") return;
    this.state = reduceRuntimeState(this.state, {
      kind: "connect-degraded",
      message
    });
    this.clearConnectDeadline();
    console.error(message);
    this.publish(win);
  }
  applyAnnounce(win, gen, line) {
    const event = parseRuntimeAnnounce(line);
    if (!event) return;
    if (event.kind === "listen") {
      const expectedPort = event.sidecar === "backend" ? this.expectedBackendPort : this.expectedConnectPort;
      if (expectedPort !== event.port) {
        const message = `${event.sidecar}:${gen} announced unexpected port ${event.port}; expected ${expectedPort}`;
        if (event.sidecar === "backend") {
          this.failBackend(win, message, "后端端口异常");
          terminateChildTree(this.gatewayChild, this.gatewayPid);
        } else {
          this.degradeConnect(win, message);
        }
        return;
      }
      if (event.sidecar === "connect") this.clearConnectDeadline();
    }
    if (event.kind === "cap" && event.cap === "core") {
      this.clearCoreDeadline();
      this.armAgentDeadline(win, gen);
    }
    if (event.kind === "cap" && event.cap === "agent" || event.kind === "fail" && event.sidecar === "agent") {
      this.clearAgentDeadline();
    }
    if (event.kind === "fail" && event.sidecar === "backend") {
      this.clearCoreDeadline();
      this.clearAgentDeadline();
    }
    this.state = reduceRuntimeState(this.state, event);
    if (event.kind === "fail" && event.sidecar === "backend") {
      showDesktopNotification(
        "后端启动失败",
        event.message || "backend failed"
      );
    }
    if (event.kind === "fail" && event.sidecar === "agent") {
      console.error(`[backend] agent failed: ${event.message}`);
    }
    this.publish(win);
  }
  killChild(child) {
    if (!child || child.killed) return;
    try {
      if (process.platform === "win32" && child.pid) {
        node_child_process.spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore"
        });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
    }
  }
  spawnConnect(win, gen, port) {
    const cmd = this.buildConnectCommand();
    const child = node_child_process.spawn(cmd.exe, cmd.args, {
      cwd: cmd.cwd,
      env: {
        ...process.env,
        ...cryptoEnv(),
        ...this.desktopHostEnv,
        ...cmd.extraEnv,
        QIWORKCONNECT_DESKTOP: "1",
        QIWORKCONNECT_PORT: String(port),
        NO_PROXY: "127.0.0.1,localhost,::1,<local>",
        no_proxy: "127.0.0.1,localhost,::1,<local>",
        PYTHONUTF8: "1",
        PYTHONUNBUFFERED: "1",
        PYTHONIOENCODING: "utf-8"
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.connectChild = child;
    this.watchChild(child, "qiworkconnect", gen, win);
  }
  spawnBackend(win, gen, backendPort, connectPort) {
    const cmd = this.buildGatewayCommand();
    const child = node_child_process.spawn(cmd.exe, cmd.args, {
      cwd: cmd.cwd,
      env: {
        ...this.buildGatewayEnv(cmd.cwd, connectPort, backendPort),
        ...cmd.extraEnv
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.gatewayChild = child;
    this.gatewayPid = child.pid ?? null;
    this.watchChild(child, "backend", gen, win);
  }
  buildGatewayEnv(backendDir, connectPort, backendPort) {
    const env = {
      ...process.env,
      ...cryptoEnv(),
      NO_PROXY: "127.0.0.1,localhost,::1,<local>",
      no_proxy: "127.0.0.1,localhost,::1,<local>",
      PYTHONUTF8: "1",
      PYTHONUNBUFFERED: "1",
      PYTHONIOENCODING: "utf-8",
      QIWORK_DESKTOP_APP: "1",
      QIWORK_DESKTOP_PORT: String(backendPort),
      QIWORKCONNECT_URL: `http://127.0.0.1:${connectPort}`,
      [pathEnvKey()]: joinPathEnv([backendDir])
    };
    if (!isDev()) {
      const binaries = resourcesBinariesDir();
      const py = process.platform === "win32" ? findFile([
        path.join(binaries, "python-runtime", "python", "python.exe")
      ]) : findFile([
        path.join(binaries, "python-runtime", "python", "bin", "python3"),
        path.join(binaries, "python-runtime", "python", "bin", "python")
      ]);
      if (py) env.QIWORK_DESKTOP_PY_RUNTIME = py;
      const nodeRoot = path.join(binaries, "node-runtime");
      const nodeBin = process.platform === "win32" ? path.join(nodeRoot, "node.exe") : path.join(nodeRoot, "bin", "node");
      if (fs.existsSync(nodeBin)) env.QIWORK_DESKTOP_NODE_RUNTIME = nodeRoot;
    }
    return env;
  }
  buildConnectCommand() {
    if (isDev()) {
      const qwcRoot = process.env.QIWORKCONNECT_ROOT ?? path.resolve(electron.app.getAppPath(), "../../QiWorkConnect");
      const apiDir = path.join(qwcRoot, "apps", "api");
      return {
        exe: "uv",
        args: ["run", "python", "-m", "qiworkconnect.desktop_entry"],
        cwd: apiDir,
        extraEnv: { PYTHONPATH: path.join(apiDir, "src") }
      };
    }
    const binaries = resourcesBinariesDir();
    const exeName = process.platform === "win32" ? "qiworkconnect.exe" : "qiworkconnect";
    const exe = path.join(binaries, "qiwork", "qiworkconnect", exeName);
    return { exe, args: [], cwd: path.dirname(exe) };
  }
  buildGatewayCommand() {
    if (isDev()) {
      const repoRoot = path.resolve(electron.app.getAppPath(), "..");
      return {
        exe: "uv",
        args: ["run", "python", "-m", "qiwork.desktop.entry"],
        cwd: repoRoot,
        extraEnv: { PYTHONPATH: path.join(repoRoot, "src") }
      };
    }
    const binaries = resourcesBinariesDir();
    const exeName = process.platform === "win32" ? "qiwork.exe" : "qiwork";
    const exe = path.join(binaries, "qiwork", exeName);
    return { exe, args: [], cwd: path.dirname(exe) };
  }
  failBackend(win, msg, title) {
    if (this.state.backend.state === "failed") return;
    this.clearCoreDeadline();
    this.clearAgentDeadline();
    this.state = reduceRuntimeState(this.state, {
      kind: "backend-exit",
      message: msg
    });
    showDesktopNotification(title, msg);
    this.publish(win);
  }
  watchChild(child, kind, gen, win) {
    let lastStderr = "";
    const label = kind === "backend" ? "backend" : "qiworkconnect";
    const onLine = (line, stream) => {
      if (stream === "stdout") {
        console.info(`[${label}:${gen}] stdout: ${line}`);
      } else {
        console.error(`[${label}:${gen}] stderr: ${line}`);
        lastStderr = trimCapturedStderr(`${lastStderr}${line}
`);
      }
      if (!this.isCurrent(gen)) return;
      if (stream === "stdout") this.applyAnnounce(win, gen, line);
    };
    if (child.stdout) {
      readline.createInterface({ input: child.stdout }).on("line", (line) => {
        onLine(line, "stdout");
      });
    }
    if (child.stderr) {
      readline.createInterface({ input: child.stderr }).on("line", (line) => {
        onLine(line, "stderr");
      });
    }
    child.on("error", (err) => {
      if (!this.isCurrent(gen)) return;
      const msg = `${label} spawn error: ${err.message}`;
      if (kind === "backend") {
        this.failBackend(win, msg, "后端启动失败");
        return;
      }
      this.degradeConnect(win, `[${label}:${gen}] ${msg}`);
    });
    child.on("exit", (code, signal) => {
      if (!this.isCurrent(gen)) return;
      if (kind === "backend") {
        const wasUp = this.state.backend.state === "up";
        const msg = [
          `${label} exited code=${code ?? "null"} signal=${signal ?? "null"}`,
          lastStderr ? `stderr:
${lastStderr}` : ""
        ].filter(Boolean).join("\n");
        this.failBackend(win, msg, wasUp ? "后端已退出" : "后端启动失败");
        return;
      }
      if (this.state.connect.state !== "starting") return;
      this.degradeConnect(
        win,
        `[${label}:${gen}] exited code=${code ?? "null"} signal=${signal ?? "null"}`
      );
    });
  }
}
const sidecar = new SidecarManager();
const allowed = /* @__PURE__ */ new Set();
function loadCertExceptions(hosts) {
  allowed.clear();
  for (const host of hosts) {
    const name = host.trim().toLowerCase();
    if (name) allowed.add(name);
  }
}
function certExceptionHosts() {
  return [...allowed];
}
function isCertAllowed(host) {
  return Boolean(host) && allowed.has(host.trim().toLowerCase());
}
function allowCertHost(host) {
  const name = host.trim().toLowerCase();
  if (name) allowed.add(name);
}
function isCertError(description) {
  return /^ERR_CERT_/.test(description);
}
function certOriginalUrl(href) {
  try {
    return new URL(href).searchParams.get("url");
  } catch {
    return null;
  }
}
function isCertWarningUrl(raw) {
  return /(?:^|[\\/])desktop-cert-warning\.html(?:[?#]|$)/.test(raw);
}
const INTERNAL_ALIASES = /* @__PURE__ */ new Set([
  "qiwork://newtab",
  "qiwork://newtab/",
  "about:newtab",
  "qiwork://history",
  "qiwork://history/",
  "qiwork://downloads",
  "qiwork://downloads/"
]);
const NAVIGATE = /* @__PURE__ */ new Set([
  "http:",
  "https:",
  "chrome-extension:",
  "about:",
  "blob:",
  "data:"
]);
const EXTERNAL = /* @__PURE__ */ new Set(["mailto:", "tel:", "weixin:"]);
function isInternalAlias(raw) {
  return INTERNAL_ALIASES.has(raw.trim().toLowerCase());
}
function isGuestInternalPageUrl(raw) {
  if (!/(?:^|[\\/])desktop-(newtab|history|downloads|cert-warning)\.html(?:[?#]|$)/.test(raw)) {
    return false;
  }
  try {
    const protocol = new URL(raw).protocol;
    return protocol === "file:" || protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
function classifyGuestUrl(raw) {
  const value = raw.trim();
  if (!value) return "block";
  if (isInternalAlias(value) || isGuestInternalPageUrl(value)) {
    return "navigate";
  }
  try {
    const protocol = new URL(value).protocol;
    if (NAVIGATE.has(protocol)) return "navigate";
    if (EXTERNAL.has(protocol)) return "external";
    return "block";
  } catch {
    return "block";
  }
}
const GUEST_PARTITIONS = {
  primary: "persist:guest-primary",
  "1688": "persist:guest-1688",
  google: "persist:guest-google",
  merchant: "persist:guest-merchant"
};
const MERCHANT_DOMAINS = [
  "sycm.taobao.com",
  "myseller.taobao.com",
  "loginmyseller.taobao.com",
  "alimama.com",
  "alimama.hk",
  "dmp.taobao.com",
  "upload.taobao.com",
  "trade.taobao.com",
  "sell.publish.tmall.com",
  "ipublish.tmall.com",
  "zhaoshang.tmall.com",
  "taofenxiao.taobao.com",
  "jingya-x.taobao.com",
  "abujlb.com",
  "ecbis.cn",
  "zhixiaoengine.chinatinghai.com"
];
const GENERIC_LOGIN_DOMAINS = [
  "login.taobao.com",
  "passport.taobao.com",
  "havanalogin.taobao.com"
];
const GOOGLE_DOMAINS = ["google.com", "youtube.com"];
const TAOBAO_PRIMARY_HOSTS = [
  "taobao.com",
  "www.taobao.com",
  "s.taobao.com",
  "item.taobao.com",
  "cart.taobao.com",
  "buy.taobao.com",
  "buyertrade.taobao.com",
  "favorite.taobao.com",
  "i.taobao.com",
  "member1.taobao.com",
  "rate.taobao.com",
  "refund.taobao.com",
  "consumerservice.taobao.com",
  "shop.taobao.com",
  "pages.taobao.com",
  "ju.taobao.com",
  "tejia.taobao.com",
  "uland.taobao.com",
  "click.mz.simba.taobao.com",
  "click.simba.taobao.com"
];
const DOUYIN_COMPASS_HOST = "compass.jinritemai.com";
const ALI_SENSITIVE_HOSTS = ["gongxiao.tmall.com"];
function hostOf$2(raw) {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}
function matchesSuffix(host, domains) {
  return domains.some((raw) => {
    const domain = raw.trim().toLowerCase();
    return Boolean(domain) && (host === domain || host.endsWith(`.${domain}`));
  });
}
function matchesExact(host, hosts) {
  return hosts.some((raw) => raw.trim().toLowerCase() === host);
}
function isTaobaoDotCom(host) {
  return host === "taobao.com" || host.endsWith(".taobao.com");
}
function isGenericLoginUrl(raw) {
  const host = hostOf$2(raw);
  return host ? matchesSuffix(host, GENERIC_LOGIN_DOMAINS) : false;
}
function isPrimaryTaobaoUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (!isTaobaoDotCom(host)) return false;
    if (isGenericLoginUrl(raw) || matchesExact(host, TAOBAO_PRIMARY_HOSTS) || host === "m.taobao.com" || host.endsWith(".m.taobao.com") || /^shop\d+\.taobao\.com$/.test(host)) {
      return true;
    }
    const path2 = url.pathname.toLowerCase();
    return path2 === "/shop/view_shop.htm" || /^\/(?:category|search)(?:[-_\w]*)?\.htm$/.test(path2);
  } catch {
    return false;
  }
}
function isUnknownTaobaoUrl(raw) {
  const host = hostOf$2(raw);
  if (!host || !isTaobaoDotCom(host) || matchesSuffix(host, MERCHANT_DOMAINS)) return false;
  return !isPrimaryTaobaoUrl(raw);
}
function isAliSensitiveUrl(raw) {
  if (categoryForUrl(raw) !== "primary") return false;
  if (isUnknownTaobaoUrl(raw)) return true;
  const host = hostOf$2(raw);
  return Boolean(host && matchesExact(host, ALI_SENSITIVE_HOSTS));
}
function categoryForUrl(raw) {
  const host = hostOf$2(raw);
  if (!host || host === DOUYIN_COMPASS_HOST) return "primary";
  if (matchesSuffix(host, ["1688.com"])) return "1688";
  if (matchesSuffix(host, ["alipay.com"])) return "primary";
  if (matchesSuffix(host, GOOGLE_DOMAINS)) return "google";
  if (matchesSuffix(host, MERCHANT_DOMAINS)) return "merchant";
  return "primary";
}
function categoryFromPartition(partition) {
  const hit = Object.entries(GUEST_PARTITIONS).find(
    ([, value]) => value === partition
  );
  return hit?.[0] ?? "primary";
}
function targetCategoryForUrl(current, raw) {
  const host = hostOf$2(raw);
  if (host === DOUYIN_COMPASS_HOST) return current === "primary" ? null : "primary";
  if (isAliSensitiveUrl(raw)) {
    return current === "primary" || current === "merchant" ? null : "primary";
  }
  const target = categoryForUrl(raw);
  return target === "primary" || target === current ? null : target;
}
function partitionForCategory(category) {
  return GUEST_PARTITIONS[category];
}
function partitionForUrl(raw, current) {
  const jar = current ?? GUEST_PARTITIONS.primary;
  const value = raw.trim();
  if (!value || isInternalAlias(value) || isGuestInternalPageUrl(value)) return jar;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return jar;
  } catch {
    return jar;
  }
  const currentCategory = categoryFromPartition(jar);
  if (!current) return partitionForCategory(categoryForUrl(value));
  const next = targetCategoryForUrl(currentCategory, value);
  return next ? partitionForCategory(next) : jar;
}
function isGuestPartitionName(name) {
  return name.startsWith("persist:guest-");
}
const FALLBACK_CHROME = "140.0.7339.207";
const LOW_ENTROPY = ["Sec-Ch-Ua", "Sec-Ch-Ua-Mobile", "Sec-Ch-Ua-Platform"];
const GREASE_BY_MAJOR = {
  140: { brand: "Not=A?Brand", version: "24" },
  148: { brand: "Not/A)Brand", version: "99" }
};
function chromeVersions(raw = process.versions.chrome) {
  const full = raw && /^\d+\.\d+/.test(raw) ? raw : FALLBACK_CHROME;
  return { full, major: full.split(".")[0] ?? "140" };
}
function greaseFor(major) {
  const hit = GREASE_BY_MAJOR[Number(major)];
  if (hit) return hit;
  const latest = Math.max(...Object.keys(GREASE_BY_MAJOR).map(Number));
  return GREASE_BY_MAJOR[latest] ?? GREASE_BY_MAJOR[140];
}
function uaPlatform(platform) {
  if (platform === "darwin") return "Macintosh; Intel Mac OS X 10_15_7";
  if (platform === "linux") return "X11; Linux x86_64";
  return "Windows NT 10.0; Win64; x64";
}
function hintPlatform(platform) {
  if (platform === "darwin") return '"macOS"';
  if (platform === "linux") return '"Linux"';
  return '"Windows"';
}
function chromeUserAgent(platform = process.platform, chromeVersion = process.versions.chrome) {
  const { major } = chromeVersions(chromeVersion);
  return `Mozilla/5.0 (${uaPlatform(platform)}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}
function chromeClientHintHeaders(platform = process.platform, chromeVersion = process.versions.chrome, brand = "chromium") {
  const { full, major } = chromeVersions(chromeVersion);
  const grease = greaseFor(major);
  const brands = brand === "chrome" ? `"${grease.brand}";v="${grease.version}", "Google Chrome";v="${major}", "Chromium";v="${major}"` : `"${grease.brand}";v="${grease.version}", "Chromium";v="${major}"`;
  const fullList = brand === "chrome" ? `"${grease.brand}";v="${grease.version}.0.0.0", "Google Chrome";v="${full}", "Chromium";v="${full}"` : `"${grease.brand}";v="${grease.version}.0.0.0", "Chromium";v="${full}"`;
  return {
    "Sec-Ch-Ua": brands,
    "Sec-Ch-Ua-Full-Version-List": fullList,
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": hintPlatform(platform)
  };
}
function isDouyinUrl(raw) {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === "douyin.com" || host.endsWith(".douyin.com");
  } catch {
    return false;
  }
}
function mergeClientHints(headers, url, hints) {
  const next = { ...headers };
  const https = /^https:\/\//i.test(url);
  const low = new Set(LOW_ENTROPY.map((key) => key.toLowerCase()));
  for (const [key, value] of Object.entries(hints)) {
    const existing = Object.keys(next).find((name) => name.toLowerCase() === key.toLowerCase());
    if (existing) {
      next[existing] = value;
      continue;
    }
    if (https && low.has(key.toLowerCase())) next[key] = value;
  }
  return next;
}
function applyChromeIdentity(ses) {
  const ua = chromeUserAgent();
  const chromium = chromeClientHintHeaders(process.platform, process.versions.chrome, "chromium");
  const chrome = chromeClientHintHeaders(process.platform, process.versions.chrome, "chrome");
  ses.setUserAgent(ua);
  ses.webRequest.onBeforeSendHeaders({ urls: ["http://*/*", "https://*/*"] }, (details, callback) => {
    const hints = isDouyinUrl(details.url) ? chrome : chromium;
    const headers = mergeClientHints(details.requestHeaders, details.url, hints);
    const uaKey = Object.keys(headers).find((key) => key.toLowerCase() === "user-agent");
    if (uaKey) headers[uaKey] = ua;
    else headers["User-Agent"] = ua;
    callback({ requestHeaders: headers });
  });
}
function hostOf$1(raw) {
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}
function isDouyinHost(host) {
  return Boolean(host && (host === "douyin.com" || host.endsWith(".douyin.com")));
}
function allowGuestPermission(permission, details = {}) {
  if (permission === "notifications") return false;
  if (permission === "openExternal") {
    return !isDouyinHost(hostOf$1(details.requestingUrl));
  }
  return true;
}
const configured = /* @__PURE__ */ new WeakSet();
const known = /* @__PURE__ */ new Set([GUEST_PARTITIONS.primary]);
const readyHooks = [];
function onGuestSessionReady(hook) {
  readyHooks.push(hook);
}
function installGuestPermissionPolicy(ses) {
  ses.setPermissionCheckHandler(
    (_wc, permission, _origin, details) => allowGuestPermission(permission, {
      requestingUrl: details.requestingUrl
    })
  );
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(
      allowGuestPermission(permission, {
        requestingUrl: details.requestingUrl || wc.getURL()
      })
    );
  });
}
function ensureGuestSession(partition = GUEST_PARTITIONS.primary) {
  const ses = electron.session.fromPartition(partition);
  if (configured.has(ses)) return ses;
  configured.add(ses);
  known.add(partition);
  applyChromeIdentity(ses);
  installGuestPermissionPolicy(ses);
  for (const hook of readyHooks) hook(ses);
  return ses;
}
function isGuestSession(ses) {
  const partition = ses.partition ?? "";
  return configured.has(ses) || isGuestPartitionName(partition);
}
function allGuestSessions() {
  return [...known].map((partition) => ensureGuestSession(partition));
}
const guardedGuestContents = /* @__PURE__ */ new WeakSet();
const certPending = /* @__PURE__ */ new WeakMap();
let certErrorsHooked = false;
function loadGuestLocation(wc, raw) {
  const kind = guestInternalKind(raw);
  if (kind) {
    loadGuestRendererPage(wc, `desktop-${kind}.html`);
    return;
  }
  if (raw) void wc.loadURL(raw);
}
function guestExtensionDirs() {
  const remote = cachedMeifannaoDir();
  return remote && fs.existsSync(path.join(remote, "manifest.json")) ? [remote] : [];
}
function toGuestExtension(ext) {
  const manifest = ext.manifest;
  const popup = manifest.action?.default_popup?.trim() ?? "";
  const icons = manifest.action?.default_icon;
  const iconRel = (typeof icons === "string" ? icons : icons?.["38"] || icons?.["64"] || icons?.["32"]) || manifest.icons?.["38"] || manifest.icons?.["64"] || "";
  const iconFile = iconRel ? path.join(ext.path, iconRel) : "";
  return {
    id: ext.id,
    name: ext.name || "扩展",
    popupUrl: popup ? `chrome-extension://${ext.id}/${popup.replace(/^\//, "")}` : "",
    iconDataUrl: iconFile && fs.existsSync(iconFile) ? `data:${iconFile.endsWith(".svg") ? "image/svg+xml" : "image/png"};base64,${fs.readFileSync(iconFile).toString("base64")}` : ""
  };
}
const GROUP_COLORS = [
  "blue",
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "purple",
  "pink",
  "grey"
];
function sanitizeBounds(bounds) {
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height))
  };
}
function normalizeBrowserUrl(raw) {
  const value = raw.trim();
  if (!value) return guestNewtabUrl();
  const alias = value.toLowerCase();
  if (alias === "qiwork://history" || alias === "qiwork://history/") {
    return guestHistoryUrl();
  }
  if (alias === "qiwork://downloads" || alias === "qiwork://downloads/") {
    return guestDownloadsUrl();
  }
  if (alias === "qiwork://newtab" || alias === "qiwork://newtab/" || alias === "about:newtab") {
    return guestNewtabUrl();
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    try {
      if (new URL(value).protocol === "file:") return "";
    } catch {
      return "";
    }
    return classifyGuestUrl(value) === "navigate" && !isInternalAlias(value) ? value : "";
  }
  if (value.includes(" ") || !value.includes(".")) {
    return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
  }
  return `https://${value}`;
}
function isBlankUrl(url) {
  return !url || url === "about:blank" || guestInternalKind(url) === "newtab";
}
function workbenchKeyOf(redirect) {
  return redirect.startsWith("/industry") ? "industry" : "bi";
}
function displayUrl(url) {
  if (isBlankUrl(url)) return "";
  if (isCertWarningUrl(url)) return certOriginalUrl(url) || "连接不是私密连接";
  const kind = guestInternalKind(url);
  if (kind === "history") return "qiwork://history";
  if (kind === "downloads") return "qiwork://downloads";
  return url;
}
function displayTitle(url, title) {
  if (isBlankUrl(url)) return "首页";
  if (isCertWarningUrl(url)) return "连接不是私密连接";
  const kind = guestInternalKind(url);
  if (kind === "history") return "历史记录";
  if (kind === "downloads") return "下载记录与设置";
  return title || url;
}
async function resolveBiSsoUrl(redirect) {
  const port = sidecar.getRuntimeState().backend.port;
  if (!port) throw new Error("backend not ready");
  const query = new URLSearchParams({ redirect, layout: "sidebar" });
  const target = `http://127.0.0.1:${port}/api/v1/auth/bi-sso-url?${query}`;
  const res = await electron.session.defaultSession.fetch(target);
  if (!res.ok) throw new Error(`sso ${res.status}`);
  const data = await res.json();
  if (!data.url) throw new Error("missing sso url");
  return data.url;
}
function hasSsoTicket(url) {
  return url.toLowerCase().includes("ticket=");
}
function needsFreshSso(url) {
  if (isBlankUrl(url)) return true;
  return url.toLowerCase().includes("invalid_ticket");
}
function isWorkbenchSettled(url) {
  return !isBlankUrl(url) && !hasSsoTicket(url);
}
function enforceGroupContiguity(order, groupOf) {
  const result = [];
  const placed = /* @__PURE__ */ new Set();
  for (const id of order) {
    const gid = groupOf(id);
    if (!gid) {
      result.push(id);
      continue;
    }
    if (placed.has(gid)) continue;
    placed.add(gid);
    for (const other of order) {
      if (groupOf(other) === gid) result.push(other);
    }
  }
  return result;
}
function persistPath(name) {
  return path.join(electron.app.getPath("userData"), "guest-browser", name);
}
function isUsableDirectory(dir) {
  try {
    return Boolean(dir) && fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}
const ZOOM_STEPS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500];
function clampZoom(value) {
  if (!Number.isFinite(value)) return 100;
  return Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], Math.round(value)));
}
function nextZoom(current, dir) {
  let nearest = 0;
  for (let i = 1; i < ZOOM_STEPS.length; i += 1) {
    if (Math.abs(ZOOM_STEPS[i] - current) < Math.abs(ZOOM_STEPS[nearest] - current)) nearest = i;
  }
  const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1, nearest + (dir === "in" ? 1 : -1)));
  return ZOOM_STEPS[next];
}
function sanitizeBookmarks(items) {
  return items.filter((item) => item?.url).map((item) => ({
    id: item.id || crypto.randomUUID(),
    title: item.title?.trim() || item.url,
    url: item.url.trim()
  }));
}
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}
function rangeCutoff(range) {
  const now = Date.now();
  if (range === "all") return null;
  const span = range === "last-15min" ? 15 * 60 * 1e3 : range === "last-hour" ? 60 * 60 * 1e3 : range === "last-24h" ? 24 * 60 * 60 * 1e3 : range === "last-7d" ? 7 * 24 * 60 * 60 * 1e3 : 28 * 24 * 60 * 60 * 1e3;
  return now - span;
}
function browserSourceDefs() {
  const home = electron.app.getPath("home");
  if (process.platform === "darwin") {
    return [
      { id: "chrome", name: "Chrome", rel: path.join(home, "Library/Application Support/Google/Chrome/Default/Bookmarks") },
      { id: "edge", name: "Edge", rel: path.join(home, "Library/Application Support/Microsoft Edge/Default/Bookmarks") },
      { id: "brave", name: "Brave", rel: path.join(home, "Library/Application Support/BraveSoftware/Brave-Browser/Default/Bookmarks") },
      { id: "arc", name: "Arc", rel: path.join(home, "Library/Application Support/Arc/User Data/Default/Bookmarks") }
    ];
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? "";
    return [
      { id: "chrome", name: "Chrome", rel: path.join(local, "Google/Chrome/User Data/Default/Bookmarks") },
      { id: "edge", name: "Edge", rel: path.join(local, "Microsoft/Edge/User Data/Default/Bookmarks") }
    ];
  }
  const config = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
  return [
    { id: "chrome", name: "Chrome", rel: path.join(config, "google-chrome/Default/Bookmarks") },
    { id: "edge", name: "Edge", rel: path.join(config, "microsoft-edge/Default/Bookmarks") }
  ];
}
function sourcePath(id) {
  return browserSourceDefs().find((item) => item.id === id)?.rel ?? "";
}
function flattenChromeBookmarks(node, out) {
  if (!node || typeof node !== "object") return;
  const item = node;
  if (item.type === "url" && item.url) {
    out.push({ id: crypto.randomUUID(), title: item.name || item.url, url: item.url });
  }
  for (const child of item.children ?? []) flattenChromeBookmarks(child, out);
}
function readChromeBookmarkFile(file) {
  if (!file || !fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const out = [];
    for (const root of Object.values(data.roots ?? {})) flattenChromeBookmarks(root, out);
    return out;
  } catch {
    return [];
  }
}
function listBrowserImportSources() {
  return browserSourceDefs().filter((item) => fs.existsSync(item.rel)).map((item) => ({
    id: item.id,
    name: item.name,
    count: readChromeBookmarkFile(item.rel).length
  })).filter((item) => item.count > 0);
}
function parseBookmarkHtml(html) {
  const out = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi;
  let match = re.exec(html);
  while (match) {
    const url = match[1]?.trim();
    if (url && /^https?:/i.test(url)) {
      out.push({ id: crypto.randomUUID(), title: match[2]?.trim() || url, url });
    }
    match = re.exec(html);
  }
  return out;
}
function applyHardwareAccelerationPreference() {
  try {
    const settings = readJson(
      path.join(electron.app.getPath("userData"), "guest-browser", "settings.json"),
      {}
    );
    if (settings.hardwareAccelerationEnabled === false) {
      electron.app.disableHardwareAcceleration();
    }
  } catch {
  }
}
class GuestBrowserHost {
  host = null;
  bounds = { x: 0, y: 0, width: 0, height: 0 };
  tabs = /* @__PURE__ */ new Map();
  groups = /* @__PURE__ */ new Map();
  order = [];
  activeTabId = null;
  visible = false;
  history = [];
  downloads = [];
  downloadItems = /* @__PURE__ */ new Map();
  closed = [];
  downloadsHooked = /* @__PURE__ */ new WeakSet();
  persistReady = false;
  sessionHooksReady = false;
  toolbar = null;
  chromeHeight = 88;
  overlayOpen = false;
  hostOverlay = false;
  overlayShot = null;
  overlayShotAt = 0;
  overlayGen = 0;
  overlayAcked = false;
  overlayReady = null;
  captureInFlight = null;
  askWhereToSave = false;
  showWhenComplete = false;
  downloadDirectory = "";
  downloadScopes = /* @__PURE__ */ new Map();
  zoomPercent = 100;
  doubleClickClosesTab = false;
  hardwareAccelerationEnabled = true;
  hardwareAccelerationEnabledAtLaunch = true;
  barVisible = false;
  shellMode = "browser";
  bookmarks = [];
  importSources = [];
  extensions = [];
  extensionPopup = null;
  popupFitTimer = null;
  uiTheme = null;
  workbenchLoad = null;
  workbenchEpoch = 0;
  workbenchWaitAbort = null;
  attach(win) {
    this.host = win;
    if (!this.sessionHooksReady) {
      this.sessionHooksReady = true;
      onGuestSessionReady((ses) => {
        this.hookDownloadsOn(ses);
        void this.loadExtensionsInto(ses);
      });
    }
    ensureGuestSession(GUEST_PARTITIONS.primary);
    this.hookGuestContents();
    this.hookCertificateErrors();
    this.ensurePersist();
    win.on("closed", () => {
      if (this.host === win) this.destroy();
    });
  }
  snapshot() {
    this.normalizeOrder();
    return {
      activeTabId: this.activeTabId,
      tabs: this.order.filter((id) => !this.tabs.get(id)?.appKey).map((id) => this.toTab(id)).filter(Boolean),
      groups: [...this.groups.values()],
      history: this.history.slice(0, 500),
      downloads: this.downloads.slice(0, 50),
      closed: this.closed.slice(-25).reverse().map((entry) => this.toClosed(entry)),
      chromeHeight: this.chromeHeight,
      askWhereToSave: this.askWhereToSave,
      showWhenComplete: this.showWhenComplete,
      downloadDirectory: this.resolvedDownloadDirectory(),
      downloadDirectoryAvailable: isUsableDirectory(this.resolvedDownloadDirectory()),
      permission: this.downloads.filter((item) => item.state === "awaiting-permission").map((item) => ({ id: item.id, filename: item.filename, url: item.url }))[0] ?? null,
      zoomPercent: this.zoomPercent,
      doubleClickClosesTab: this.doubleClickClosesTab,
      hardwareAccelerationEnabled: this.hardwareAccelerationEnabled,
      hardwareAccelerationEnabledAtLaunch: this.hardwareAccelerationEnabledAtLaunch,
      barVisible: this.barVisible,
      bookmarks: [...this.bookmarks],
      importSources: [...this.importSources],
      extensions: [...this.extensions]
    };
  }
  show(win, bounds) {
    this.host = win;
    this.bounds = sanitizeBounds(bounds);
    this.visible = true;
    this.ensurePersist();
    this.ensureToolbar();
    if (this.order.length === 0) this.createTab("");
    else this.layout();
    if (this.hostOverlay && this.overlayShot) this.emitOverlay(this.overlayShot);
    void guestHistory.recent(500).then((rows) => {
      this.history = rows;
      this.emit();
    });
    this.emit();
    return this.snapshot();
  }
  hide() {
    this.visible = false;
    this.closeExtensionPopup();
    this.layout();
  }
  setBounds(bounds) {
    this.bounds = sanitizeBounds(bounds);
    this.layout();
  }
  newTab(url, groupId) {
    this.closeExtensionPopup();
    const id = this.createTab(url ?? "");
    if (groupId) this.addTabToGroup(id, groupId);
    this.emit();
    return this.snapshot();
  }
  closeTab(id) {
    this.removeTab(id, true);
    return this.snapshot();
  }
  switchTab(id) {
    this.closeExtensionPopup();
    if (!this.tabs.has(id)) return this.snapshot();
    this.activeTabId = id;
    const groupId = this.tabs.get(id)?.groupId;
    if (groupId) {
      const group = this.groups.get(groupId);
      if (group) group.collapsed = false;
    }
    this.layout();
    this.emit();
    return this.snapshot();
  }
  navigate(url) {
    this.closeExtensionPopup();
    const next = normalizeBrowserUrl(url);
    if (this.activeTabId && next) this.loadInTab(this.activeTabId, next);
    return this.snapshot();
  }
  goBack() {
    const wc = this.activeContents();
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    return this.snapshot();
  }
  goForward() {
    const wc = this.activeContents();
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    return this.snapshot();
  }
  reload(hard = false) {
    const wc = this.activeContents();
    if (wc && !wc.isDestroyed()) {
      if (hard) wc.reloadIgnoringCache();
      else wc.reload();
    }
    return this.snapshot();
  }
  goHome() {
    this.closeExtensionPopup();
    if (this.activeTabId) this.loadInTab(this.activeTabId, guestNewtabUrl());
    return this.snapshot();
  }
  stop() {
    const wc = this.activeContents();
    if (wc && !wc.isDestroyed()) wc.stop();
    return this.snapshot();
  }
  async command(cmd) {
    try {
      switch (cmd.op) {
        case "dragTab":
          this.dragTab(cmd.tabId, cmd.beforeId ?? null, cmd.groupId ?? null);
          break;
        case "setPinned":
          this.setPinned(cmd.id, cmd.pinned);
          break;
        case "group":
          this.handleGroupAction(cmd);
          break;
        case "reopenClosed":
          this.reopenClosed(cmd.entryId);
          break;
        case "closeOthers":
          for (const id of [...this.order]) {
            if (id !== cmd.id && !this.tabs.get(id)?.appKey) this.removeTab(id, true);
          }
          break;
        case "closeRight": {
          const idx = this.order.indexOf(cmd.id);
          if (idx >= 0) {
            for (const id of this.order.slice(idx + 1)) {
              if (!this.tabs.get(id)?.appKey) this.removeTab(id, true);
            }
          }
          break;
        }
        case "duplicate": {
          const tab = this.toTab(cmd.id);
          if (tab?.url) this.createTab(tab.url);
          break;
        }
        case "removeHistory":
          void guestHistory.remove(cmd.ids).then(async () => {
            this.history = await guestHistory.recent(500);
            this.emit();
          });
          break;
        case "openDownload":
          this.openDownload(cmd.id);
          break;
        case "revealDownload":
          this.revealDownload(cmd.id);
          break;
        case "cancelDownload":
          this.downloadItems.get(cmd.id)?.cancel();
          break;
        case "pauseDownload": {
          const rec = this.downloads.find((item) => item.id === cmd.id);
          this.downloadItems.get(cmd.id)?.pause();
          if (rec && rec.state !== "awaiting-permission") rec.state = "paused";
          break;
        }
        case "resumeDownload": {
          const rec = this.downloads.find((item) => item.id === cmd.id);
          try {
            this.downloadItems.get(cmd.id)?.resume();
            if (rec && rec.state !== "awaiting-permission") rec.state = "progressing";
          } catch {
          }
          break;
        }
        case "removeDownload":
          this.downloads = this.downloads.filter((item) => item.id !== cmd.id);
          this.downloadItems.get(cmd.id)?.cancel();
          this.downloadItems.delete(cmd.id);
          this.saveDownloads();
          break;
        case "clearFinishedDownloads":
          this.downloads = this.downloads.filter((item) => {
            return item.state === "progressing" || item.state === "paused" || item.state === "awaiting-permission" || item.state === "interrupted";
          });
          this.saveDownloads();
          break;
        case "chooseDownloadDirectory":
          await this.chooseDownloadDirectory();
          break;
        case "setDownloadDirectory":
          this.applyDownloadDirectory(cmd.path);
          break;
        case "openDownloadDirectory":
          await electron.shell.openPath(this.resolvedDownloadDirectory());
          break;
        case "allowDownload":
          this.resolveDownload(cmd.id, true);
          break;
        case "denyDownload":
          this.resolveDownload(cmd.id, false);
          break;
        case "setAskWhereToSave":
          this.askWhereToSave = cmd.value;
          this.saveSettings();
          break;
        case "setShowWhenComplete":
          this.showWhenComplete = cmd.value;
          this.saveSettings();
          break;
        case "setChromeHeight": {
          const next = Math.max(88, Math.round(cmd.height));
          if (next !== this.chromeHeight) this.chromeHeight = next;
          break;
        }
        case "setPanel":
          this.loadInternal(cmd.panel);
          break;
        case "openShortcut":
          await this.openShortcut(cmd.redirect);
          break;
        case "openBrowser":
          this.openBrowser();
          break;
        case "openExtensionPopup":
          this.openExtensionPopup(cmd.id, cmd.x, cmd.y, cmd.width);
          break;
        case "setOverlayOpen":
          this.overlayOpen = cmd.open;
          if (cmd.open) this.closeExtensionPopup();
          break;
        case "setHostOverlay":
          await this.applyHostOverlay(cmd.open);
          break;
        case "prefetchHostOverlay":
          await this.prefetchHostOverlay();
          break;
        case "applyTheme":
          if (cmd.themeMode === "light" || cmd.themeMode === "dark" || cmd.themeMode === "system") {
            this.uiTheme = { themeMode: cmd.themeMode, isDark: Boolean(cmd.isDark) };
            this.pushTheme();
          }
          break;
        case "setBarVisible":
          this.barVisible = cmd.value;
          this.saveSettings();
          break;
        case "setDoubleClickCloseTab":
          this.doubleClickClosesTab = cmd.value;
          this.saveSettings();
          break;
        case "setHardwareAcceleration":
          this.hardwareAccelerationEnabled = cmd.value;
          this.saveSettings();
          break;
        case "restartForHardwareAcceleration":
          this.saveSettings();
          electron.app.relaunch();
          electron.app.exit(0);
          break;
        case "setZoom":
          this.zoomPercent = nextZoom(this.zoomPercent, cmd.dir);
          this.applyZoom();
          break;
        case "toggleFullscreen": {
          const win = this.host;
          if (win && !win.isDestroyed()) win.setFullScreen(!win.isFullScreen());
          break;
        }
        case "toggleBookmark":
          this.toggleBookmark(cmd.url, cmd.title);
          break;
        case "updateBookmark":
          this.updateBookmark(cmd.id, cmd.title, cmd.url);
          break;
        case "removeBookmark":
          this.bookmarks = this.bookmarks.filter((item) => item.id !== cmd.id);
          this.saveSettings();
          break;
        case "setBookmarks":
          this.bookmarks = sanitizeBookmarks(cmd.bookmarks);
          this.saveSettings();
          break;
        case "importBookmarksHtml":
          await this.importBookmarksHtml();
          break;
        case "importBrowserData":
          await this.importBrowserData(cmd.sourceId);
          break;
        case "clearData":
          await this.clearData(cmd);
          break;
        case "allowCert":
          this.allowCertificate(cmd.host, cmd.url);
          break;
        case "denyCert":
          this.denyCertificate();
          break;
      }
    } catch {
    }
    this.layout();
    this.emit();
    return this.snapshot();
  }
  destroy() {
    for (const entry of this.tabs.values()) this.closeView(entry.view);
    this.tabs.clear();
    this.groups.clear();
    this.order = [];
    this.activeTabId = null;
    this.visible = false;
    this.host = null;
    if (this.toolbar) {
      this.closeView(this.toolbar);
      this.toolbar = null;
    }
    this.overlayReady?.resolve();
    this.overlayReady = null;
    this.overlayShot = null;
    this.overlayShotAt = 0;
    this.overlayAcked = false;
    this.closeExtensionPopup();
    guestHistory.shutdown();
  }
  guestContentsHooked = false;
  hookGuestContents() {
    if (this.guestContentsHooked) return;
    this.guestContentsHooked = true;
    electron.app.on("web-contents-created", (_event, wc) => {
      if (!isGuestSession(wc.session)) return;
      this.protectGuestContents(wc);
    });
  }
  openerAppKey(wc) {
    return [...this.tabs.values()].find((tab) => tab.view.webContents === wc)?.appKey ?? null;
  }
  openGuestUrl(target, appKey) {
    const action = classifyGuestUrl(target);
    if (action === "external") {
      void electron.shell.openExternal(target);
      this.emit();
      return;
    }
    if (action !== "navigate") {
      this.emit();
      return;
    }
    this.createTab(normalizeBrowserUrl(target) || guestNewtabUrl(), { appKey });
    this.emit();
  }
  hookCertificateErrors() {
    if (certErrorsHooked) return;
    certErrorsHooked = true;
    electron.app.on("certificate-error", (event, wc, url, _error, _certificate, callback) => {
      const host = hostOf(url);
      const allow = isGuestSession(wc.session) && Boolean(host) && isCertAllowed(host);
      if (allow) event.preventDefault();
      callback(allow);
    });
  }
  showCertInterstitial(wc, failedUrl, code) {
    if (wc.isDestroyed() || isCertAllowed(hostOf(failedUrl))) return;
    certPending.set(wc, failedUrl);
    wc.stop();
    loadGuestCertWarning(wc, {
      url: failedUrl,
      host: hostOf(failedUrl),
      code
    });
  }
  allowCertificate(host, url) {
    const wc = this.activeContents();
    if (!wc) return;
    const orig = certPending.get(wc) || url;
    if (!orig) return;
    certPending.delete(wc);
    allowCertHost(host || hostOf(orig));
    this.saveSettings();
    void wc.loadURL(orig);
  }
  denyCertificate() {
    const wc = this.activeContents();
    if (wc) certPending.delete(wc);
    if (this.activeTabId) this.loadInTab(this.activeTabId, guestNewtabUrl());
  }
  tabIdOf(wc) {
    return [...this.tabs.values()].find((tab) => tab.view.webContents === wc)?.id;
  }
  /** Chromium ExternalProtocolHandler: unknown schemes stay in-process. */
  protectGuestContents(wc) {
    if (guardedGuestContents.has(wc) || wc.isDestroyed()) return;
    guardedGuestContents.add(wc);
    wc.on("will-navigate", (event, url) => {
      const action = classifyGuestUrl(url);
      const tabId = this.tabIdOf(wc);
      if (action === "navigate") {
        if (isInternalAlias(url)) {
          event.preventDefault();
          const next = normalizeBrowserUrl(url);
          if (tabId && next) this.loadInTab(tabId, next);
          else if (next) loadGuestLocation(wc, next);
          return;
        }
        if (tabId) {
          const entry = this.tabs.get(tabId);
          if (entry && partitionForUrl(url, entry.partition) !== entry.partition) {
            event.preventDefault();
            this.loadInTab(tabId, url);
          }
        }
        return;
      }
      event.preventDefault();
      if (action === "external") void electron.shell.openExternal(url);
    });
    wc.on("will-frame-navigate", (event) => {
      if (isInternalAlias(event.url) || classifyGuestUrl(event.url) !== "navigate") {
        event.preventDefault();
      }
    });
    wc.setWindowOpenHandler(({ url: target }) => {
      this.openGuestUrl(target, this.openerAppKey(wc));
      return { action: "deny" };
    });
  }
  markOverlayReady() {
    this.overlayAcked = true;
    this.overlayReady?.resolve();
    this.overlayReady = null;
  }
  createTab(url, opts) {
    const id = crypto.randomUUID();
    const next = normalizeBrowserUrl(url) || guestNewtabUrl();
    const partition = partitionForUrl(next);
    const view = this.makeTabView(partition);
    this.tabs.set(id, {
      id,
      view,
      partition,
      favicon: "",
      pinned: false,
      groupId: null,
      appKey: opts?.appKey ?? null
    });
    this.bindTabView(id, view);
    this.order.push(id);
    this.activeTabId = id;
    if (!opts?.deferLoad) this.loadInTab(id, next);
    this.ensureAttached(view);
    this.layout();
    return id;
  }
  makeTabView(partition) {
    const view = new electron.WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: ensureGuestSession(partition),
        preload: guestPreloadPath(),
        backgroundThrottling: false
      }
    });
    view.setBackgroundColor("#ffffff");
    return view;
  }
  bindTabView(id, view) {
    const wc = view.webContents;
    this.protectGuestContents(wc);
    const emitSoon = () => {
      this.layout();
      this.emit();
    };
    wc.on("page-title-updated", emitSoon);
    wc.on("did-navigate", (_event, nextUrl) => {
      this.paintGuestView(view, nextUrl);
      this.recordHistory(id, nextUrl);
      emitSoon();
    });
    wc.on("did-navigate-in-page", (_event, nextUrl, isMain) => {
      if (isMain) this.recordHistory(id, nextUrl);
      emitSoon();
    });
    wc.on("did-start-loading", () => {
      const entry = this.tabs.get(id);
      if (entry && isBlankUrl(entry.view.webContents.getURL())) entry.favicon = "";
      emitSoon();
    });
    wc.on("did-stop-loading", emitSoon);
    wc.on("did-fail-load", (_event, _code, desc, failedUrl, isMain) => {
      if (isMain && isCertError(desc) && !isCertAllowed(hostOf(failedUrl))) {
        this.showCertInterstitial(wc, failedUrl, desc);
      }
      emitSoon();
    });
    wc.on("did-finish-load", () => {
      this.paintGuestView(view, wc.getURL());
      if (isGuestInternalUrl(wc.getURL())) this.pushTheme(view);
      this.emit();
    });
    wc.on("page-favicon-updated", (_event, favicons) => {
      const entry = this.tabs.get(id);
      if (entry) entry.favicon = favicons[0] ?? "";
      this.emit();
    });
    wc.on("context-menu", (_event, params) => {
      this.showPageMenu(id, params);
    });
    this.applyZoomTo(wc);
  }
  loadInTab(id, raw) {
    const entry = this.tabs.get(id);
    if (!entry) return;
    const dest = partitionForUrl(raw, entry.partition);
    if (dest !== entry.partition) this.rebindTabSession(entry, dest);
    const wc = entry.view.webContents;
    if (!wc.isDestroyed()) loadGuestLocation(wc, raw);
  }
  rebindTabSession(entry, partition) {
    const old = entry.view;
    const view = this.makeTabView(partition);
    entry.view = view;
    entry.partition = partition;
    this.bindTabView(entry.id, view);
    this.ensureAttached(view);
    this.closeView(old);
  }
  ensureTabPartition(id, raw) {
    const entry = this.tabs.get(id);
    if (!entry) return null;
    const dest = partitionForUrl(raw, entry.partition);
    if (dest !== entry.partition) this.rebindTabSession(entry, dest);
    const wc = entry.view.webContents;
    return wc.isDestroyed() ? null : wc;
  }
  loadInternal(kind) {
    const target = kind === "history" ? guestHistoryUrl() : kind === "downloads" ? guestDownloadsUrl() : guestNewtabUrl();
    const tab = this.activeTabId ? this.toTab(this.activeTabId) : null;
    if (tab?.url && !tab.url.startsWith("qiwork://") && kind !== "newtab") {
      this.createTab(target);
      return;
    }
    if (this.activeTabId) this.loadInTab(this.activeTabId, target);
  }
  bumpWorkbenchEpoch() {
    this.workbenchEpoch += 1;
    const abort = this.workbenchWaitAbort;
    this.workbenchWaitAbort = null;
    abort?.();
    return this.workbenchEpoch;
  }
  openBrowser() {
    this.bumpWorkbenchEpoch();
    this.shellMode = "browser";
    const current = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
    if (current?.appKey) {
      const browserId = this.order.find((tabId) => !this.tabs.get(tabId)?.appKey) ?? null;
      if (browserId) this.activeTabId = browserId;
      else this.createTab("");
    } else if (!this.activeTabId) {
      this.createTab("");
    }
    this.layout();
    this.emit();
  }
  async openShortcut(redirect) {
    const epoch = this.bumpWorkbenchEpoch();
    const run = (async () => {
      if (epoch !== this.workbenchEpoch) return;
      await this.launchWorkbench(redirect, epoch);
    })();
    this.workbenchLoad = run;
    try {
      await run;
    } finally {
      if (this.workbenchLoad === run) this.workbenchLoad = null;
    }
  }
  workbenchTabId(key) {
    return this.order.find((id) => this.tabs.get(id)?.appKey === key) ?? null;
  }
  dropTicketHistory(wc) {
    try {
      wc.navigationHistory.clear();
    } catch {
    }
  }
  waitForWorkbenchPage(wc, timeoutMs = 8e3) {
    if (wc.isDestroyed()) return Promise.resolve(false);
    if (isWorkbenchSettled(wc.getURL()) && !wc.isLoading()) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (this.workbenchWaitAbort === finish) this.workbenchWaitAbort = null;
        wc.removeListener("did-navigate", onNav);
        wc.removeListener("did-navigate-in-page", onNav);
        wc.removeListener("did-stop-loading", onNav);
        const doneUrl = wc.isDestroyed() ? "" : wc.getURL();
        resolve(!wc.isDestroyed() && isWorkbenchSettled(doneUrl));
      };
      const onNav = () => {
        if (wc.isDestroyed() || isWorkbenchSettled(wc.getURL()) && !wc.isLoading()) {
          finish();
        }
      };
      this.workbenchWaitAbort = finish;
      wc.on("did-navigate", onNav);
      wc.on("did-navigate-in-page", onNav);
      wc.on("did-stop-loading", onNav);
      setTimeout(finish, timeoutMs);
    });
  }
  finishWorkbench(wc) {
    this.dropTicketHistory(wc);
    this.layout();
    this.emit();
  }
  async launchWorkbench(redirect, epoch) {
    if (epoch !== this.workbenchEpoch) return;
    this.shellMode = "app";
    const key = workbenchKeyOf(redirect);
    let id = this.workbenchTabId(key);
    if (!id) id = this.createTab("", { appKey: key, deferLoad: true });
    else this.activeTabId = id;
    const wc = this.tabs.get(id)?.view.webContents;
    if (!wc || wc.isDestroyed()) return;
    this.layout();
    this.emit();
    if (!needsFreshSso(wc.getURL())) return;
    try {
      const url = await resolveBiSsoUrl(redirect);
      if (epoch !== this.workbenchEpoch) return;
      const next = this.ensureTabPartition(id, url);
      if (!next) return;
      await next.loadURL(url);
      if (epoch !== this.workbenchEpoch) return;
      if (await this.waitForWorkbenchPage(next)) {
        if (epoch !== this.workbenchEpoch) return;
        this.finishWorkbench(next);
      }
    } catch {
    }
    if (epoch !== this.workbenchEpoch) return;
    this.layout();
    this.emit();
  }
  removeTab(id, recordClosed) {
    const entry = this.tabs.get(id);
    if (!entry) return;
    if (recordClosed) this.pushClosedTab(entry);
    this.closeView(entry.view);
    this.tabs.delete(id);
    this.order = this.order.filter((tabId) => tabId !== id);
    if (entry.groupId) this.pruneEmptyGroup(entry.groupId);
    if (this.activeTabId === id) {
      const sameKind = this.order.filter((tabId) => {
        const appKey = this.tabs.get(tabId)?.appKey ?? null;
        return entry.appKey ? Boolean(appKey) : !appKey;
      });
      this.activeTabId = sameKind.at(-1) ?? null;
    }
    if (this.shellMode === "browser" && !this.order.some((tabId) => !this.tabs.get(tabId)?.appKey)) {
      this.createTab("");
    } else if (this.order.length === 0) {
      this.shellMode = "browser";
      this.createTab("");
    }
    this.normalizeOrder();
    this.layout();
    this.emit();
  }
  dragTab(tabId, beforeId, groupId) {
    const entry = this.tabs.get(tabId);
    if (!entry || beforeId === tabId) return;
    const old = entry.groupId;
    if (groupId && this.groups.has(groupId)) {
      entry.pinned = false;
      entry.groupId = groupId;
    } else {
      entry.groupId = null;
    }
    this.moveBefore(tabId, beforeId);
    if (old && old !== entry.groupId) this.pruneEmptyGroup(old);
  }
  setPinned(id, pinned) {
    const entry = this.tabs.get(id);
    if (!entry) return;
    entry.pinned = pinned;
    if (pinned) {
      const old = entry.groupId;
      entry.groupId = null;
      if (old) this.pruneEmptyGroup(old);
    }
  }
  handleGroupAction(cmd) {
    switch (cmd.action) {
      case "create":
        if (cmd.tabId) this.createGroupFromTab(cmd.tabId);
        break;
      case "add":
        if (cmd.tabId && cmd.groupId) this.addTabToGroup(cmd.tabId, cmd.groupId);
        break;
      case "remove":
        if (cmd.tabId) this.removeTabFromGroup(cmd.tabId);
        break;
      case "update":
        if (cmd.groupId && cmd.patch) {
          const group = this.groups.get(cmd.groupId);
          if (group) Object.assign(group, cmd.patch);
        }
        break;
      case "close":
        if (cmd.groupId) this.closeGroup(cmd.groupId);
        break;
      case "ungroup":
        if (cmd.groupId) this.ungroup(cmd.groupId);
        break;
    }
  }
  createGroupFromTab(tabId) {
    const entry = this.tabs.get(tabId);
    if (!entry) return;
    if (entry.pinned) {
      this.moveBefore(tabId, this.order.find((id2) => !this.tabs.get(id2)?.pinned) ?? null);
    }
    const id = crypto.randomUUID();
    this.groups.set(id, {
      id,
      name: "",
      color: GROUP_COLORS[this.groups.size % GROUP_COLORS.length],
      collapsed: false
    });
    entry.pinned = false;
    entry.groupId = id;
  }
  addTabToGroup(tabId, groupId) {
    const entry = this.tabs.get(tabId);
    if (!entry || !this.groups.has(groupId) || entry.groupId === groupId) return;
    const members = this.membersOf(groupId);
    const first = this.order.indexOf(members[0] ?? tabId);
    const last = this.order.indexOf(members.at(-1) ?? tabId);
    const beforeId = this.order.indexOf(tabId) < first ? members[0] ?? null : this.order[last + 1] ?? null;
    if (beforeId !== tabId) this.moveBefore(tabId, beforeId);
    entry.pinned = false;
    entry.groupId = groupId;
  }
  removeTabFromGroup(tabId) {
    const entry = this.tabs.get(tabId);
    if (!entry?.groupId) return;
    const old = entry.groupId;
    const members = this.membersOf(old);
    if (members[0] !== tabId) {
      this.moveBefore(tabId, this.order[this.order.indexOf(members.at(-1) ?? tabId) + 1] ?? null);
    }
    entry.groupId = null;
    this.pruneEmptyGroup(old);
  }
  closeGroup(groupId) {
    const members = this.membersOf(groupId);
    const group = this.groups.get(groupId);
    if (!group) return;
    this.closed.push({
      kind: "group",
      id: crypto.randomUUID(),
      name: group.name,
      color: group.color,
      tabs: members.map((id) => this.toTab(id)).filter((tab) => Boolean(tab?.url)).map((tab) => ({ url: tab.url, title: tab.title, favicon: tab.favicon }))
    });
    if (this.closed.length > 25) this.closed.shift();
    if (this.activeTabId && this.tabs.get(this.activeTabId)?.groupId === groupId) {
      this.activeTabId = this.order.find((id) => this.tabs.get(id)?.groupId !== groupId) ?? null;
    }
    for (const id of members) this.removeTab(id, false);
    this.groups.delete(groupId);
    if (this.order.length === 0) this.createTab("");
  }
  ungroup(groupId) {
    for (const entry of this.tabs.values()) {
      if (entry.groupId === groupId) entry.groupId = null;
    }
    this.groups.delete(groupId);
  }
  membersOf(groupId) {
    return this.order.filter((id) => this.tabs.get(id)?.groupId === groupId);
  }
  pruneEmptyGroup(groupId) {
    if (!this.membersOf(groupId).length) this.groups.delete(groupId);
  }
  moveBefore(id, beforeId) {
    this.order = this.order.filter((item) => item !== id);
    const idx = beforeId ? this.order.indexOf(beforeId) : -1;
    if (idx < 0) this.order.push(id);
    else this.order.splice(idx, 0, id);
  }
  normalizeOrder() {
    const pinned = this.order.filter((id) => this.tabs.get(id)?.pinned);
    const rest = this.order.filter((id) => !this.tabs.get(id)?.pinned);
    this.order = [
      ...pinned,
      ...enforceGroupContiguity(rest, (id) => this.tabs.get(id)?.groupId ?? null)
    ];
    for (const groupId of [...this.groups.keys()]) this.pruneEmptyGroup(groupId);
  }
  pushClosedTab(entry) {
    const tab = this.toTab(entry.id);
    if (!tab?.url && !tab?.title) return;
    this.closed.push({
      kind: "tab",
      id: crypto.randomUUID(),
      url: tab?.url ?? "",
      title: tab?.title ?? "首页",
      favicon: entry.favicon,
      pinned: entry.pinned
    });
    if (this.closed.length > 25) this.closed.shift();
  }
  reopenClosed(entryId) {
    const index = entryId === void 0 ? this.closed.length - 1 : this.closed.findIndex((entry) => entry.id === entryId);
    const closed = index < 0 ? void 0 : this.closed.splice(index, 1)[0];
    if (!closed) {
      this.createTab("");
      return;
    }
    if (closed.kind === "group") {
      const groupId = crypto.randomUUID();
      this.groups.set(groupId, {
        id: groupId,
        name: closed.name,
        color: closed.color,
        collapsed: false
      });
      for (const tab of closed.tabs) {
        const id2 = this.createTab(tab.url);
        this.addTabToGroup(id2, groupId);
      }
      return;
    }
    const id = this.createTab(closed.url);
    if (closed.pinned) this.setPinned(id, true);
  }
  recordHistory(tabId, url) {
    if (isBlankUrl(url) || isGuestInternalUrl(url) || needsFreshSso(url)) return;
    const tab = this.tabs.get(tabId);
    const title = tab && !tab.view.webContents.isDestroyed() ? tab.view.webContents.getTitle() : url;
    void guestHistory.record({
      url,
      title: title || url,
      favicon: tab?.favicon ?? "",
      visitedAt: Date.now()
    }).then(() => guestHistory.recent(500)).then((rows) => {
      this.history = rows;
      this.emit();
    }).catch(() => void 0);
  }
  hookDownloadsOn(ses) {
    if (this.downloadsHooked.has(ses)) return;
    this.downloadsHooked.add(ses);
    ses.on("will-download", (event, item) => {
      const tabId = this.activeTabId ?? "unknown";
      const scope = this.downloadScopes.get(tabId) ?? "allow-one";
      if (scope === "blocked") {
        event.preventDefault();
        return;
      }
      const id = crypto.randomUUID();
      const filename = item.getFilename();
      const dest = path.join(this.resolvedDownloadDirectory(), filename);
      const needsPermission = scope === "prompt";
      if (this.askWhereToSave && !needsPermission) {
        void this.pickSave({ title: "保存文件", defaultPath: dest }).then((result) => {
          if (result.canceled || !result.filePath) {
            item.cancel();
            return;
          }
          item.setSavePath(result.filePath);
        });
      } else {
        item.setSavePath(dest);
      }
      const rec = {
        id,
        filename,
        url: item.getURL(),
        path: dest,
        state: needsPermission ? "awaiting-permission" : "progressing",
        received: 0,
        total: item.getTotalBytes(),
        startedAt: Date.now(),
        sourcePageDomain: hostOf(this.activeContents()?.getURL() || item.getURL())
      };
      this.downloads.unshift(rec);
      this.saveDownloads();
      this.downloadItems.set(id, item);
      if (scope === "allow-one") this.downloadScopes.set(tabId, "prompt");
      if (needsPermission) item.pause();
      item.on("updated", (_e, state2) => {
        rec.received = item.getReceivedBytes();
        rec.total = item.getTotalBytes();
        if (rec.state === "awaiting-permission") return;
        rec.state = state2 === "interrupted" ? "interrupted" : item.isPaused() ? "paused" : "progressing";
        this.emit();
      });
      item.once("done", (_e, state2) => {
        rec.state = state2;
        rec.path = item.getSavePath() || dest;
        this.downloadItems.delete(id);
        this.saveDownloads();
        this.emit();
        if (state2 === "completed" && this.showWhenComplete) this.loadInternal("downloads");
      });
      this.emit();
    });
  }
  resolveDownload(id, allow) {
    const rec = this.downloads.find((item2) => item2.id === id);
    const item = this.downloadItems.get(id);
    const tabId = this.activeTabId;
    if (tabId) this.downloadScopes.set(tabId, allow ? "allow-all" : "blocked");
    if (!rec || !item) return;
    if (allow) {
      rec.state = "progressing";
      try {
        item.resume();
      } catch {
      }
      return;
    }
    rec.state = "blocked";
    item.cancel();
  }
  openDownload(id) {
    const item = this.downloads.find((entry) => entry.id === id);
    if (item?.path) void electron.shell.openPath(item.path);
  }
  revealDownload(id) {
    const item = this.downloads.find((entry) => entry.id === id);
    if (item?.path) electron.shell.showItemInFolder(item.path);
  }
  showPageMenu(tabId, params) {
    const win = this.host;
    if (!win || win.isDestroyed()) return;
    const wc = this.tabs.get(tabId)?.view.webContents;
    if (!wc || wc.isDestroyed()) return;
    const template = [
      {
        label: "后退",
        enabled: wc.navigationHistory.canGoBack(),
        click: () => wc.navigationHistory.goBack()
      },
      {
        label: "前进",
        enabled: wc.navigationHistory.canGoForward(),
        click: () => wc.navigationHistory.goForward()
      },
      { label: "刷新", click: () => wc.reload() },
      { type: "separator" }
    ];
    if (params.linkURL) {
      template.push(
        {
          label: "在新标签页打开链接",
          click: () => this.createTab(params.linkURL, {
            appKey: this.tabs.get(tabId)?.appKey ?? null
          })
        },
        { label: "复制链接", click: () => electron.clipboard.writeText(params.linkURL) },
        { type: "separator" }
      );
    }
    if (params.selectionText) {
      template.push({
        label: "复制",
        click: () => electron.clipboard.writeText(params.selectionText)
      });
    }
    template.push(
      { role: "paste", label: "粘贴" },
      { role: "selectAll", label: "全选" }
    );
    if (params.srcURL) {
      template.push({
        label: "图片另存为",
        click: () => wc.downloadURL(params.srcURL)
      });
    }
    electron.Menu.buildFromTemplate(template).popup({ window: win });
  }
  toTab(id) {
    const entry = this.tabs.get(id);
    if (!entry || entry.view.webContents.isDestroyed()) return null;
    const wc = entry.view.webContents;
    const raw = wc.getURL();
    const url = displayUrl(raw);
    return {
      id,
      title: displayTitle(raw, wc.getTitle()),
      url,
      favicon: entry.favicon,
      insecure: url.startsWith("http://"),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      pinned: entry.pinned,
      groupId: entry.groupId
    };
  }
  toClosed(entry) {
    if (entry.kind === "group") {
      return {
        id: entry.id,
        kind: "group",
        title: entry.name || "未命名分组",
        color: entry.color
      };
    }
    return {
      id: entry.id,
      kind: "tab",
      title: entry.title,
      url: entry.url
    };
  }
  activeContents() {
    if (!this.activeTabId) return null;
    const entry = this.tabs.get(this.activeTabId);
    if (!entry || entry.view.webContents.isDestroyed()) return null;
    return entry.view.webContents;
  }
  ensureToolbar() {
    if (this.toolbar || !this.host || this.host.isDestroyed()) return;
    const view = new electron.WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        preload: preloadPath(),
        backgroundThrottling: false
      }
    });
    view.setBackgroundColor("#00000000");
    view.webContents.on("did-finish-load", () => {
      this.pushTheme(view);
      this.emit();
    });
    void view.webContents.loadURL(guestToolbarUrl());
    this.toolbar = view;
    this.ensureAttached(view);
    this.layout();
  }
  chromeHidden() {
    return this.shellMode === "app";
  }
  contentBounds() {
    if (this.chromeHidden()) return { ...this.bounds };
    return {
      x: this.bounds.x,
      y: this.bounds.y + this.chromeHeight,
      width: this.bounds.width,
      height: Math.max(0, this.bounds.height - this.chromeHeight)
    };
  }
  toolbarBounds() {
    if (this.overlayOpen) {
      return { ...this.bounds };
    }
    return {
      x: this.bounds.x,
      y: this.bounds.y,
      width: this.bounds.width,
      height: this.chromeHeight
    };
  }
  layout() {
    this.normalizeOrder();
    const showViews = this.visible && !this.hostOverlay;
    const hideChrome = this.chromeHidden();
    if (this.toolbar && !this.toolbar.webContents.isDestroyed()) {
      if (showViews && !hideChrome) {
        this.ensureAttached(this.toolbar);
        this.toolbar.setVisible(true);
        this.toolbar.setBounds(this.toolbarBounds());
      } else {
        this.toolbar.setVisible(false);
      }
    }
    const content = this.contentBounds();
    const popup = this.extensionPopup;
    if (popup && (!showViews || hideChrome)) this.closeExtensionPopup();
    for (const id of this.order) {
      const entry = this.tabs.get(id);
      if (!entry || entry.view.webContents.isDestroyed()) continue;
      const group = entry.groupId ? this.groups.get(entry.groupId) : null;
      const active = showViews && id === this.activeTabId && !group?.collapsed;
      entry.view.setVisible(active);
      if (active) {
        this.ensureAttached(entry.view);
        entry.view.setBounds(content);
      }
    }
    if (showViews && !hideChrome && this.extensionPopup) {
      const panel = this.extensionPopup;
      this.ensureAttached(panel.backdrop);
      panel.backdrop.setVisible(true);
      panel.backdrop.setBounds(content);
      this.ensureAttached(panel.view);
      panel.view.setVisible(true);
      panel.view.setBounds({
        x: panel.x,
        y: panel.y,
        width: panel.width,
        height: panel.height
      });
      this.raiseView(panel.backdrop);
      this.raiseView(panel.view);
    }
    if (showViews && !hideChrome && this.toolbar && !this.toolbar.webContents.isDestroyed()) {
      this.raiseView(this.toolbar);
    }
  }
  raiseView(view) {
    const win = this.host;
    if (!win || win.isDestroyed()) return;
    const parent = win.contentView;
    if (!parent.children.includes(view)) {
      parent.addChildView(view);
      return;
    }
    parent.removeChildView(view);
    parent.addChildView(view);
  }
  ensureAttached(view) {
    const win = this.host;
    if (!win || win.isDestroyed()) return;
    const parent = win.contentView;
    if (!parent.children.includes(view)) parent.addChildView(view);
  }
  detach(view) {
    try {
      this.host?.contentView.removeChildView(view);
    } catch {
    }
  }
  ensurePersist() {
    if (this.persistReady || !electron.app.isReady()) return;
    this.persistReady = true;
    const settings = readJson(persistPath("settings.json"), {});
    this.askWhereToSave = Boolean(settings.askWhereToSave);
    this.showWhenComplete = Boolean(settings.showWhenComplete);
    this.downloadDirectory = settings.downloadDirectory?.trim() || electron.app.getPath("downloads");
    if (!isUsableDirectory(this.downloadDirectory)) {
      this.downloadDirectory = electron.app.getPath("downloads");
    }
    this.downloads = readJson(persistPath("downloads.json"), []).map((item) => ({
      ...item,
      startedAt: item.startedAt || Date.now(),
      sourcePageDomain: item.sourcePageDomain || hostOf(item.url)
    }));
    this.doubleClickClosesTab = Boolean(settings.doubleClickClosesTab);
    this.hardwareAccelerationEnabled = settings.hardwareAccelerationEnabled !== false;
    this.hardwareAccelerationEnabledAtLaunch = this.hardwareAccelerationEnabled;
    this.barVisible = settings.bookmarksBar === true;
    this.zoomPercent = clampZoom(settings.zoomPercent ?? 100);
    this.bookmarks = sanitizeBookmarks(settings.bookmarks ?? []);
    loadCertExceptions(settings.certExceptions ?? []);
    this.importSources = listBrowserImportSources();
    void this.bootGuestExtensions();
    const legacy = readJson(persistPath("history.json"), []);
    if (legacy.length) {
      void (async () => {
        for (const item of legacy.reverse()) {
          await guestHistory.record(item);
        }
        this.history = await guestHistory.recent(500);
        writeJson(persistPath("history.json"), []);
        this.emit();
      })();
    }
  }
  async bootGuestExtensions() {
    if (cachedMeifannaoDir()) await this.applyGuestExtensions();
    void this.refreshRemoteGuestExtension();
  }
  async refreshRemoteGuestExtension() {
    try {
      const { dir, changed } = await syncMeifannaoExtension();
      if (!dir) return;
      if (!changed && this.extensions.length > 0) return;
      this.unloadGuestExtensions();
      await this.applyGuestExtensions();
    } catch {
    }
  }
  unloadGuestExtensions() {
    for (const ses of allGuestSessions()) this.unloadExtensionsFrom(ses);
  }
  unloadExtensionsFrom(ses) {
    const list = ses.extensions?.getAllExtensions?.() ?? ses.getAllExtensions?.() ?? [];
    const remover = ses.extensions?.removeExtension?.bind(ses.extensions) ?? ses.removeExtension?.bind(ses);
    if (!remover) return;
    for (const ext of list) {
      try {
        remover(ext.id);
      } catch {
      }
    }
  }
  async applyGuestExtensions() {
    const loaded = [];
    for (const ses of allGuestSessions()) {
      const items = await this.loadExtensionsInto(ses);
      if (items.length) loaded.splice(0, loaded.length, ...items);
    }
    this.extensions = loaded;
    this.emit();
  }
  async loadExtensionsInto(ses) {
    const loader = ses.extensions?.loadExtension?.bind(ses.extensions) ?? ses.loadExtension.bind(ses);
    const loaded = [];
    for (const dir of guestExtensionDirs()) {
      try {
        const ext = await loader(dir, { allowFileAccess: true });
        loaded.push(toGuestExtension(ext));
      } catch {
      }
    }
    return loaded;
  }
  openExtensionPopup(id, anchorX, anchorY, anchorWidth) {
    const item = this.extensions.find((ext) => ext.id === id);
    if (!item?.popupUrl) return;
    if (this.extensionPopup?.id === id) {
      this.closeExtensionPopup();
      return;
    }
    this.closeExtensionPopup();
    const width = Math.min(360, Math.max(280, this.bounds.width - 16));
    const placed = this.placeExtensionPopup(width, 160, {
      right: this.bounds.x + (anchorX != null ? anchorX + Math.max(0, anchorWidth ?? 0) : this.bounds.width - 12),
      below: this.bounds.y + (anchorY ?? this.chromeHeight)
    });
    const prefs = {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: ensureGuestSession(
        this.activeTabId ? this.tabs.get(this.activeTabId)?.partition ?? GUEST_PARTITIONS.primary : GUEST_PARTITIONS.primary
      )
    };
    const backdrop = new electron.WebContentsView({ webPreferences: prefs });
    backdrop.setBackgroundColor("#00000000");
    backdrop.webContents.on("did-navigate-in-page", () => {
      this.closeExtensionPopup();
      this.layout();
      this.emit();
    });
    void backdrop.webContents.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        `<!doctype html><html><body style="margin:0;width:100%;height:100%;background:transparent"></body><script>document.addEventListener("pointerdown",()=>{location.hash="close"},true)<\/script></html>`
      )}`
    );
    const view = new electron.WebContentsView({ webPreferences: prefs });
    view.setBackgroundColor("#ffffff");
    if (typeof view.setBorderRadius === "function") view.setBorderRadius(12);
    void view.webContents.loadURL(item.popupUrl);
    this.extensionPopup = { id, view, backdrop, ...placed };
    this.watchExtensionPopup(view);
  }
  placeExtensionPopup(width, height, anchor) {
    const nextW = Math.min(
      Math.max(width, 280),
      Math.max(280, this.bounds.width - 16)
    );
    const nextH = Math.min(
      Math.max(height, 1),
      Math.max(80, this.bounds.height - this.chromeHeight - 16)
    );
    return {
      x: Math.min(
        Math.max(this.bounds.x + 8, anchor.right - nextW),
        this.bounds.x + this.bounds.width - nextW - 8
      ),
      y: Math.min(
        Math.max(
          this.bounds.y + (this.chromeHidden() ? 8 : this.chromeHeight),
          anchor.below + 6
        ),
        this.bounds.y + this.bounds.height - nextH - 8
      ),
      width: nextW,
      height: nextH
    };
  }
  watchExtensionPopup(view) {
    if (this.popupFitTimer) {
      clearInterval(this.popupFitTimer);
      this.popupFitTimer = null;
    }
    const tick = () => {
      if (this.extensionPopup?.view !== view || view.webContents.isDestroyed()) {
        this.stopPopupFit();
        return;
      }
      void this.fitExtensionPopup(view);
    };
    tick();
    this.popupFitTimer = setInterval(tick, 250);
  }
  stopPopupFit() {
    if (!this.popupFitTimer) return;
    clearInterval(this.popupFitTimer);
    this.popupFitTimer = null;
  }
  async fitExtensionPopup(view) {
    const popup = this.extensionPopup;
    if (!popup || popup.view !== view || view.webContents.isDestroyed()) return;
    try {
      const size = await view.webContents.executeJavaScript(`(() => {
        const roots = [document.getElementById("app"), document.documentElement, document.body].filter(Boolean);
        return {
          width: Math.ceil(Math.max(360, ...roots.map((node) => Math.max(node.scrollWidth || 0, node.offsetWidth || 0)))),
          height: Math.ceil(Math.max(...roots.map((node) => Math.max(node.scrollHeight || 0, node.offsetHeight || 0)))),
        };
      })()`);
      if (!size.height || size.height < 40) return;
      const next = this.placeExtensionPopup(size.width, size.height, {
        right: popup.x + popup.width,
        below: popup.y - 6
      });
      if (popup.width === next.width && popup.height === next.height && popup.x === next.x && popup.y === next.y) {
        return;
      }
      Object.assign(popup, next);
      this.layout();
    } catch {
    }
  }
  closeExtensionPopup() {
    this.stopPopupFit();
    const popup = this.extensionPopup;
    if (!popup) return;
    this.extensionPopup = null;
    this.closeView(popup.backdrop);
    this.closeView(popup.view);
  }
  closeView(view) {
    this.detach(view);
    if (view.webContents.isDestroyed()) return;
    try {
      view.webContents.close();
    } catch {
    }
  }
  saveSettings() {
    writeJson(persistPath("settings.json"), {
      askWhereToSave: this.askWhereToSave,
      showWhenComplete: this.showWhenComplete,
      downloadDirectory: this.downloadDirectory,
      doubleClickClosesTab: this.doubleClickClosesTab,
      hardwareAccelerationEnabled: this.hardwareAccelerationEnabled,
      bookmarksBar: this.barVisible,
      zoomPercent: this.zoomPercent,
      bookmarks: this.bookmarks,
      certExceptions: certExceptionHosts()
    });
  }
  resolvedDownloadDirectory() {
    const dir = this.downloadDirectory.trim();
    return dir || electron.app.getPath("downloads");
  }
  applyDownloadDirectory(path2) {
    const next = path2.trim();
    if (!isUsableDirectory(next)) return;
    this.downloadDirectory = next;
    this.saveSettings();
  }
  async pickOpen(options) {
    this.host?.focus();
    return electron.dialog.showOpenDialog(options);
  }
  async pickSave(options) {
    this.host?.focus();
    return electron.dialog.showSaveDialog(options);
  }
  async chooseDownloadDirectory() {
    const result = await this.pickOpen({
      title: "选择下载位置",
      defaultPath: this.resolvedDownloadDirectory(),
      properties: ["openDirectory", "createDirectory"]
    });
    const next = result.filePaths[0];
    if (result.canceled || !next) return;
    this.applyDownloadDirectory(next);
  }
  saveDownloads() {
    writeJson(persistPath("downloads.json"), this.downloads.slice(0, 50));
  }
  toggleBookmark(url, title) {
    const href = url.trim();
    if (!href) return;
    const existing = this.bookmarks.find((item) => item.url === href);
    this.bookmarks = existing ? this.bookmarks.filter((item) => item.url !== href) : [...this.bookmarks, { id: crypto.randomUUID(), title: title.trim() || href, url: href }];
    this.saveSettings();
  }
  updateBookmark(id, title, url) {
    const item = this.bookmarks.find((entry) => entry.id === id);
    if (!item) return;
    if (typeof title === "string") item.title = title.trim() || item.url;
    if (typeof url === "string") {
      const href = url.trim();
      if (href) item.url = href;
    }
    this.saveSettings();
  }
  applyZoom() {
    for (const entry of this.tabs.values()) this.applyZoomTo(entry.view.webContents);
  }
  applyZoomTo(wc) {
    if (wc.isDestroyed()) return;
    wc.setZoomFactor(this.zoomPercent / 100);
  }
  async importBookmarksHtml() {
    const picked = await this.pickOpen({
      title: "导入书签",
      filters: [{ name: "HTML", extensions: ["html", "htm"] }],
      properties: ["openFile"]
    });
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return;
    try {
      const html = fs.readFileSync(file, "utf8");
      this.mergeBookmarks(parseBookmarkHtml(html));
    } catch {
    }
    this.emit();
  }
  async importBrowserData(sourceId) {
    this.importSources = listBrowserImportSources();
    const source = sourceId ? this.importSources.find((item) => item.id === sourceId) : this.importSources[0];
    if (!source) {
      this.emit();
      return;
    }
    const items = readChromeBookmarkFile(sourcePath(source.id));
    this.mergeBookmarks(items);
    this.emit();
  }
  mergeBookmarks(items) {
    const seen = new Set(this.bookmarks.map((item) => item.url));
    for (const item of items) {
      if (!item.url || seen.has(item.url)) continue;
      seen.add(item.url);
      this.bookmarks.push({
        id: item.id || crypto.randomUUID(),
        title: item.title || item.url,
        url: item.url
      });
    }
    this.saveSettings();
  }
  async clearData(cmd) {
    const sessions = cmd.cookieScope === "site" ? [this.activeContents()?.session].filter(Boolean) : allGuestSessions();
    for (const guest of sessions) {
      if (cmd.cache) await guest.clearCache();
      if (!cmd.cookies) continue;
      if (cmd.cookieScope === "site") {
        const url = this.activeContents()?.getURL();
        if (url && !isGuestInternalUrl(url)) {
          await guest.clearStorageData({
            origin: originOf(url),
            storages: ["cookies", "localstorage"]
          });
        } else {
          await guest.clearStorageData({ storages: ["cookies", "localstorage", "indexdb"] });
        }
      } else {
        await guest.clearStorageData({ storages: ["cookies", "localstorage", "indexdb"] });
      }
    }
    if (cmd.history) {
      const cutoff = rangeCutoff(cmd.timeRange);
      if (cutoff == null) await guestHistory.clear();
      else await guestHistory.clearBefore(cutoff);
      this.history = await guestHistory.recent(500);
    }
    this.emit();
  }
  async applyHostOverlay(open) {
    const gen = ++this.overlayGen;
    if (!open) {
      this.hostOverlay = false;
      this.overlayShot = null;
      this.overlayShotAt = 0;
      this.overlayAcked = false;
      this.overlayReady?.resolve();
      this.overlayReady = null;
      this.emitOverlay(null);
      return;
    }
    if (this.hostOverlay) return;
    if (!this.visible) {
      this.hostOverlay = true;
      return;
    }
    const shot = this.overlayShot ?? await this.captureStackOnce();
    if (gen !== this.overlayGen) return;
    if (!shot) return;
    this.overlayShot = shot;
    this.overlayShotAt = Date.now();
    if (!this.overlayAcked) this.emitOverlay(shot);
    const painted = await this.waitOverlayPainted();
    if (gen !== this.overlayGen) return;
    if (!painted) return;
    this.hostOverlay = true;
  }
  async prefetchHostOverlay() {
    if (this.hostOverlay || !this.visible) return;
    const shot = await this.captureStackOnce();
    if (!shot || this.hostOverlay) return;
    this.overlayShot = shot;
    this.overlayShotAt = Date.now();
    if (!this.overlayAcked) this.emitOverlay(shot);
  }
  waitOverlayPainted() {
    if (this.overlayAcked) return Promise.resolve(true);
    const ready = new Promise((resolve) => {
      this.overlayReady = { resolve };
    });
    return Promise.race([
      ready.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(this.overlayAcked), 1500))
    ]);
  }
  captureStackOnce() {
    if (this.overlayShot && Date.now() - this.overlayShotAt < 2e3) {
      return Promise.resolve(this.overlayShot);
    }
    if (!this.captureInFlight) {
      this.captureInFlight = this.captureStack().finally(() => {
        this.captureInFlight = null;
      });
    }
    return this.captureInFlight;
  }
  async captureStack() {
    const { width, height, x: originX, y: originY } = this.bounds;
    if (width <= 0 || height <= 0) return null;
    const capture = async (view) => {
      if (!view || view.webContents.isDestroyed()) return null;
      try {
        let image = await view.webContents.capturePage();
        if (image.isEmpty()) return null;
        const box = view.getBounds();
        const size = image.getSize();
        if (box.width > 0 && size.width > box.width * 1.25) {
          image = image.resize({ width: box.width, quality: "good" });
        }
        return {
          dataUrl: image.toDataURL(),
          x: box.x - originX,
          y: box.y - originY,
          width: box.width,
          height: box.height
        };
      } catch {
        return null;
      }
    };
    const layers = (await Promise.all([
      capture(this.toolbar),
      capture(this.activeTabId ? this.tabs.get(this.activeTabId)?.view ?? null : null)
    ])).filter((layer) => Boolean(layer));
    if (layers.length === 0) return null;
    return { width, height, layers };
  }
  emitOverlay(shot) {
    const win = this.host;
    if (!win || win.isDestroyed()) return;
    win.webContents.send(ipcEvents.IpcListen.guestBrowserOverlay, shot);
  }
  themeScript() {
    if (!this.uiTheme) return null;
    const isDark = this.uiTheme.isDark;
    return `(() => {
      try { localStorage.setItem("qiwork-theme", ${JSON.stringify(this.uiTheme.themeMode)}); } catch {}
      const html = document.documentElement;
      html.classList.toggle("dark-mode", ${isDark});
      html.setAttribute("data-theme", ${isDark ? '"dark"' : '"light"'});
      html.style.colorScheme = ${isDark ? '"dark"' : '"light"'};
    })()`;
  }
  paintGuestView(view, url) {
    try {
      view.setBackgroundColor(
        isGuestInternalUrl(url) ? this.uiTheme?.isDark ? "#0d0f12" : "#f2f3f8" : "#ffffff"
      );
    } catch {
    }
  }
  pushTheme(view) {
    const script = this.themeScript();
    if (!script) return;
    const apply = (target, paint) => {
      if (!target || target.webContents.isDestroyed()) return;
      void target.webContents.executeJavaScript(script).catch(() => void 0);
      if (!paint) return;
      this.paintGuestView(target, target.webContents.getURL());
    };
    if (view) {
      apply(view, view !== this.toolbar);
      return;
    }
    apply(this.toolbar, false);
    for (const entry of this.tabs.values()) {
      if (entry.view.webContents.isDestroyed()) continue;
      if (isGuestInternalUrl(entry.view.webContents.getURL())) {
        apply(entry.view, true);
      }
    }
  }
  emit() {
    const snap = this.snapshot();
    const win = this.host;
    if (win && !win.isDestroyed()) {
      win.webContents.send(ipcEvents.IpcListen.guestBrowserState, snap);
    }
    if (this.toolbar && !this.toolbar.webContents.isDestroyed()) {
      this.toolbar.webContents.send(ipcEvents.IpcListen.guestBrowserState, snap);
    }
    for (const entry of this.tabs.values()) {
      if (entry.view.webContents.isDestroyed()) continue;
      if (isGuestInternalUrl(entry.view.webContents.getURL())) {
        entry.view.webContents.send(ipcEvents.IpcListen.guestBrowserState, snap);
      }
    }
  }
}
const guestBrowser = new GuestBrowserHost();
const UPDATE_PROMPT_ACTIONS = [
  "dismiss",
  "download",
  "retry",
  "install",
  "changelog"
];
function isUpdatePromptAction(value) {
  return typeof value === "string" && UPDATE_PROMPT_ACTIONS.includes(value);
}
function parseUpdatePromptAction(raw) {
  if (!raw || typeof raw !== "object" || !("type" in raw)) return null;
  const type = raw.type;
  return isUpdatePromptAction(type) ? type : null;
}
function parseUpdatePromptPayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw;
  if (typeof rec.open !== "boolean") return null;
  return {
    open: rec.open,
    step: typeof rec.step === "string" ? rec.step : "idle",
    latestVersion: typeof rec.latestVersion === "string" ? rec.latestVersion : "",
    downloaded: typeof rec.downloaded === "number" ? rec.downloaded : 0,
    total: typeof rec.total === "number" ? rec.total : 0,
    error: typeof rec.error === "string" ? rec.error : ""
  };
}
function safeDistFile(root, pathname) {
  let rel = pathname;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  rel = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel || rel.includes("\0")) return null;
  const resolved = path.resolve(root, rel);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return resolved;
}
const SCHEME_PRIVILEGES = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  corsEnabled: true,
  stream: true
};
function registerAppScheme() {
  electron.protocol.registerSchemesAsPrivileged([
    { scheme: HOST_APP_SCHEME, privileges: SCHEME_PRIVILEGES }
  ]);
}
function distRoot() {
  return rendererDistRoot();
}
function serveHostDist(request) {
  const url = new URL(request.url);
  let pathname = url.pathname;
  if (pathname === "/" || pathname === "") {
    pathname = "/electron.html";
  }
  const filePath = safeDistFile(distRoot(), pathname);
  if (!filePath) {
    return Promise.resolve(new Response("Not found", { status: 404 }));
  }
  return electron.net.fetch(node_url.pathToFileURL(filePath).toString());
}
function attachAppProtocol(ses) {
  if (ses.protocol.isProtocolHandled(HOST_APP_SCHEME)) return;
  ses.protocol.handle(HOST_APP_SCHEME, serveHostDist);
}
function registerAppProtocolHandler() {
  attachAppProtocol(electron.session.defaultSession);
}
function assertLocalBackendUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("invalid download URL");
  }
  if (parsed.protocol !== "http:") {
    throw new Error("download URL protocol is not supported");
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
    throw new Error("download URL must target the local backend");
  }
  return parsed;
}
async function downloadBackendFile(request) {
  const url = assertLocalBackendUrl(request.url);
  const filePath = request.filePath.trim();
  if (!filePath) throw new Error("download file path is empty");
  const parentDir = path.dirname(filePath);
  try {
    await promises.stat(parentDir);
  } catch {
    await promises.mkdir(parentDir, { recursive: true });
  }
  const headers = new Headers(request.headers ?? {});
  const response = await electron.net.fetch(url.toString(), {
    method: "GET",
    headers
  });
  if (!response.ok) {
    throw new Error(`download request failed with status code ${response.status}`);
  }
  if (!response.body) {
    throw new Error("download response has no body");
  }
  const nodeStream = node_stream.Readable.fromWeb(
    response.body
  );
  await promises$1.pipeline(nodeStream, fs.createWriteStream(filePath));
}
const execFileAsync = node_util.promisify(node_child_process.execFile);
const SUPPORTED_EXTERNAL_PREFIXES = ["http:", "https:", "mailto:", "tel:"];
async function allowBackendForeground() {
  if (process.platform !== "win32") return;
  const pid = sidecar.getGatewayPid();
  if (!pid) return;
  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Fg {
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
}
"@
[Fg]::AllowSetForegroundWindow(${pid})
`;
  try {
    await execFileAsync("powershell", ["-NoProfile", "-Command", ps], {
      windowsHide: true
    });
  } catch (err) {
    console.warn("[shell] allowBackendForeground failed", err);
  }
}
async function openFolder(folderPath) {
  await electron.shell.openPath(folderPath);
}
async function openFile(filePath) {
  await electron.shell.openPath(filePath);
}
async function openExternalLink(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("unsupported protocol");
  }
  if (!SUPPORTED_EXTERNAL_PREFIXES.includes(parsed.protocol)) {
    throw new Error("unsupported protocol");
  }
  await electron.shell.openExternal(url);
}
async function showOpenDialog(options) {
  const result = await electron.dialog.showOpenDialog({
    title: options?.title,
    properties: options?.directory ? ["openDirectory"] : ["openFile"]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0] ?? null;
}
async function showSaveDialog(options) {
  const result = await electron.dialog.showSaveDialog({
    title: options?.title,
    defaultPath: options?.defaultPath
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}
let allowExit = false;
function permitExit() {
  allowExit = true;
}
function revokeExit() {
  allowExit = false;
}
function isLoopbackUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol === "app:") return true;
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  } catch {
    return false;
  }
}
function setupWindowLifecycle(win) {
  win.on("close", (event) => {
    if (allowExit) return;
    event.preventDefault();
    win.hide();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isLoopbackUrl(url)) {
      return { action: "allow" };
    }
    void electron.shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (isLoopbackUrl(url) || url.startsWith("file:")) return;
    if (url.startsWith("http://localhost:") || url.startsWith("http://127.0.0.1:")) {
      return;
    }
    event.preventDefault();
    void electron.shell.openExternal(url);
  });
  win.webContents.session.setPermissionRequestHandler(
    (_wc, permission, callback, details) => {
      const requestingUrl = details.requestingUrl || "";
      const allowMedia = permission === "media" && isLoopbackUrl(requestingUrl);
      callback(allowMedia);
    }
  );
}
function focusMainWindow(win) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
function minimizeWindow(win) {
  win.minimize();
}
async function toggleMaximizeWindow(win) {
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
}
function closeWindow(win) {
  win.close();
}
function openDevTools(win) {
  win.webContents.openDevTools({ mode: "detach" });
}
const STORE_TABS = [
  "subscription",
  "packages",
  "industry_data",
  "shop_sync"
];
const STORE_TAB_SET = new Set(STORE_TABS);
function parseStoreTab(raw) {
  if (raw && STORE_TAB_SET.has(raw)) {
    return raw;
  }
  return "subscription";
}
const DEVICE_COMPLETE = "auth/device-complete";
function registerDeepLinkHandlers(getMainWindow) {
  if (!electron.app.isPackaged) {
    electron.app.setAsDefaultProtocolClient("qiwork", process.execPath, [
      process.argv[1] ?? "."
    ]);
  } else {
    electron.app.setAsDefaultProtocolClient("qiwork");
  }
  const deliver = (rawUrl) => {
    handleDeepLink(rawUrl, getMainWindow);
  };
  electron.app.on("open-url", (event, rawUrl) => {
    event.preventDefault();
    deliver(rawUrl);
  });
  for (const arg of process.argv) {
    if (arg.startsWith("qiwork://")) {
      deliver(arg);
    }
  }
}
function handleDeepLinkArgv(argv, getMainWindow) {
  const rawUrl = argv.find((arg) => arg.startsWith("qiwork://"));
  if (rawUrl) {
    handleDeepLink(rawUrl, getMainWindow);
  }
}
function sendAppNavigate(win, payload) {
  focusMainWindow(win);
  win?.webContents.send(ipcEvents.IpcListen.deepLinkNavigate, payload);
}
function handleDeepLink(rawUrl, getMainWindow) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return;
  }
  if (parsed.protocol !== "qiwork:") return;
  const win = getMainWindow();
  const path2 = `${parsed.hostname}${parsed.pathname}`.replace(/\/$/, "");
  if (path2 === DEVICE_COMPLETE) {
    focusMainWindow(win);
    win?.webContents.send(ipcEvents.IpcListen.authDeviceComplete);
    return;
  }
  if (path2 === "store") {
    const safeTab = parseStoreTab(parsed.searchParams.get("tab"));
    sendAppNavigate(win, { path: "/store", search: `?tab=${safeTab}` });
  }
}
const AUTH_HEADER = "x-qiwork-desktop-host-token";
const EVENT_POLL_MS = 2e4;
class PlatformLoginHost {
  server = null;
  token = "";
  baseUrl = "";
  windows = /* @__PURE__ */ new Map();
  mainWindow = null;
  async start(mainWindow2) {
    if (this.server) {
      return this.getEnv();
    }
    this.mainWindow = mainWindow2;
    this.token = crypto.randomBytes(32).toString("hex");
    await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        void this.handle(req, res);
      });
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (!addr || typeof addr === "string") {
          reject(new Error("platform login host: failed to bind loopback"));
          return;
        }
        this.baseUrl = `http://127.0.0.1:${addr.port}`;
        this.server = server;
        resolve();
      });
    });
    return this.getEnv();
  }
  getEnv() {
    if (!this.baseUrl || !this.token) return null;
    return {
      QIWORK_DESKTOP_HOST: this.baseUrl,
      QIWORK_DESKTOP_HOST_TOKEN: this.token
    };
  }
  stop() {
    for (const entry of this.windows.values()) {
      if (!entry.win.isDestroyed()) {
        entry.win.close();
      }
    }
    this.windows.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.baseUrl = "";
    this.token = "";
    this.mainWindow = null;
  }
  authorized(req) {
    const header = req.headers[AUTH_HEADER];
    const token = Array.isArray(header) ? header[0] : header;
    return token === this.token;
  }
  writeJson(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  }
  async readJson(req) {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (!text) return {};
    return JSON.parse(text);
  }
  entryFor(id) {
    const entry = this.windows.get(id);
    if (!entry || entry.win.isDestroyed()) {
      this.windows.delete(id);
      return null;
    }
    return entry;
  }
  pushEvent(entry, type, url) {
    const event = {
      seq: entry.nextSeq++,
      type,
      ...url ? { url } : {}
    };
    entry.events.push(event);
    const waiters = entry.waiters.splice(0);
    for (const wake of waiters) {
      wake(entry.events);
    }
  }
  eventsAfter(entry, after) {
    return entry.events.filter((event) => event.seq > after);
  }
  waitForEvents(entry, after) {
    const pending = this.eventsAfter(entry, after);
    if (pending.length > 0) {
      return Promise.resolve(pending);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        entry.waiters = entry.waiters.filter((wake) => wake !== onEvents);
        resolve([]);
      }, EVENT_POLL_MS);
      const onEvents = (events) => {
        const next = events.filter((event) => event.seq > after);
        if (next.length === 0) return;
        clearTimeout(timer);
        entry.waiters = entry.waiters.filter((wake) => wake !== onEvents);
        resolve(next);
      };
      entry.waiters.push(onEvents);
    });
  }
  bindWindowEvents(id, entry) {
    const contents = entry.win.webContents;
    const onNavigate = (_event, url) => {
      this.pushEvent(entry, "navigated", url);
    };
    contents.on("did-navigate", onNavigate);
    contents.on("did-navigate-in-page", onNavigate);
    entry.win.on("closed", () => {
      this.pushEvent(entry, "closed");
      this.windows.delete(id);
      void entry.session.clearStorageData();
      void entry.session.clearCache();
    });
  }
  forwardUiEvent(payload) {
    const win = this.mainWindow;
    if (!win || win.isDestroyed()) return;
    win.webContents.send(ipcEvents.IpcListen.platformLoginEvent, payload);
    if (String(payload.phase ?? "") === "ready") {
      const platformName = typeof payload.platform_name === "string" ? payload.platform_name : String(payload.platform ?? "");
      showDesktopNotification(
        "平台登录成功",
        platformName ? `${platformName} 已连接` : "账号已连接"
      );
    }
  }
  async handle(req, res) {
    if (!this.authorized(req)) {
      this.writeJson(res, 401, { error: "unauthorized" });
      return;
    }
    const url = new node_url.URL(req.url ?? "/", this.baseUrl || "http://127.0.0.1");
    const method = req.method ?? "GET";
    const path2 = url.pathname;
    try {
      if (method === "POST" && path2 === "/login-windows") {
        const body = await this.readJson(req);
        const title = String(body.title ?? "登录");
        const startUrl = String(body.url ?? "").trim();
        if (!startUrl) {
          this.writeJson(res, 400, { error: "url required" });
          return;
        }
        const id = crypto.randomBytes(16).toString("hex");
        const partition = `qiwork-platform-login-${id}`;
        const loginSession = electron.session.fromPartition(partition, { cache: false });
        const win = new electron.BrowserWindow({
          width: 1024,
          height: 720,
          title,
          parent: this.mainWindow ?? void 0,
          show: true,
          autoHideMenuBar: true,
          webPreferences: {
            session: loginSession,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
          }
        });
        win.webContents.setWindowOpenHandler(({ url: target }) => {
          if (target) {
            void win.loadURL(target);
          }
          return { action: "deny" };
        });
        const entry = {
          win,
          session: loginSession,
          events: [],
          nextSeq: 1,
          waiters: []
        };
        this.windows.set(id, entry);
        this.bindWindowEvents(id, entry);
        await win.loadURL(startUrl);
        this.writeJson(res, 200, { id });
        return;
      }
      if (method === "POST" && path2 === "/ui-events") {
        const body = await this.readJson(req);
        this.forwardUiEvent(body);
        this.writeJson(res, 200, { ok: true });
        return;
      }
      const windowMatch = path2.match(/^\/login-windows\/([^/]+)$/);
      if (windowMatch && method === "GET") {
        const entry = this.entryFor(windowMatch[1]);
        if (!entry) {
          this.writeJson(res, 404, { error: "not found" });
          return;
        }
        this.writeJson(res, 200, {
          open: true,
          url: entry.win.webContents.getURL()
        });
        return;
      }
      const eventsMatch = path2.match(/^\/login-windows\/([^/]+)\/events$/);
      if (eventsMatch && method === "GET") {
        const entry = this.entryFor(eventsMatch[1]);
        if (!entry) {
          this.writeJson(res, 404, { error: "not found" });
          return;
        }
        const after = Number.parseInt(url.searchParams.get("after") ?? "0", 10);
        const events = await this.waitForEvents(entry, Number.isFinite(after) ? after : 0);
        this.writeJson(res, 200, { events });
        return;
      }
      const cookiesMatch = path2.match(/^\/login-windows\/([^/]+)\/cookies$/);
      if (cookiesMatch && method === "GET") {
        const entry = this.entryFor(cookiesMatch[1]);
        if (!entry) {
          this.writeJson(res, 404, { error: "not found" });
          return;
        }
        const cookies = await entry.session.cookies.get({});
        const jar = {};
        for (const cookie of cookies) {
          if (cookie.name && cookie.value) {
            jar[cookie.name] = cookie.value;
          }
        }
        this.writeJson(res, 200, { cookies: jar });
        return;
      }
      const navigateMatch = path2.match(/^\/login-windows\/([^/]+)\/navigate$/);
      if (navigateMatch && method === "POST") {
        const entry = this.entryFor(navigateMatch[1]);
        if (!entry) {
          this.writeJson(res, 404, { error: "not found" });
          return;
        }
        const body = await this.readJson(req);
        const target = String(body.url ?? "").trim();
        if (!target) {
          this.writeJson(res, 400, { error: "url required" });
          return;
        }
        await entry.win.loadURL(target);
        this.writeJson(res, 200, { ok: true });
        return;
      }
      const deleteMatch = path2.match(/^\/login-windows\/([^/]+)$/);
      if (deleteMatch && method === "DELETE") {
        const id = deleteMatch[1];
        const entry = this.entryFor(id);
        if (!entry) {
          this.writeJson(res, 404, { error: "not found" });
          return;
        }
        entry.win.close();
        this.windows.delete(id);
        this.writeJson(res, 200, { ok: true });
        return;
      }
      this.writeJson(res, 404, { error: "not found" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.writeJson(res, 500, { error: message });
    }
  }
}
const platformLoginHost = new PlatformLoginHost();
const FIRST_CHECK_DELAY_MS = 3e4;
const CHECK_INTERVAL_MS = 60 * 60 * 1e3;
const CHECK_INTERVAL_JITTER = 0.1;
const SIDECAR_STOP_TIMEOUT_MS = 8e3;
const INSTALL_WATCHDOG_MS = 15e3;
function canStartCheck(state2, installInFlight2) {
  return !installInFlight2 && (state2 === "idle" || state2 === "ready");
}
function canQuitAndInstall(state2, installInFlight2) {
  return state2 === "ready" && !installInFlight2;
}
function nextPeriodicCheckDelayMs(random = Math.random) {
  const jitter = 1 + (random() * 2 - 1) * CHECK_INTERVAL_JITTER;
  return Math.round(CHECK_INTERVAL_MS * jitter);
}
function parseRestartMarker(raw) {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw;
  if (typeof rec.targetVersion !== "string" || !rec.targetVersion) return null;
  if (typeof rec.startedAt !== "number" || !Number.isFinite(rec.startedAt)) {
    return null;
  }
  return {
    targetVersion: rec.targetVersion,
    startedAt: rec.startedAt,
    explicit: rec.explicit === true
  };
}
function reconcileRestart(currentVersion, marker) {
  if (!marker) return null;
  return {
    success: currentVersion === marker.targetVersion,
    targetVersion: marker.targetVersion
  };
}
const FEED_SUFFIX = "/api/v1/client-releases/updates/";
function parseLlmplatApiUrl(envText) {
  let found = "";
  for (const raw of envText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (!line.startsWith("LLMPLAT_API_URL=")) continue;
    found = line.slice("LLMPLAT_API_URL=".length).trim().replace(/^['"]|['"]$/g, "");
  }
  return found.replace(/\/+$/, "");
}
function updateFeedUrlFromApiBase(apiBase) {
  return `${apiBase.replace(/\/+$/, "")}${FEED_SUFFIX}`;
}
function resolveUpdateFeedUrl(env, officialText) {
  const fromEnv = env.LLMPLAT_API_URL?.trim().replace(/\/+$/, "") ?? "";
  const fromFile = officialText ? parseLlmplatApiUrl(officialText) : "";
  const base = fromEnv || fromFile;
  if (!base) return null;
  return updateFeedUrlFromApiBase(base);
}
const MARKER_FILE = "update-restart.json";
function restartMarkerPath() {
  return path.join(electron.app.getPath("userData"), MARKER_FILE);
}
function readRestartMarker(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return parseRestartMarker(JSON.parse(fs.readFileSync(filePath, "utf8")));
  } catch {
    return null;
  }
}
function writeRestartMarker(filePath, marker) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(marker), "utf8");
}
function clearRestartMarker(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
  }
}
let listenersBound = false;
let state = "idle";
let installInFlight = false;
let readyVersion;
let checkTimer = null;
let watchdogTimer = null;
function readOfficialEnvText() {
  for (const candidate of officialEnvPaths()) {
    try {
      return fs.readFileSync(candidate, "utf8");
    } catch {
    }
  }
  return void 0;
}
function restoreSettled() {
  if (installInFlight) return;
  state = readyVersion ? "ready" : "idle";
}
function emitUpdater(event, win) {
  const target = win && !win.isDestroyed() ? win : electron.BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
  if (!target) return;
  target.webContents.send(ipcEvents.IpcListen.updater, event);
}
function versionOf(info) {
  if (!info || typeof info !== "object") return void 0;
  const version = info.version;
  return typeof version === "string" ? version : void 0;
}
async function loadAutoUpdater() {
  const mod = await import("electron-updater");
  const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater;
  if (!autoUpdater) {
    throw new Error("electron-updater autoUpdater is unavailable");
  }
  autoUpdater.forceDevUpdateConfig = !electron.app.isPackaged;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  const feedUrl = resolveUpdateFeedUrl(process.env, readOfficialEnvText());
  if (feedUrl) {
    autoUpdater.setFeedURL({ provider: "generic", url: feedUrl });
  }
  return autoUpdater;
}
function bindListeners(autoUpdater, win) {
  if (listenersBound) return;
  listenersBound = true;
  autoUpdater.on("update-available", (info) => {
    if (state !== "ready") state = "downloading";
    emitUpdater({ kind: "available", version: versionOf(info) }, win);
  });
  autoUpdater.on("update-not-available", () => {
    restoreSettled();
    if (!readyVersion) emitUpdater({ kind: "not-available" }, win);
  });
  autoUpdater.on("download-progress", (progress) => {
    if (state !== "ready") state = "downloading";
    emitUpdater(
      {
        kind: "progress",
        transferred: progress.transferred,
        total: progress.total
      },
      win
    );
  });
  autoUpdater.on("update-downloaded", (info) => {
    state = "ready";
    readyVersion = versionOf(info);
    showDesktopNotification("新版本就绪", "版本已经下载完成，重启后立即生效。");
    emitUpdater({ kind: "downloaded", version: readyVersion }, win);
  });
  autoUpdater.on("error", (err) => {
    restoreSettled();
    emitUpdater({ kind: "error", message: err.message }, win);
  });
}
function emitRestartResult(win) {
  const filePath = restartMarkerPath();
  const result = reconcileRestart(electron.app.getVersion(), readRestartMarker(filePath));
  clearRestartMarker(filePath);
  if (!result) return;
  emitUpdater(
    {
      kind: "restart-result",
      success: result.success,
      targetVersion: result.targetVersion,
      message: result.success ? void 0 : "上次更新未完成，当前仍是此版本。"
    },
    win
  );
}
function scheduleChecks(win, delayMs) {
  if (checkTimer) clearTimeout(checkTimer);
  checkTimer = setTimeout(() => {
    void checkForUpdates(win);
    scheduleChecks(win, nextPeriodicCheckDelayMs());
  }, delayMs);
}
function clearWatchdog() {
  if (!watchdogTimer) return;
  clearTimeout(watchdogTimer);
  watchdogTimer = null;
}
function startWatchdog() {
  clearWatchdog();
  watchdogTimer = setTimeout(() => {
    if (!installInFlight) return;
    installInFlight = false;
    emitUpdater({
      kind: "error",
      message: "安装程序启动后应用仍在运行，请重试。",
      prompt: true
    });
  }, INSTALL_WATCHDOG_MS);
}
async function setupAutoUpdater(win) {
  try {
    const autoUpdater = await loadAutoUpdater();
    bindListeners(autoUpdater, win);
    emitRestartResult(win);
    scheduleChecks(win, FIRST_CHECK_DELAY_MS);
  } catch (err) {
    console.warn("[updater] electron-updater not available", err);
  }
}
async function checkForUpdates(win) {
  if (!canStartCheck(state, installInFlight)) return;
  state = "checking";
  try {
    const autoUpdater = await loadAutoUpdater();
    await autoUpdater.checkForUpdates();
  } catch (err) {
    restoreSettled();
    const message = err instanceof Error ? err.message : String(err);
    emitUpdater({ kind: "error", message }, win);
  }
}
async function downloadUpdate(win) {
  if (installInFlight || state === "ready") return;
  state = "downloading";
  try {
    const autoUpdater = await loadAutoUpdater();
    await autoUpdater.downloadUpdate();
  } catch (err) {
    restoreSettled();
    const message = err instanceof Error ? err.message : String(err);
    emitUpdater({ kind: "error", message }, win);
  }
}
function isUpdateReady() {
  return canQuitAndInstall(state, installInFlight);
}
function emitInstallError(message) {
  emitUpdater({ kind: "error", message, prompt: true });
}
async function installReadyUpdate() {
  if (!canQuitAndInstall(state, installInFlight)) {
    emitInstallError("更新包尚未就绪。");
    return false;
  }
  installInFlight = true;
  writeRestartMarker(restartMarkerPath(), {
    targetVersion: readyVersion || electron.app.getVersion(),
    startedAt: Date.now(),
    explicit: true
  });
  startWatchdog();
  try {
    const autoUpdater = await loadAutoUpdater();
    autoUpdater.quitAndInstall(false, true);
    return true;
  } catch (err) {
    installInFlight = false;
    clearWatchdog();
    clearRestartMarker(restartMarkerPath());
    const message = err instanceof Error ? err.message : String(err);
    emitInstallError(message);
    return false;
  }
}
let quitInFlight = false;
let interceptQuit = false;
function enableQuitIntercept() {
  interceptQuit = true;
}
function shouldInterceptQuit() {
  return interceptQuit && !quitInFlight;
}
function forceQuit() {
  permitExit();
  sidecar.stop();
  electron.app.quit();
}
async function requestAppQuit(options) {
  if (quitInFlight) return;
  quitInFlight = true;
  const ready = isUpdateReady();
  if (options.requireReady && !ready) {
    emitInstallError("更新包尚未就绪。");
    quitInFlight = false;
    return;
  }
  try {
    if (options.applyUpdate && ready) {
      const stopped = await sidecar.stopAndWait(SIDECAR_STOP_TIMEOUT_MS);
      if (stopped) {
        permitExit();
        const started = await installReadyUpdate();
        if (started) return;
      } else {
        emitInstallError("后端未在退出前停止，已取消安装。");
      }
      if (options.requireReady) {
        revokeExit();
        quitInFlight = false;
        return;
      }
      forceQuit();
      return;
    }
    permitExit();
    await sidecar.stopAndWait(SIDECAR_STOP_TIMEOUT_MS);
    electron.app.quit();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitInstallError(message);
    if (options.requireReady) {
      revokeExit();
      quitInFlight = false;
      return;
    }
    forceQuit();
  }
}
let tray = null;
function showMainWindow(win) {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
function setupTray(win) {
  const image = loadTrayIcon();
  if (image.isEmpty()) {
    console.warn("[tray] skipped — icon file missing or unreadable");
    return;
  }
  tray = new electron.Tray(image);
  tray.setToolTip("QIWork");
  tray.setContextMenu(
    electron.Menu.buildFromTemplate([
      {
        label: "显示主窗口",
        click: () => showMainWindow(win)
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          void requestAppQuit({ applyUpdate: true });
        }
      }
    ])
  );
  tray.on("click", () => showMainWindow(win));
}
const UPDATE_PROMPT_ANCHOR_RIGHT = 20;
const UPDATE_PROMPT_ANCHOR_BOTTOM = 20;
const UPDATE_PROMPT_SHADOW_PAD = 36;
function updatePromptWindowBounds(host, size) {
  return {
    x: Math.round(
      host.x + host.width - UPDATE_PROMPT_ANCHOR_RIGHT + UPDATE_PROMPT_SHADOW_PAD - size.w
    ),
    y: Math.round(
      host.y + host.height - UPDATE_PROMPT_ANCHOR_BOTTOM + UPDATE_PROMPT_SHADOW_PAD - size.h
    ),
    width: size.w,
    height: size.h
  };
}
const DATA = "update-prompt:data";
const ACTION = "update-prompt:action";
const RESIZE = "update-prompt:resize";
class UpdatePromptWindow {
  win = null;
  host = null;
  requester = null;
  wanted = false;
  loaded = false;
  data = null;
  size = { w: 432, h: 220 };
  hostOffs = [];
  constructor() {
    electron.ipcMain.on(ACTION, (event, payload) => {
      if (!this.isOwnSender(event.sender)) return;
      this.forwardAction(payload);
    });
    electron.ipcMain.on(RESIZE, (event, payload) => {
      if (!this.isOwnSender(event.sender)) return;
      const next = readSize(payload);
      if (!next) return;
      this.size = next;
      this.reposition();
      this.showIfActive();
    });
  }
  set(payload, requester) {
    if (!payload.open) {
      this.hide();
      return;
    }
    this.show(payload, requester);
  }
  hide() {
    this.wanted = false;
    this.data = null;
    this.destroyWin();
  }
  destroy() {
    this.detachHostListeners();
    this.requester = null;
    this.host = null;
    this.hide();
  }
  show(payload, requester) {
    this.wanted = true;
    this.requester = requester;
    this.data = payload;
    this.bindHost(electron.BrowserWindow.fromWebContents(requester));
    const existing = this.aliveWin();
    if (!existing) {
      this.create();
      return;
    }
    if (this.loaded) existing.webContents.send(DATA, this.data);
    this.showIfActive();
  }
  create() {
    this.loaded = false;
    const win = new electron.BrowserWindow({
      width: this.size.w,
      height: this.size.h,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: updatePromptPreloadPath()
      }
    });
    win.setAlwaysOnTop(true, "pop-up-menu");
    void win.loadURL(updatePromptPageUrl());
    win.webContents.once("did-finish-load", () => {
      if (this.win !== win) return;
      this.loaded = true;
      if (this.data) win.webContents.send(DATA, this.data);
    });
    win.on("closed", () => {
      if (this.win === win) {
        this.win = null;
        this.loaded = false;
      }
    });
    this.win = win;
  }
  reposition() {
    const win = this.aliveWin();
    const host = this.aliveHost();
    if (!win || !host) return;
    win.setBounds(updatePromptWindowBounds(host.getContentBounds(), this.size));
  }
  showIfActive() {
    const win = this.aliveWin();
    const host = this.aliveHost();
    if (!this.wanted || !win || !host) return;
    if (host.isMinimized() || !host.isVisible() || !host.isFocused()) {
      if (win.isVisible()) win.hide();
      return;
    }
    this.reposition();
    if (!win.isVisible()) win.showInactive();
  }
  forwardAction(raw) {
    const type = parseUpdatePromptAction(raw);
    if (!type || !this.requester || this.requester.isDestroyed()) return;
    this.requester.send(ipcEvents.IpcListen.updatePromptAction, { type });
  }
  bindHost(host) {
    if (!host || host.isDestroyed()) return;
    if (host === this.host && this.hostOffs.length) return;
    this.detachHostListeners();
    this.host = host;
    this.attachHostListeners();
  }
  attachHostListeners() {
    const host = this.aliveHost();
    if (!host) return;
    const onMove = () => this.reposition();
    const onResize = () => {
      this.reposition();
      this.showIfActive();
    };
    const onHide = () => {
      const win = this.aliveWin();
      if (win?.isVisible()) win.hide();
    };
    const onShow = () => this.showIfActive();
    host.on("move", onMove);
    host.on("resize", onResize);
    host.on("minimize", onHide);
    host.on("hide", onHide);
    host.on("blur", onHide);
    host.on("restore", onShow);
    host.on("show", onShow);
    host.on("focus", onShow);
    host.on("enter-full-screen", onResize);
    host.on("leave-full-screen", onResize);
    host.on("closed", onHide);
    this.hostOffs = [
      () => host.off("move", onMove),
      () => host.off("resize", onResize),
      () => host.off("minimize", onHide),
      () => host.off("hide", onHide),
      () => host.off("blur", onHide),
      () => host.off("restore", onShow),
      () => host.off("show", onShow),
      () => host.off("focus", onShow),
      () => host.off("enter-full-screen", onResize),
      () => host.off("leave-full-screen", onResize),
      () => host.off("closed", onHide)
    ];
  }
  detachHostListeners() {
    for (const off of this.hostOffs) off();
    this.hostOffs = [];
  }
  destroyWin() {
    this.loaded = false;
    const win = this.aliveWin();
    if (win) win.close();
    this.win = null;
  }
  isOwnSender(sender) {
    const win = this.aliveWin();
    return Boolean(win && sender === win.webContents);
  }
  aliveWin() {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }
  aliveHost() {
    return this.host && !this.host.isDestroyed() ? this.host : null;
  }
}
function readSize(raw) {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw;
  const width = Number(rec.width);
  const height = Number(rec.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { w: Math.max(1, Math.round(width)), h: Math.max(1, Math.round(height)) };
}
let instance = null;
function getUpdatePromptWindow() {
  if (!instance) instance = new UpdatePromptWindow();
  return instance;
}
setupApplicationBranding();
applyHardwareAccelerationPreference();
const UNRESTRICTED_HEADERS = Symbol.for("qiwork.unrestrictedHeaders");
function attachUnrestrictedHeaders(sess) {
  const marked = sess;
  if (marked[UNRESTRICTED_HEADERS]) return;
  marked[UNRESTRICTED_HEADERS] = true;
  sess.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: relaxResponseHeaders(details.responseHeaders)
    });
  });
}
electron.app.on("session-created", attachUnrestrictedHeaders);
electron.app.commandLine.appendSwitch(
  "proxy-bypass-list",
  "<local>;127.0.0.1;localhost;::1"
);
electron.app.commandLine.appendSwitch("no-proxy-server");
registerAppScheme();
const MAC_TRAFFIC_LIGHT_POSITION = { x: 14, y: 11 };
const DESKTOP_CHROME_BG = "#f2f3f8";
let mainWindow = null;
let ipcRegistered = false;
const gotLock = electron.app.requestSingleInstanceLock();
if (!gotLock) {
  electron.app.quit();
} else {
  electron.app.on("second-instance", (_event, argv) => {
    handleDeepLinkArgv(argv, () => mainWindow);
    focusMainWindow(mainWindow);
  });
  registerDeepLinkHandlers(() => mainWindow);
  electron.app.whenReady().then(() => {
    enableQuitIntercept();
    attachUnrestrictedHeaders(electron.session.defaultSession);
    setupAboutPanel();
    setupMacApplicationMenu();
    void createWindow();
    electron.app.on("activate", () => {
      if (electron.BrowserWindow.getAllWindows().length === 0) {
        void createWindow();
      } else {
        focusMainWindow(mainWindow);
      }
    });
  });
}
function registerIpc(win) {
  const bindWindowHandlers = () => {
    electron.ipcMain.removeHandler(ipcEvents.IpcInvoke.restartBackend);
    electron.ipcMain.removeHandler(ipcEvents.IpcInvoke.windowMinimize);
    electron.ipcMain.removeHandler(ipcEvents.IpcInvoke.windowToggleMaximize);
    electron.ipcMain.removeHandler(ipcEvents.IpcInvoke.windowClose);
    electron.ipcMain.removeHandler(ipcEvents.IpcInvoke.openDevtools);
    electron.ipcMain.removeHandler(ipcEvents.IpcInvoke.updaterQuitAndInstall);
    electron.ipcMain.removeHandler(ipcEvents.IpcInvoke.guestBrowserShow);
    electron.ipcMain.removeHandler(ipcEvents.IpcInvoke.guestBrowserHide);
    electron.ipcMain.removeHandler(ipcEvents.IpcInvoke.guestBrowserSetBounds);
    electron.ipcMain.removeHandler(ipcEvents.IpcInvoke.guestBrowserSnapshot);
    electron.ipcMain.removeHandler(ipcEvents.IpcInvoke.guestBrowserNewTab);
    electron.ipcMain.removeHandler(ipcEvents.IpcInvoke.guestBrowserCloseTab);
    electron.ipcMain.removeHandler(ipcEvents.IpcInvoke.guestBrowserSwitchTab);
    electron.ipcMain.removeHandler(ipcEvents.IpcInvoke.guestBrowserNavigate);
    electron.ipcMain.removeHandler(ipcEvents.IpcInvoke.guestBrowserBack);
    electron.ipcMain.removeHandler(ipcEvents.IpcInvoke.guestBrowserForward);
    electron.ipcMain.removeHandler(ipcEvents.IpcInvoke.guestBrowserReload);
    electron.ipcMain.removeHandler(ipcEvents.IpcInvoke.guestBrowserHome);
    electron.ipcMain.removeHandler(ipcEvents.IpcInvoke.guestBrowserStop);
    electron.ipcMain.removeHandler(ipcEvents.IpcInvoke.guestBrowserCommand);
    electron.ipcMain.handle(ipcEvents.IpcInvoke.restartBackend, async () => {
      await sidecar.restart(win);
    });
    electron.ipcMain.handle(ipcEvents.IpcInvoke.windowMinimize, () => minimizeWindow(win));
    electron.ipcMain.handle(
      ipcEvents.IpcInvoke.windowToggleMaximize,
      () => toggleMaximizeWindow(win)
    );
    electron.ipcMain.handle(ipcEvents.IpcInvoke.windowClose, () => closeWindow(win));
    electron.ipcMain.handle(ipcEvents.IpcInvoke.openDevtools, () => openDevTools(win));
    electron.ipcMain.handle(ipcEvents.IpcInvoke.updaterQuitAndInstall, async () => {
      await requestAppQuit({ applyUpdate: true, requireReady: true });
    });
    electron.ipcMain.handle(
      ipcEvents.IpcInvoke.guestBrowserShow,
      (_e, args) => {
        const bounds = parseGuestBounds(args?.bounds);
        if (!bounds) return guestBrowser.snapshot();
        return guestBrowser.show(win, bounds);
      }
    );
    electron.ipcMain.handle(ipcEvents.IpcInvoke.guestBrowserHide, () => {
      guestBrowser.hide();
    });
    electron.ipcMain.handle(ipcEvents.IpcInvoke.guestBrowserSetBounds, (_e, bounds) => {
      const next = parseGuestBounds(bounds);
      if (next) guestBrowser.setBounds(next);
    });
    electron.ipcMain.handle(ipcEvents.IpcInvoke.guestBrowserSnapshot, () => guestBrowser.snapshot());
    electron.ipcMain.handle(
      ipcEvents.IpcInvoke.guestBrowserNewTab,
      (_e, args) => guestBrowser.newTab(args?.url)
    );
    electron.ipcMain.handle(
      ipcEvents.IpcInvoke.guestBrowserCloseTab,
      (_e, args) => args?.id ? guestBrowser.closeTab(args.id) : guestBrowser.snapshot()
    );
    electron.ipcMain.handle(
      ipcEvents.IpcInvoke.guestBrowserSwitchTab,
      (_e, args) => args?.id ? guestBrowser.switchTab(args.id) : guestBrowser.snapshot()
    );
    electron.ipcMain.handle(
      ipcEvents.IpcInvoke.guestBrowserNavigate,
      (_e, args) => guestBrowser.navigate(typeof args?.url === "string" ? args.url : "")
    );
    electron.ipcMain.handle(ipcEvents.IpcInvoke.guestBrowserBack, () => guestBrowser.goBack());
    electron.ipcMain.handle(ipcEvents.IpcInvoke.guestBrowserForward, () => guestBrowser.goForward());
    electron.ipcMain.handle(ipcEvents.IpcInvoke.guestBrowserReload, () => guestBrowser.reload());
    electron.ipcMain.handle(ipcEvents.IpcInvoke.guestBrowserHome, () => guestBrowser.goHome());
    electron.ipcMain.handle(ipcEvents.IpcInvoke.guestBrowserStop, () => guestBrowser.stop());
    electron.ipcMain.handle(
      ipcEvents.IpcInvoke.guestBrowserCommand,
      (_e, cmd) => guestBrowser.command(cmd)
    );
    electron.ipcMain.removeHandler(ipcEvents.IpcInvoke.guestBrowserOverlayReady);
    electron.ipcMain.handle(ipcEvents.IpcInvoke.guestBrowserOverlayReady, () => {
      guestBrowser.markOverlayReady();
    });
  };
  if (ipcRegistered) {
    bindWindowHandlers();
    return;
  }
  ipcRegistered = true;
  electron.ipcMain.handle(ipcEvents.IpcInvoke.runtimeState, () => sidecar.getRuntimeState());
  electron.ipcMain.handle(
    ipcEvents.IpcInvoke.allowBackendForeground,
    () => allowBackendForeground()
  );
  electron.ipcMain.handle(
    ipcEvents.IpcInvoke.openFolder,
    (_e, args) => openFolder(args.path)
  );
  electron.ipcMain.handle(
    ipcEvents.IpcInvoke.openFile,
    (_e, args) => openFile(args.path)
  );
  electron.ipcMain.handle(
    ipcEvents.IpcInvoke.openExternalLink,
    (_e, args) => openExternalLink(args.url)
  );
  electron.ipcMain.handle(ipcEvents.IpcInvoke.getUiLanguage, () => getUiLanguage());
  electron.ipcMain.handle(ipcEvents.IpcInvoke.setUiLanguage, (_e, args) => {
    setUiLanguage(args.language);
  });
  electron.ipcMain.handle(
    ipcEvents.IpcInvoke.setIdleSleepPrevention,
    (_e, args) => setIdleSleepPrevention(args.enabled)
  );
  electron.ipcMain.handle(
    ipcEvents.IpcInvoke.showOpenDialog,
    (_e, args) => showOpenDialog(args)
  );
  electron.ipcMain.handle(
    ipcEvents.IpcInvoke.showSaveDialog,
    (_e, args) => showSaveDialog(args)
  );
  electron.ipcMain.handle(
    ipcEvents.IpcInvoke.downloadBackendFile,
    (_e, args) => downloadBackendFile(args)
  );
  electron.ipcMain.handle(ipcEvents.IpcInvoke.getAppVersion, () => electron.app.getVersion());
  electron.ipcMain.handle(
    ipcEvents.IpcInvoke.updaterCheck,
    (event) => checkForUpdates(electron.BrowserWindow.fromWebContents(event.sender))
  );
  electron.ipcMain.handle(
    ipcEvents.IpcInvoke.updaterDownload,
    (event) => downloadUpdate(electron.BrowserWindow.fromWebContents(event.sender))
  );
  electron.ipcMain.handle(
    ipcEvents.IpcInvoke.showNotification,
    (_e, args) => {
      showDesktopNotification(args.title, args.body);
    }
  );
  electron.ipcMain.handle(ipcEvents.IpcInvoke.clipboardWriteText, (_e, args) => {
    electron.clipboard.writeText(typeof args?.text === "string" ? args.text : "");
  });
  electron.ipcMain.removeHandler(ipcEvents.IpcInvoke.updatePromptSet);
  electron.ipcMain.handle(ipcEvents.IpcInvoke.updatePromptSet, (event, raw) => {
    const payload = parseUpdatePromptPayload(raw);
    if (!payload) return;
    getUpdatePromptWindow().set(payload, event.sender);
  });
  bindWindowHandlers();
}
function parseGuestBounds(raw) {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw;
  const { x, y, width, height } = rec;
  if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number") {
    return null;
  }
  return { x, y, width, height };
}
async function createWindow() {
  registerAppProtocolHandler();
  const appIcon = loadAppIcon();
  const win = new electron.BrowserWindow({
    width: 1480,
    height: 850,
    minWidth: 600,
    minHeight: 600,
    title: APP_DISPLAY_NAME,
    backgroundColor: DESKTOP_CHROME_BG,
    show: true,
    ...process.platform === "win32" && !appIcon.isEmpty() ? { icon: appIcon } : {},
    ...process.platform === "darwin" ? {
      titleBarStyle: "hidden",
      trafficLightPosition: MAC_TRAFFIC_LIGHT_POSITION
    } : {},
    ...process.platform === "win32" ? { frame: false } : {},
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: false,
      preload: preloadPath()
    }
  });
  mainWindow = win;
  guestBrowser.attach(win);
  setupWindowLifecycle(win);
  setupTray(win);
  registerIpc(win);
  if (isDev()) {
    const viteUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173/electron.html";
    await win.loadURL(viteUrl);
  } else {
    await win.loadURL("app://localhost/electron.html");
  }
  const desktopHostEnv = await platformLoginHost.start(win);
  sidecar.setDesktopHostEnv(desktopHostEnv);
  await sidecar.start(win);
  void setupAutoUpdater(win);
  applyDockIcon(appIcon);
}
electron.app.on("window-all-closed", () => {
});
electron.app.on("before-quit", (event) => {
  if (shouldInterceptQuit()) {
    event.preventDefault();
    void requestAppQuit({ applyUpdate: true });
    return;
  }
  permitExit();
  releaseIdleSleep();
  sidecar.stop();
  platformLoginHost.stop();
  guestBrowser.destroy();
  getUpdatePromptWindow().destroy();
});
//# sourceMappingURL=main.cjs.map

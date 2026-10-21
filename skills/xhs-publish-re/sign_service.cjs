/*
 * sign_service.js — 小红书创作平台「页面内签名」常驻服务（逆向兜底方案）
 * ============================================================================
 *
 * 背景（本仓实测结论）：
 *   - headless 会招风控，必须 headless:false + ignoreDefaultArgs 去掉 automation；
 *   - 小红书把 x-s / x-t / x-s-common 签名包在页面请求层外，页面内 fetch
 *     发出即自动带签名（xhs-headed-search.mjs 实测 code:1000）；
 *   - 纯 Node vm 沙箱跑抽出的 chunk 会丢闭包作用域。
 *
 * 最终形态：常驻一个真实 Chrome + 登录态，把「在页面里发请求」这个能力
 * 通过本地 HTTP 暴露出来，Python/任意客户端都能用。
 *
 * 用法：
 *   node sign_service.js --port 8787                          # 复用已有凭证库（推荐）
 *   node sign_service.js --port 8787 --cookies xhs_cookies_dump.json
 *   node sign_service.js --port 8787 --login                  # 首次扫码
 *
 * HTTP 接口：
 *   GET  /health                        → 服务状态 + 登录态 + 签名模式
 *   GET  /cookies                       → 导出当前登录 cookie（jar 格式）
 *   POST /sign      {uri, body}         → 抓该 uri 的真实签名头 x-s/x-t/x-s-common
 *   POST /request    {method,url,body}  → 通用页面内请求代理
 *   POST /upload     {paths:[...]}      → 页面内上传图片，返回 file_id
 *   POST /publish    {title,desc,images}→ 完整发布图文笔记
 *   POST /eval       {code}             → 页面内执行任意 JS（调试）
 *
 * 登录态来源（按优先级）：
 *   1) --cookies 指定的文件（xhs_cookies_dump.json / login.json 均可）
 *   2) .secrets/login.json（上次扫码落下的）
 *   3) 都缺失 → 自动开扫码页等 --login-timeout 秒
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { URL } = require('url');

const PUPPETEER_PATH = process.env.XHS_PUPPETEER ||
  'file:///E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
const CHROME = process.env.XHS_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const CREATOR_HOME = 'https://creator.xiaohongshu.com/new/home';
const PUBLISH_PAGE = 'https://creator.xiaohongshu.com/publish/publish?source=official';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);

const PORT = Number(arg('--port', '8787'));
const COOKIES_FILE = arg('--cookies', '');
const LOGIN_MODE = has('--login');
const LOGIN_TIMEOUT = Number(arg('--login-timeout', '300'));
const HEADLESS = arg('--headless', 'false') === 'true';
const PROFILE_DIR = arg('--profile', path.join(os.tmpdir(), 'xhs-sign-svc-' + Date.now()));
const SECRET_DIR = path.join(__dirname, '.secrets');
const STATE_FILE = path.join(SECRET_DIR, 'sign-service-state.json');

const LOG = (...a) => console.log(new Date().toISOString(), ...a);

/* ------------------------------------------------------------------ *
 * 页面内注入：hook 请求层 + __xhsReq 统一通道
 * ------------------------------------------------------------------ */
const PAGE_HOOK = () => {
  const S = (window.__XHS_SVC = window.__XHS_SVC || {});
  S.log = S.log || [];
  S.permits = S.permits || [];
  S.uploads = S.uploads || [];

  const sniff = (headers) => {
    const h = {};
    for (const k of Object.keys(headers || {})) h[k.toLowerCase()] = String(headers[k]);
    return {
      hasXs: !!h['x-s'], hasXt: !!h['x-t'],
      hasXsCommon: !!h['x-s-common'], hasTrace: !!h['x-b3-traceid'],
      xs: h['x-s'] || '', xt: h['x-t'] || '', xsCommon: h['x-s-common'] || '',
      trace: h['x-b3-traceid'] || '', h,
    };
  };

  const record = (url, method, headers, body) => {
    if (!/\/api\//.test(url)) return;
    S.log.push({ t: Date.now(), url, method, ...sniff(headers), body: body ? String(body).slice(0, 4000) : '' });
    if (S.log.length > 200) S.log.shift();
  };

  if (!S.hooked) {
    S.hooked = true;
    const of = window.fetch;
    window.fetch = async function (...a) {
      const url = typeof a[0] === 'string' ? a[0] : (a[0] && a[0].url) || '';
      const init = a[1] || {};
      record(url, init.method || 'GET', init.headers, init.body);
      // 抓 permit 响应体 + 真实上传（ROS PUT）—— 供 video_http / video_put_probe 用
      try {
        if (/\/permit/i.test(url)) {
          const res = await of.apply(this, a);
          try {
            const c = res.clone();
            const t = await c.text();
            S.permits.push({ url, method: init.method || 'GET', resp: t.slice(0, 6000), at: Date.now() });
            if (S.permits.length > 20) S.permits.shift();
          } catch (e) {}
          return res;
        }
        if (/^https?:\/\/[^/]*(ros-upload|xhscdn\.com\/spectrum|ros-preview)/i.test(url) && !/apm-fe/.test(url)) {
          S.uploads.push({ url: url.slice(0, 300), method: init.method || 'PUT', at: Date.now() });
          if (S.uploads.length > 50) S.uploads.shift();
        }
      } catch (e) {}
      return of.apply(this, a);
    };
    const oo = XMLHttpRequest.prototype.open;
    const os_ = XMLHttpRequest.prototype.send;
    const osr = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function (m, u, ...r) { this.__xhsU = u; this.__xhsM = m; this.__xhsH = []; return oo.call(this, m, u, ...r); };
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) { this.__xhsH.push([k, v]); return osr.call(this, k, v); };
    XMLHttpRequest.prototype.send = function (b) {
      try {
        const h = {}; for (const [k, v] of this.__xhsH || []) h[k] = v;
        const u = String(this.__xhsU);
        record(u, this.__xhsM, h, b);
        if (/\/permit/i.test(u)) {
          this.addEventListener('load', () => {
            try {
              S.permits.push({ url: u, method: this.__xhsM, resp: (this.responseText || '').slice(0, 6000), at: Date.now() });
              if (S.permits.length > 20) S.permits.shift();
            } catch (e) {}
          });
        } else if (/ros-upload|spectrum/i.test(u) && !/apm-fe/.test(u)) {
          S.uploads.push({ url: u.slice(0, 300), method: this.__xhsM, at: Date.now() });
          if (S.uploads.length > 50) S.uploads.shift();
        }
      } catch (e) {}
      return os_.call(this, b);
    };
  }

  window.__xhsReq = async function (opts) {
    const { method = 'GET', url, body = null, form = null, timeout = 45000 } = opts || {};
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      // 风控关联头：x-xray-traceid 与 x-b3-traceid 同源生成（实测 permit 406 的根因）
      // 优先复用页面已抓到的配对，否则按 d0ad1f2ec89c2f6 + 32 hex 的格式自造
      const S = window.__XHS_SVC;
      let pair = null;
      for (let i = S.log.length - 1; i >= 0; i--) {
        const h = S.log[i].h || {};
        if (h['x-xray-traceid'] && h['x-b3-traceid']) { pair = h; break; }
      }
      const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
      const b3 = (pair && pair['x-b3-traceid']) || rnd();
      const xray = (pair && pair['x-xray-traceid']) || ('d0ad1f2ec89c2f6' + b3.replace(/-/g, '').slice(0, 24));
      const baseHeaders = {
        'accept': 'application/json, text/plain, */*',
        'x-b3-traceid': b3,
        'x-xray-traceid': xray,
      };
      let req;
      if (form) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(form)) {
          if (v && typeof v === 'object' && v.data !== undefined) {
            const bytes = Uint8Array.from(atob(v.data), (c) => c.charCodeAt(0));
            fd.append(k, new Blob([bytes], { type: v.type || 'application/octet-stream' }), v.name || 'file');
          } else fd.append(k, v);
        }
        req = { method, body: fd, signal: ctrl.signal, headers: baseHeaders };
      } else if (body !== null && body !== undefined) {
        req = {
          method, signal: ctrl.signal,
          headers: Object.assign({}, baseHeaders, { 'Content-Type': 'application/json;charset=UTF-8' }),
          body: typeof body === 'string' ? body : JSON.stringify(body),
        };
      } else {
        req = { method, signal: ctrl.signal, headers: baseHeaders };
      }
      const r = await fetch(url, Object.assign({ credentials: 'include' }, req));
      const text = await r.text();
      return { status: r.status, text };
    } finally { clearTimeout(timer); }
  };

  window.__xhsSignOf = function (urlRe) {
    const re = new RegExp(urlRe);
    for (let i = S.log.length - 1; i >= 0; i--) {
      if (re.test(S.log[i].url) && S.log[i].hasXs) return S.log[i];
    }
    return null;
  };

  window.__xhsProbeMode = async function () {
    // 触发一次无害的带签名请求：拉取创作平台配置（必带 x-s）
    const before = S.log.length;
    try {
      await window.__xhsReq({ method: 'GET', url: '/api/sns/web/v1/creator/config', timeout: 15000 });
    } catch (e) {}
    const hit = S.log.slice(before).find((x) => x.hasXs);
    return { mode: hit ? 'auto' : 'manual', sample: hit || null };
  };

  return true;
};

/* ------------------------------------------------------------------ *
 * 浏览器与页面
 * ------------------------------------------------------------------ */
let browser = null;
let page = null;
const state = { mode: 'unknown', ready: false, loginOk: false, cookieCount: 0, lastUrl: '' };

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function normalizeCookieFile(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  // 支持三种形态：{cookie_str} / {jar} / {cookies} / "a=1; b=2"
  if (typeof raw === 'string') return raw;
  if (raw.cookie_str) return raw.cookie_str;
  if (raw.cookie && typeof raw.cookie === 'string') return raw.cookie;
  const jar = raw.jar || raw.cookies;
  if (jar && typeof jar === 'object') {
    return Object.entries(jar).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  throw new Error('无法解析 cookie 文件: ' + file);
}

async function injectCookieStr(cookieStr) {
  const domains = ['.xiaohongshu.com', 'www.xiaohongshu.com', 'creator.xiaohongshu.com', 'edith.xiaohongshu.com'];
  const cs = [];
  for (const part of cookieStr.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!value) continue;
    for (const d of domains) cs.push({ name, value, domain: d, path: '/' });
  }
  await page.setCookie(...cs);
  LOG('注入 cookie：%d 名 x %d 域 = %d 项', new Set(cs.map((c) => c.name)).size, domains.length, cs.length);
}

async function launch() {
  const puppeteer = (await import(PUPPETEER_PATH)).default;
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  fs.mkdirSync(SECRET_DIR, { recursive: true });

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: HEADLESS,
    userDataDir: PROFILE_DIR,
    ignoreDefaultArgs: ['--enable-automation', '--disable-blink-features=AutomationControlled'],
    args: ['--no-first-run', '--no-default-browser-check', '--lang=zh-CN,zh', '--window-position=0,0'],
    defaultViewport: { width: 1440, height: 900 },
  });

  page = (await browser.pages())[0] || await browser.newPage();
  await page.evaluateOnNewDocument(PAGE_HOOK);

  // 先落基础 cookie（a1/webId 等），再注入会话
  await page.goto('https://www.xiaohongshu.com/explore', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(2000);

  // 登录态来源
  const candidates = [];
  if (COOKIES_FILE && fs.existsSync(COOKIES_FILE)) candidates.push(COOKIES_FILE);
  const fallback = path.join(SECRET_DIR, 'login.json');
  if (fs.existsSync(fallback)) candidates.push(fallback);

  let injected = false;
  for (const f of candidates) {
    try { await injectCookieStr(normalizeCookieFile(f)); injected = true; break; } catch (e) { LOG('cookie 注入失败 %s: %s', f, e.message); }
  }
  if (!injected) LOG('未提供 cookie，走扫码登录');

  LOG('goto', PUBLISH_PAGE);
  await page.goto(PUBLISH_PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => LOG('goto warn', String(e)));
  await sleep(4000);

  if (/login|error/i.test(page.url())) {
    LOG('未登录，打开扫码页（超时 %ds）…', LOGIN_TIMEOUT);
    await page.goto('https://creator.xiaohongshu.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await waitLogin(LOGIN_TIMEOUT * 1000);
    await page.goto(PUBLISH_PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(3000);
  }

  await page.evaluate(PAGE_HOOK);
  state.ready = true;
  const probe = await page.evaluate(() => window.__xhsProbeMode());
  state.mode = probe.mode;

  state.loginOk = await checkLogin();
  const cdp = await page.createCDPSession();
  const { cookies } = await cdp.send('Network.getAllCookies');
  state.cookieCount = cookies.filter((c) => /xiaohongshu/.test(c.domain)).length;
  state.lastUrl = page.url();
  if (state.loginOk) await exportCookies();
  LOG('ready mode=%s login=%s cookies=%d url=%s', state.mode, state.loginOk, state.cookieCount, state.lastUrl);}

async function waitLogin(maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await sleep(2000);
    const u = page.url();
    if (u && !/login/i.test(u)) {
      LOG('登录成功 url=%s', u);
      await exportCookies();
      return true;
    }
  }
  LOG('登录等待超时');
  return false;
}

async function exportCookies() {
  const cdp = await page.createCDPSession();
  const { cookies } = await cdp.send('Network.getAllCookies');
  const jar = {};
  for (const c of cookies) {
    if (!/xiaohongshu/.test(c.domain)) continue;
    if (!jar[c.name] || c.domain.startsWith('.xiaohongshu')) jar[c.name] = c.value;
  }
  const out = path.join(SECRET_DIR, 'login.json');
  fs.mkdirSync(SECRET_DIR, { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ jar, at: new Date().toISOString() }, null, 2), 'utf8');
  LOG('cookie 已导出 -> %s（%d 项）', out, Object.keys(jar).length);
  return out;
}

// 登录态判据：页面 DOM 里的用户信息比打接口可靠（creator 的 /user/me 会返回 HTML 兜底页）
async function checkLogin() {
  try {
    const j = await page.evaluate(() => {
      const t = (document.body && document.body.innerText) || '';
      const hasUser = /退出登录|我的主页|个人主页|创作者|数据看板/.test(t) && !/扫码登录|手机号登录|请登录/.test(t);
      const sideUser = document.querySelector('.side-container .user-name, .user-name, [class*="userName"]');
      return {
        hasUser,
        sideUser: sideUser ? (sideUser.textContent || '').trim().slice(0, 40) : '',
        snippet: t.replace(/\s+/g, ' ').slice(0, 200),
      };
    });
    const ok = j.hasUser || !!j.sideUser;
    LOG('checkLogin ->', ok, j.sideUser || j.snippet.slice(0, 80));
    return ok;
  } catch (e) { return false; }
}

/* ------------------------------------------------------------------ *
 * 业务动作（全部在页面内完成，签名由页面自算）
 * ------------------------------------------------------------------ */
async function fn_upload(paths) {
  const forms = [];
  for (const p of paths) {
    const b64 = fs.readFileSync(p).toString('base64');
    forms.push({
      file: {
        data: b64,
        name: path.basename(p),
        type: /\.png$/i.test(p) ? 'image/png' : 'image/jpeg',
      },
    });
  }
  const r = await page.evaluate(async (forms) => {
    const out = [];
    for (const f of forms) {
      const res = await window.__xhsReq({
        method: 'POST',
        url: 'https://creator.xiaohongshu.com/api/sns/web/v1/upload',
        form: { file: f.file },
        timeout: 120000,
      });
      let j = null; try { j = JSON.parse(res.text); } catch (e) {}
      out.push({ status: res.status, text: res.text.slice(0, 3000), data: j && j.data });
    }
    return out;
  }, forms);

  const fileIds = [];
  const raw = [];
  for (const item of r) {
    raw.push(item);
    const fid = item.data && (item.data.file_id || item.data.fileid || item.data.fileId);
    if (fid) fileIds.push(fid);
  }
  return { fileIds, raw };
}

async function fn_publish(title, desc, images) {
  const up = await fn_upload(images);
  if (!up.fileIds.length) return { ok: false, stage: 'upload', detail: up.raw };
  const body = {
    title: title || '',
    desc: desc || '',
    type: 'normal',
    ats: [],
    image_info: { images: up.fileIds.map((fid) => ({ file_id: fid })) },
    post_timer: '',
  };
  const r = await page.evaluate(async (payload) => {
    const res = await window.__xhsReq({
      method: 'POST',
      url: '/api/sns/web/v1/note',
      body: payload,
      timeout: 120000,
    });
    return { status: res.status, text: res.text };
  }, body);

  let j = null; try { j = JSON.parse(r.text); } catch (e) {}
  return {
    ok: !!(j && (j.success === true || j.code === 0)),
    status: r.status,
    data: j,
    text: r.text.slice(0, 3000),
    fileIds: up.fileIds,
  };
}

async function fn_sign(uri, body) {
  const before = await page.evaluate(() => window.__XHS_SVC.log.length);
  try {
    await page.evaluate(({ uri, body }) => window.__xhsReq({
      method: body ? 'POST' : 'GET',
      url: uri,
      body: body || null,
      timeout: 20000,
    }), { uri, body: body || null });
  } catch (e) {}
  await sleep(400);
  const hit = await page.evaluate(({ uri, before }) => {
    const S = window.__XHS_SVC;
    for (let i = S.log.length - 1; i >= before; i--) {
      if (S.log[i].url.includes(uri) && S.log[i].hasXs) return S.log[i];
    }
    return null;
  }, { uri, before });
  return hit || null;
}

/* ------------------------------------------------------------------ *
 * HTTP 服务
 * ------------------------------------------------------------------ */
function jsonRes(res, code, obj) {
  const s = JSON.stringify(obj, null, 2);
  res.writeHead(code, { 'content-type': 'application/json;charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(s);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 64 * 1024 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { resolve({ _raw: b }); } });
    req.on('error', reject);
  });
}

async function route(req, res) {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname;
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      return res.end();
    }

    if (p === '/health' && req.method === 'GET') {
      return jsonRes(res, 200, {
        ok: true, ready: state.ready, mode: state.mode,
        login: state.loginOk, cookieCount: state.cookieCount,
        url: state.lastUrl, pid: process.pid,
      });
    }
    if (!state.ready) return jsonRes(res, 503, { ok: false, error: 'browser not ready' });

    if (p === '/cookies' && req.method === 'GET') {
      const f = await exportCookies();
      return jsonRes(res, 200, { ok: true, file: f });
    }

    if (p === '/sign' && req.method === 'POST') {
      const b = await readBody(req);
      let hit = null;
      if (b.reuse) {
        hit = await page.evaluate((uri) => {
          const S = window.__XHS_SVC;
          for (let i = S.log.length - 1; i >= 0; i--) {
            if (S.log[i].url.includes(uri) && S.log[i].hasXs) return S.log[i];
          }
          for (let i = S.log.length - 1; i >= 0; i--) {
            if (S.log[i].hasXs && /creator\.xiaohongshu\.com/.test(S.log[i].url)) return S.log[i];
          }
          return null;
        }, b.uri || '/api/sns/web/v1/note');
      } else {
        hit = await fn_sign(b.uri || '/api/sns/web/v1/note', b.body);
      }
      // 附带返回全部已抓到的 permit 请求的完整头（供逆向）
      const permitHits = await page.evaluate(() => {
        const S = window.__XHS_SVC;
        return S.log.filter((x) => /permit/i.test(x.url)).slice(-4).map((x) => ({
          url: x.url, method: x.method, headers: x.h, at: x.t,
        }));
      });
      return jsonRes(res, hit ? 200 : 404, hit
        ? { ok: true, uri: b.uri, reuse: !!b.reuse, capturedUrl: hit.url, 'x-s': hit.xs, 'x-t': hit.xt, 'x-s-common': hit.xsCommon, 'x-b3-traceid': hit.trace, headers: hit.h, permitHits }
        : { ok: false, error: 'no signed request captured', mode: state.mode, permitHits });
    }

    if (p === '/request' && req.method === 'POST') {
      const b = await readBody(req);
      const r = await page.evaluate((o) => window.__xhsReq({
        method: o.method || 'GET', url: o.url, body: o.body || null, timeout: o.timeout || 45000,
      }), b);
      return jsonRes(res, 200, { ok: true, status: r.status, text: r.text });
    }

    if (p === '/upload' && req.method === 'POST') {
      const b = await readBody(req);
      const r = await fn_upload(b.paths || []);
      return jsonRes(res, r.fileIds.length ? 200 : 500, r);
    }

    if (p === '/publish' && req.method === 'POST') {
      const b = await readBody(req);
      const r = await fn_publish(b.title, b.desc, b.images || []);
      return jsonRes(res, r.ok ? 200 : 500, r);
    }

    if (p === '/eval' && req.method === 'POST') {
      const b = await readBody(req);
      const r = await page.evaluate((c) => eval(c), b.code || '');
      return jsonRes(res, 200, { ok: true, result: r });
    }

    jsonRes(res, 404, { ok: false, error: 'not found', path: p });
  } catch (e) {
    LOG('route error', p, String(e));
    jsonRes(res, 500, { ok: false, error: String(e) });
  }
}

async function main() {
  await launch();
  fs.writeFileSync(STATE_FILE, JSON.stringify({ port: PORT, pid: process.pid, at: new Date().toISOString(), ...state }, null, 2), 'utf8');

  const server = http.createServer((req, res) => { route(req, res); });
  server.listen(PORT, '127.0.0.1', () => LOG('sign_service listening http://127.0.0.1:%d', PORT));

  const shutdown = async () => {
    LOG('shutdown…');
    try { await exportCookies(); } catch (e) {}
    try { await browser.close(); } catch (e) {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  LOG('fatal', String(e && e.stack || e));
  process.exit(1);
});

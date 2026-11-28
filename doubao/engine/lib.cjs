// 淘宝新版发布页操作库（独立测试版，不动正式插件）。
// 全部基于 2026-11 对 item.upload.taobao.com/sell/v2/publish.htm 的实测；不包含提交动作。
const path = require('path');
// 分段变速：默认 0.75 提速（属性/SKU 段实测安全）；提交前准备段必须切回 1（0.6/0.75 下提交点击偶发无效，实测两次）。
// DSAGENT_SPEED=1 时与原版完全一致。出问题先把它调回 1 再排查。
let _speed = Math.max(0.3, Math.min(1, parseFloat(process.env.DSAGENT_SPEED || '0.6')));
const setSpeed = f => { _speed = Math.max(0.3, Math.min(1, f)); };
const sleep = ms => new Promise(r => setTimeout(r, Math.round(ms * _speed)));
// ── 浏览器启动（可移植：不写死盘符、用户名、店铺）──────────────────────────────
// puppeteer-core 随包放在 engine/node_modules，相对本文件定位。
const PUP = path.join(__dirname, 'node_modules', 'puppeteer-core');
// Chrome 探测：环境变量 > 常规安装位置 > PATH。对方装在 D 盘时设 DS_CHROME_PATH 即可。
const findChrome = () => {
  const fs = require('fs');
  const cands = [process.env.DS_CHROME_PATH,
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')].filter(Boolean);
  for (const c of cands) { if (c && fs.existsSync(c)) return c; }
  return 'chrome.exe';
};
// 账号 profile 根目录：与拼多多基座同一处（~/.dsh/browser-profiles/accounts/<shopKey>），可被 DS_HOME 覆盖。
const DS_HOME = process.env.DS_HOME || path.join(require('os').homedir(), '.dsh');
const profileDirOf = shopKey => path.join(DS_HOME, 'browser-profiles', 'accounts', shopKey || 'taobao_default');
// 后台标签页包装：新标签页不抢焦点（Target.createTarget background:true + 焦点仿真），键盘/焦点事件照常生效。
const wrapBackgroundTabs = (b) => {
  b.newPage = async () => {
    const session = await b.target().createCDPSession();
    const { targetId } = await session.send('Target.createTarget', { url: 'about:blank', background: true });
    await session.detach();
    const target = await b.waitForTarget(t => t._targetId === targetId, { timeout: 10000 });
    const page = await target.page();
    await page.createCDPSession().then(s => s.send('Emulation.setFocusEmulationEnabled', { enabled: true })).catch(() => {});
    return page;
  };
  return b;
};
// 取浏览器。两种用法：
//   getBrowser({ browser })            包装一个已有浏览器（兼容旧调用）
//   getBrowser({ shopKey, headless })  自己启动 Chrome：按 shopKey 独立 profile，返回 { browser, close }
// 不传 shopKey 时用 taobao_default。
const getBrowser = async (o = {}) => {
  const puppeteer = require(PUP);
  if (o.browser) return wrapBackgroundTabs(o.browser);
  const fs = require('fs'); const { spawn } = require('child_process'); const net = require('net');
  const shopKey = o.shopKey || 'taobao_default';
  const profile = o.profileDir || profileDirOf(shopKey);
  for (const n of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort']) { try { fs.rmSync(path.join(profile, n), { force: true, recursive: true }); } catch (e) {} }
  fs.mkdirSync(profile, { recursive: true });
  const port = await new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
  const headless = o.headless !== false; // 默认无头：不弹窗、不打断用户；需要人工看页面（如扫码）时传 false
  const args = [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled', '--lang=zh-CN', '--window-size=1440,900',
    ...(headless ? ['--headless=new', '--disable-gpu'] : ['--window-position=100,50']),
    ...(o.args || []), 'about:blank'];
  const proc = spawn(findChrome(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let errTail = ''; proc.stderr.on('data', d => { errTail = (errTail + String(d)).slice(-1500); });
  proc.on('error', e => { errTail = 'Chrome 启动失败（检查是否已安装 Chrome，或设 DS_CHROME_PATH）：' + e.message; });
  const t0 = Date.now(); let info = null;
  while (Date.now() - t0 < 30000 && !info) { await new Promise(r => setTimeout(r, 150)); try { const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) }); info = await r.json(); } catch (e) {} }
  if (!info) { try { proc.kill(); } catch (e) {} throw new Error(errTail.slice(-300) || 'Chrome 30 秒内未就绪'); }
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null });
  return { browser: wrapBackgroundTabs(browser), port, proc, profileDir: profile,
    close: async () => { try { await browser.disconnect(); } catch (e) {} try { proc.kill(); } catch (e) {} } };
};

// ── 页面内定位：选择器 + 可选 placeholder / title / 精确文本，只取可见元素 ──
const LOC = (sel, opt) => {
  let el = Array.from(document.querySelectorAll(sel)).filter(e => e.offsetParent !== null);
  if (opt && opt.ph) el = el.filter(e => e.placeholder === opt.ph);
  if (opt && opt.text) el = el.filter(e => (e.innerText || '').replace(/\s+/g, ' ').trim() === opt.text);
  if (opt && opt.title) el = el.filter(e => e.getAttribute('title') === opt.title);
  if (opt && opt.leafText) el = el.filter(e => e.children.length === 0 && (e.innerText || '').trim() === opt.leafText);
  el = el.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const e = el[opt && opt.nth || 0];
  if (!e) return { found: 0 };
  e.scrollIntoView({ block: 'center' });
  const r = e.getBoundingClientRect();
  return { found: el.length, x: r.x + r.width / 2, y: r.y + r.height / 2 };
};
const OVERLAY_HTML = (n) => { const e = document.querySelector('.next-overlay-wrapper.opened .next-overlay-inner'); return e ? e.outerHTML.replace(/\s+/g, ' ').slice(0, n) : null; };
const CATPROP_SCHEMA = () => (window.Json.components.catProp.props.dataSource || []).map(f => ({
  name: f.name, label: f.label, required: f.required === true, uiType: f.uiType,
  options: Array.isArray(f.dataSource) ? f.dataSource.map(o => ({ text: o.text, value: o.value, needContentNumber: o.needContentNumber })) : null,
  multi: Array.isArray(f.dataSource) && (f.uiType === 'checkbox' || f.uiType === 'multiSelect'),
}));
const SALEPROP_SCHEMA = () => { const sp = window.Json.components.saleProp || {}, sku = window.Json.components.sku || {}; const out = { pids: sp.pids || [], dims: [] };
  for (const d of (Array.isArray(sku.dataSource) ? sku.dataSource : [])) { const s = (sp.subItems || {})[d.name] || {}; out.dims.push({ name: d.name, label: d.label, uiType: d.uiType || s.uiType, optionCount: Array.isArray(s.dataSource) ? s.dataSource.length : null,
    options: Array.isArray(s.dataSource) ? s.dataSource.slice(0, 40).map(o => o.text) : null }); }
  return out; };

class TaobaoPublishPage {
  constructor(page) { this.page = page; this.log = []; }
  step(s) { this.say(`\n== ${s} ==`); }
  say(...a) { const s = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); this.log.push(s); console.log(s.slice(0, 600)); }
  async loc(sel, opt) { return this.page.evaluate(LOC, sel, opt || null); }
  // 点击分两步：先按条件找到元素并滚到可见、给它打标记；等滚动落定后再取它的坐标去点。
  // 不能在同一次里「滚动 + 取坐标」（尺码弹窗的号型组在屏外时取到的是滚动前的旧坐标，点空 → 实测牛仔裤连续失败）
  async click(sel, opt, label) {
    const token = 'c' + Date.now() + Math.random().toString(36).slice(2, 7);
    const n = await this.page.evaluate((sel, opt, token) => {
      let el = Array.from(document.querySelectorAll(sel)).filter(e => e.offsetParent !== null);
      if (opt && opt.ph) el = el.filter(e => e.placeholder === opt.ph);
      if (opt && opt.text) el = el.filter(e => (e.innerText || '').replace(/\s+/g, ' ').trim() === opt.text);
      if (opt && opt.title) el = el.filter(e => e.getAttribute('title') === opt.title);
      if (opt && opt.leafText) el = el.filter(e => e.children.length === 0 && (e.innerText || '').trim() === opt.leafText);
      el = el.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      const e = el[opt && opt.nth || 0]; if (!e) return 0;
      e.scrollIntoView({ block: 'center', behavior: 'instant' }); e.setAttribute('data-ds-click', token); return el.length;
    }, sel, opt || null, token);
    if (!n) { this.say(`  [miss] ${label || sel}`); return false; }
    await sleep(350);
    const p = await this.page.evaluate((token) => { const e = document.querySelector(`[data-ds-click="${token}"]`); if (!e) return null; e.removeAttribute('data-ds-click'); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, token);
    if (!p) { this.say(`  [miss] ${label || sel}`); return false; }
    await this.page.mouse.click(p.x, p.y); await sleep(1000); return true;
  }
  // 按「文档顺序的第 n 个可见元素」自己的坐标点，不经过 loc 的按位置整理。
  // 抽屉里横向加行后新旧输入框纵坐标完全相同（实测手机型号 y 都是 357），loc 会把两个当成同一个位置而点到旧框，新值覆盖旧值。
  async clickEl(sel, nth, label) {
    const p = await this.page.evaluate((sel, nth) => { const e = Array.from(document.querySelectorAll(sel)).filter(x => x.offsetParent !== null)[nth || 0]; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + Math.min(r.height / 2, 12) }; }, sel, nth || 0);
    if (!p) { this.say(`  [miss] ${label || sel}`); return false; }
    await sleep(300);
    const p2 = await this.page.evaluate((sel, nth) => { const e = Array.from(document.querySelectorAll(sel)).filter(x => x.offsetParent !== null)[nth || 0]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel, nth || 0);
    if (!p2) { this.say(`  [miss] ${label || sel}`); return false; }
    await this.page.mouse.click(p2.x, p2.y); await sleep(1000); return true;
  }
  async confirmDialog() {
    const b = await this.loc('.next-dialog-wrapper .next-dialog-btn.next-btn-primary');
    if (!b.found) return false;
    this.say('  确认对话框 →', await this.page.evaluate(() => { const e = document.querySelector('.next-dialog-wrapper .next-message-content'); return e ? e.innerText.trim().slice(0, 80) : ''; }));
    await this.page.mouse.click(b.x, b.y); await sleep(1500); return true;
  }
  async overlays() { return this.page.evaluate(() => Array.from(document.querySelectorAll('.next-overlay-wrapper.opened .next-overlay-inner')).filter(e => e.offsetParent !== null).map(e => (e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120))); }
  // 等浮层打开（最多 6s）；没开就再点一次目标
  async waitOverlay(retrySel, retryOpt) {
    for (let i = 0; i < 12; i++) { if ((await this.overlays()).length) return true; await sleep(500);
      if (i === 5 && retrySel) await this.click(retrySel, retryOpt, '重开浮层'); }
    return false;
  }
  // 点进输入框 → 全选 → 输入 → Tab/Enter 提交。
  // 表格右侧常被透明悬浮层（iframe）盖住，鼠标点不到：点完若焦点不在目标上，直接 focus()。
  async typeInto(sel, opt, value, commit) {
    const p = await this.loc(sel, opt);
    if (!p.found) { this.say(`  [miss] 输入 ${sel}`); return false; }
    await this.page.mouse.click(p.x, p.y); await sleep(400);
    // ★ 必须用与定位相同的一套过滤（占位符/序号）：只按序号会聚焦到同容器里别的 input（如单选钮），
    //   抢走文字框焦点 → 输入落空（自定义规格值对照实验两次复现）。
    await this.page.evaluate((s, o) => {
      let el = Array.from(document.querySelectorAll(s)).filter(e => e.offsetParent !== null);
      if (o && o.ph) el = el.filter(e => e.placeholder === o.ph);
      const target = el[(o && o.nth) || 0];
      if (target && document.activeElement !== target) target.focus();
    }, sel, opt || null);
    await sleep(200);
    const focused = await this.page.evaluate(() => document.activeElement && document.activeElement.tagName === 'INPUT');
    if (!focused) { this.say(`  (焦点未进入输入框 ${sel})`); return false; }
    const str = String(value);
    const typeVal = async () => {
      await this.page.keyboard.down('Control'); await this.page.keyboard.press('KeyA'); await this.page.keyboard.up('Control');
      // 含中文的值逐字符注入（不经过键盘按键/输入法）；纯 ASCII 走键盘
      if (/[^\x00-\x7f]/.test(str)) { for (const ch of str) await this.page.keyboard.sendCharacter(ch); }
      else await this.page.keyboard.type(str, { delay: 45 });
    };
    // 写完必须回读核对：出现过一次值里多出无关汉字（原因未定位），不对就清空重输
    for (let attempt = 0; attempt < 3; attempt++) {
      await typeVal();
      // 组件对输入有延迟处理：打完立刻失焦会把值冲掉（自定义规格值实测计数仍为 0）
      await sleep(700);
      await this.page.keyboard.press(commit || 'Tab'); await sleep(900);
      const got = await this.page.evaluate((s, o) => { let el = Array.from(document.querySelectorAll(s)).filter(e => e.offsetParent !== null); if (o && o.ph) el = el.filter(e => e.placeholder === o.ph); const x = el[(o && o.nth) || 0]; return x ? x.value : null; }, sel, opt || null);
      // 数值框回读会被格式化（9.9 → 9.90）：按数值比
      if (got === str || (got !== null && got.trim() !== '' && Number(got) === Number(str) && /^[\d.]+$/.test(str.trim()))) {
        // 自动补全控件失焦后会自己弹联想下拉，混进后续点击里会误选它的候选项（实测把「标」追加进了上一格）→ 关掉再走
        if (await this.page.evaluate(() => !!document.querySelector('.next-overlay-wrapper.opened'))) { await this.esc(); await sleep(500); }
        return true;
      }
      this.say(`  (回读不符「${got}」≠「${str}」，重输)`);
    }
    return false;
  }
  async esc() { await this.page.keyboard.press('Escape').catch(() => {}); await sleep(400); }

  // 直达指定类目的发布页
  async open(catId) {
    await this.page.setViewport({ width: 1440, height: 900 });
    // 页面会弹原生「离开此页？更改可能不会保存」确认框，不处理会把整个标签页卡死（后续脚本调用全部超时，实测）。
    // 自动点「离开」并留痕；本次流程里页面数据都不需要保留。
    if (!this._dialogHooked) { this._dialogHooked = true; this.page.on('dialog', async (d) => { this.say(`  [弹窗] ${d.type()}「${String(d.message()).slice(0, 40)}」→ ${d.type() === 'beforeunload' ? '离开' : '确定'}`); try { await d.accept(); } catch (e) {} }); }
    await this.page.goto(`https://item.upload.taobao.com/sell/v2/publish.htm?catId=${catId}&newRouter=1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const dl = Date.now() + 60000;
    while (Date.now() < dl) { if (await this.page.evaluate(() => !!(window.Json && window.noIcmpJson && window.Json.components && window.Json.components.catProp)).catch(() => false)) break; await sleep(200); }
    await sleep(5000);
  }
  async catPropSchema() { return this.page.evaluate(CATPROP_SCHEMA); }
  async salePropSchema() { return this.page.evaluate(SALEPROP_SCHEMA); }

  // 类目属性下拉：按选项文本精确点选（多选可多次调用；单选调用后按 Esc 关闭）
  // 页面有两种控件：① 标准下拉（输入框只读，浮层里另带搜索框）；② 自动补全（输入框可直接打字过滤）。
  async selectAttr(pid, text, { multi = false, keyword, selector, nth } = {}) {
    const sel = selector || `#struct-${pid} input[role="combobox"]`;
    const kw = keyword || text;
    // 候选文字与目标值的比较忽略空格和大小写：页面候选常写作「iPhone16」「iPhone16  」，商品里是「iPhone 16」
    const nrm = (s) => String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();
    const nrmKw = (s) => (/\s/.test(String(s)) ? [s, String(s).replace(/\s+/g, '')] : [s]);
    const readonly = await this.page.evaluate((s, nth) => { const e = Array.from(document.querySelectorAll(s)).filter(x => x.offsetParent !== null)[nth || 0]; return e ? e.readOnly : true; }, sel, nth == null ? null : nth);
    // 关键词一律「页面内设值 + input 事件」，不走键盘（中文经键盘输入出过一次串字，原因未定位；此法实测可过滤候选）
    // ★ 必须带上序号：抽屉里同一维度有多个输入框时，设到「第一个」会把关键词打进已填好的行，新值覆盖旧值（实测手机型号）
    const setterType = (selector, v, nth) => this.page.evaluate((selector, v, nth) => { const e = Array.from(document.querySelectorAll(selector)).filter(x => x.offsetParent !== null)[nth == null ? 0 : nth]; if (!e) return false; e.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, v); e.dispatchEvent(new Event('input', { bubbles: true })); return true; }, selector, v, nth == null ? null : nth);
    const visible = () => this.page.evaluate(() => Array.from(document.querySelectorAll('.next-overlay-wrapper.opened .options-item')).filter(e => e.offsetParent !== null).map(e => e.getAttribute('title')));
    for (let attempt = 0; attempt < 3; attempt++) {
    if (nth != null ? !await this.clickEl(sel, nth, `属性 ${pid}`) : !await this.click(sel, null, `属性 ${pid}`)) return false;
    const token = 'ds' + Date.now() + Math.random().toString(36).slice(2, 7);
    await this.page.evaluate((s, nth, token) => { const e = Array.from(document.querySelectorAll(s)).filter(x => x.offsetParent !== null)[nth || 0]; if (e) e.dataset.dsMark = token; }, sel, nth == null ? null : nth, token);
      // 浮层打开有快有慢（产地 99 个候选是异步加载），最多等 3.5s；没开就改点整个下拉体再试
      let open = false; const dl = Date.now() + 3500;
      while (Date.now() < dl) { open = await this.page.evaluate(() => !!document.querySelector('.next-overlay-wrapper.opened .options-item')); if (open) break; await sleep(250); }
      if (!open) { await this.click(`#struct-${pid} .next-select`, null, `属性 ${pid} 下拉体`); await sleep(1500); open = await this.page.evaluate(() => !!document.querySelector('.next-overlay-wrapper.opened .options-item')); }
      // 浮层必须是本属性的：别的输入框残留的联想下拉会让后续点击误选到它的候选
      const own = await this.page.evaluate((pid) => !!document.querySelector(`#struct-${pid} .next-select[aria-expanded="true"], #struct-${pid} input[aria-expanded="true"], #struct-${pid} .next-select.next-active`), pid);
      if (!open || (selector ? false : !own)) { await this.esc(); await sleep(500); continue; }
      // 候选浮层打开后会挪位置（同选色浮层）：等稳定再定位，否则按坐标点会落空（实测手机型号第一个值丢了）
      await this.waitOverlayStable();
      // 过滤：自动补全型打在输入框自己身上；标准下拉型打在浮层搜索框里
      if (kw) { if (readonly) { await setterType('.next-overlay-wrapper.opened .options-search input', kw); } else { await setterType(sel, kw, nth); } }
      // 等目标选项出现（最多 3s）；精确匹配优先，否则取包含关系的那个（如「浙江」→「浙江省」）
      // 候选多（几十上百项）时列表是虚拟滚动的，只渲染前几项。过滤要靠「浮层自带的搜索框」——把关键词设进它自己的输入框没用（实测）。
      let titles = []; let dl2 = Date.now() + 2500;
      while (Date.now() < dl2) { titles = await visible(); if (titles.some(x => nrm(x) === nrm(text))) break; await sleep(300); }
      if (!titles.some(x => nrm(x) === nrm(text)) && kw && await this.page.evaluate(() => !!document.querySelector('.next-overlay-wrapper.opened .options-search input'))) {
        // 关键词带空格时（「iPhone 16」）页面搜索可能不认 → 先原样、再去掉空格各试一次
        for (const k of nrmKw(kw)) {
          await this.page.evaluate((k) => { const e = document.querySelector('.next-overlay-wrapper.opened .options-search input'); if (!e) return; e.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, k); e.dispatchEvent(new Event('input', { bubbles: true })); }, k);
          this.say(`  [过滤] 浮层搜索框设关键词「${k}」`);
          dl2 = Date.now() + 2500;
          while (Date.now() < dl2) { titles = await visible(); if (titles.some(x => nrm(x) === nrm(text))) break; await sleep(300); }
          if (titles.some(x => nrm(x) === nrm(text))) break;
        }
      }
      const target0 = titles.find(x => nrm(x) === nrm(text));
      // 候选几十上百项时列表是虚拟滚动的：页面只渲染前几项，不过滤也不在 DOM 里 → 把候选区一屏屏滚到底找
      if (!target0) {
        for (let step = 0; step < 25; step++) {
          const moved = await this.page.evaluate(() => {
            const box = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened .options-menu, .next-overlay-wrapper.opened [class*="menu"], .next-overlay-wrapper.opened ul')).filter(e => e.offsetParent !== null && e.scrollHeight > e.clientHeight + 4).sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
            if (!box) return false;
            const before = box.scrollTop; box.scrollTop = before + Math.max(120, box.clientHeight - 30); return box.scrollTop !== before;
          });
          if (!moved) break;
          await sleep(350);
          titles = await visible();
          if (titles.some(x => nrm(x) === nrm(text))) { this.say(`  [滚动] 第 ${step + 1} 屏才找到「${text}」`); break; }
        }
      }
      const target = target0 || titles.find(x => x && nrm(x) === nrm(text)) || titles.find(x => x && nrm(x).includes(nrm(text))) || titles.find(x => x && nrm(text).includes(nrm(x))) || null;
      if (!target) { this.say(`  [miss] 选项「${text}」（当前候选 ${titles.length ? titles.slice(0, 6).join('/') : '无'}）`); await this.esc(); continue; }
      // 过滤后候选列表变短，浮层会再重排一次 → 点候选前再等它稳定
      await this.waitOverlayStable(1500);
      const ok = await this.click('.next-overlay-wrapper.opened .options-item', { title: target }, `选项「${target}」`);
      // 选完不要盲目按 Esc：页面会把它当成「放弃编辑」并弹「操作未提交生效，确认退出？」，这个提示框会挡住后面所有点击。
      // 下拉自己没关才关一次；若已弹出退出提示，点「取消」留在编辑态。
      await sleep(900);
      if (await this.page.evaluate(() => Array.from(document.querySelectorAll('.options-item')).some(e => e.offsetParent !== null))) { if (!multi) await this.esc(); }
      await sleep(400);
      // 可打字的控件值留在输入框里 → 回读核对，没落值就重来（只读下拉的值不进输入框，没法这样核对）。
      // ★ 不能按「第几个输入框」回读：选完值页面会把行重新排序（实测手机型号），按序号会读到别的行，误判为空后重试还把已填好的行覆盖掉。
      //   填之前给目标输入框打标记，回读只认带标记的那个。
      if (ok && !readonly) {
        // 值有两种落法：留在输入框里（手机型号），或显示成标签、输入框清空（螺钉的强度等级）→ 两处都认
        const got = await this.page.evaluate((token) => { const e = document.querySelector(`[data-ds-mark="${token}"]`); if (!e) return null; const box = e.closest('.next-select, .sell-o-combobox') || e.parentElement; return { val: String(e.value).replace(/\s+/g, ''), shown: (box.innerText || '').replace(/\s+/g, '') }; }, token);
        await this.page.evaluate((token) => { const e = document.querySelector(`[data-ds-mark="${token}"]`); if (e) delete e.dataset.dsMark; }, token);
        const landed = got && (nrm(got.val) === nrm(target) || (got.val === '' && got.shown.includes(nrm(target))));
        if (!landed) { this.say(`  [重选] 「${text}」点完显示的是「${got && (got.val || got.shown)}」，重来`); await this.esc(); continue; }
      }
      await this.page.evaluate(() => { const d = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened, .next-dialog')).find(o => o.offsetParent !== null && /未提交生效/.test(o.innerText || '')); const c = d && Array.from(d.querySelectorAll('button')).find(b => /^取\s*消$/.test(b.innerText.trim())); if (c) c.click(); });
      return ok;
    }
    return false;
  }
  async mouseType(x, y, text) { await this.page.mouse.click(x, y); await sleep(300); await this.page.keyboard.type(text, { delay: 40 }); }

  // 按 Accio 的做法定尺码号型组：不逐组试探，直接读页面数据 window.Json.components.saleProp.props。
  // subItems[pid].subItems 里：selectedSizeGroupId.dataSource = 全部号型组（含页面当前选中的），name 以 sizeGroup_ 开头的项 = 各组尺码。
  // 返回包含全部尺码的组；页面当前组优先（同一个尺码文字可能出现在多个组，如牛仔裤 30 在欧码/丹麦码/德码）。
  async resolveSizeGroup(pid, sizes) {
    const norm = s => String(s).replace(/\s+/g, '').toLowerCase();
    const data = await this.page.evaluate((pid) => {
      const sp = window.Json && window.Json.components && window.Json.components.saleProp; const props = sp && sp.props;
      const dim = props && props.subItems && props.subItems[pid]; if (!dim || !Array.isArray(dim.subItems)) return null;
      const radio = dim.subItems.find(s => s.name === 'selectedSizeGroupId'); if (!radio || !Array.isArray(radio.dataSource)) return null;
      const cur = props.value && props.value[pid] && props.value[pid].selectedSizeGroupId;
      const groups = radio.dataSource.map(g => ({ text: g.text, subName: g.subName }));
      const sizesOf = {};
      for (const s of dim.subItems) { if (!/^sizeGroup_/.test(s.name)) continue; const t = []; for (const row of (s.dataSource || [])) for (const it of (Array.isArray(row.sizeList) ? row.sizeList : [row])) { const x = String(it && (it.text ?? it.value ?? '')).trim(); if (x) t.push(x); } sizesOf[s.name] = t; }
      return { groups, sizesOf, current: cur ? { text: cur.text, subName: cur.subName } : null };
    }, pid);
    if (!data) return { ok: false, reason: '页面数据里没有号型组' };
    const fits = data.groups.filter(g => { const t = (data.sizesOf[g.subName] || []).map(norm); return t.length > 0 && sizes.every(s => t.includes(norm(s))); });
    const current = fits.find(g => data.current && g.subName === data.current.subName) || null;
    const use = current || fits[0] || null;
    this.say(`  号型组(页面数据): 共 ${data.groups.length} 组，当前「${data.current ? data.current.text : '-'}」，能装下 ${sizes.join('/')} 的: ${fits.map(g => g.text).join('/') || '无'}`);
    return { ok: !!use, group: use && use.text, needSwitch: !!(use && data.current && use.subName !== data.current.subName), reason: fits.length ? '' : '没有号型组包含全部尺码' };
  }

  // 标准尺码：号型组 → 勾选尺码 → 确定（可能再弹确认框）
  async selectSizes(groupText, sizes, pid = 'p-20509') {
    const resolved = await this.resolveSizeGroup(pid, sizes);
    if (resolved && resolved.ok === false) { this.say(`  [miss] ${resolved.reason}（${sizes.join('/')}）`); return false; }
    const groupNames = () => this.page.evaluate(() => Array.from(document.querySelectorAll('.next-overlay-wrapper.opened .sell-size-group-item')).filter(e => e.offsetParent !== null).map(e => e.innerText.replace(/\s+/g, ' ').trim()));
    const sizeLabels = () => this.page.evaluate(() => Array.from(document.querySelectorAll('.next-overlay-wrapper.opened label.next-checkbox-wrapper')).filter(e => e.offsetParent !== null).map(e => e.innerText.replace(/\s+/g, ' ').trim()));
    // 弹窗有时开不出来（实测牛仔裤偶发，之后所有号型组都点不到、候选为空）：必须等到号型组或尺码项真的出现，最多重开 4 次
    const isOpen = async () => ((await groupNames()).length || (await sizeLabels()).length) > 0;
    const openSize = async () => {
      for (let k = 0; k < 4; k++) {
        await this.click(`#struct-${pid} input`, { ph: '请选择尺码' }, '请选择尺码');
        const dl = Date.now() + 3500; while (Date.now() < dl) { if (await isOpen()) return true; await sleep(300); }
        await this.closeColorPopup(); await sleep(800);
      }
      return false;
    };
    // 每次操作前都确认弹窗还开着：实测出现过「读到组名之后、去点之前弹窗被关掉」，之后每组都点空
    const ensureOpen = async () => (await isOpen()) ? true : (await openSize()) ? (await this.waitOverlayStable(1500), true) : false;
    if (!await ensureOpen()) { this.say(`  [miss] 尺码弹窗没打开（${sizes.join('/')}）`); return false; }
    await this.waitOverlayStable(1500);
    const norm = s => String(s).replace(/\s+/g, '').toLowerCase();
    const groups = await groupNames();
    if (groups.length) {
      this.say(`  号型组: ${groups.join('/')}`);
      const hasAll = async () => { const ls = (await sizeLabels()).map(norm); return ls.length > 0 && sizes.every(s => ls.includes(norm(s))); };
      let use = null;
      if (resolved && resolved.ok) {
        // 页面数据已定位到组：需要切组才点一次，不逐组试探（逐组试探是旧版失败的根因）
        use = resolved.group;
        if (resolved.needSwitch) {
          if (!await ensureOpen()) { this.say('  [miss] 尺码弹窗没打开'); return false; }
          await this.click('.next-overlay-wrapper.opened .sell-size-group-item', { text: use }, `号型组「${use}」`); await sleep(1200); await this.confirmDialog();
        } else this.say(`  号型组不用切（页面已是「${use}」）`);
      } else {
      // 页面数据不可用时的兜底：调用方给的组名，或逐个组找能装下全部尺码的那个
      use = groups.find(g => groupText && norm(g).includes(norm(groupText)));
      if (!use || !await hasAll()) {
        use = null;
        for (const g of groups) {
          if (!await ensureOpen()) break;
          await this.click('.next-overlay-wrapper.opened .sell-size-group-item', { text: g }, `号型组「${g}」`); await sleep(1200); await this.confirmDialog();
          if (await hasAll()) { use = g; break; }
        }
      }
      if (use && use !== groups[0]) { if (!await ensureOpen()) { this.say('  [miss] 尺码弹窗重开失败'); return false; } await this.click('.next-overlay-wrapper.opened .sell-size-group-item', { text: use }, `号型组「${use}」`); await sleep(1200); await this.confirmDialog(); }
      }
      if (!use) { const ls = await sizeLabels(); this.say(`  [miss] 没有号型组能装下 ${sizes.join('/')}；候选如 ${ls.slice(0, 12).join('/')}`); await this.esc(); return false; }
    } else if (groupText) this.say('  [提示] 尺码弹窗没有号型组，直接勾选');
    if (!await ensureOpen()) { this.say('  [miss] 勾选尺码前弹窗已关'); return false; }
    for (const s of sizes) { await this.click('.next-overlay-wrapper.opened label.next-checkbox-wrapper', { text: s }, `尺码 ${s}`); } await sleep(300);
    this.say('  尺码已选:', await this.page.evaluate(() => { const e = document.querySelector('.next-overlay-wrapper.opened .selected-length'); return e ? e.innerText : null; }));
    await this.click('.next-overlay-wrapper.opened .submit-btn', null, '尺码弹窗 确定');
    await sleep(800); await this.confirmDialog(); await sleep(2500);
    return (await this.overlays()).length === 0;
  }

  // 颜色浮层结构探查
  async dumpColorOverlay() {
    await this.click('#struct-p-1627207 input', { ph: '主色(必选)' }, '主色(必选)');
    this.say('  颜色浮层HTML:', await this.page.evaluate(OVERLAY_HTML, 2600));
  }
  // 材质成分（ui=material）：按行「选材质 → 填含量%」；行结构 .material-item。pairs = [[材质, 含量文字], ...]
  // ★ 必须回读：旧版不管选没选上都记「已填」，把失败盖住了（实测牛仔裤、棉袜的材质成分其实一直是空的）
  async fillMaterials(pairs, pid = 'p-149422948') {
    const scope = `#struct-${pid} .material-item`;
    for (let i = 0; i < pairs.length; i++) {
      if (i > 0) { await this.click(`#struct-${pid} [class*="add"]`, null, '新增材质行'); await sleep(900); }
      const selMat = await this.selectAttr(pid, pairs[i][0], { keyword: pairs[i][0], selector: `${scope} input[role="combobox"]`, nth: i });
      if (pairs[i][1] != null) { await this.typeInto(`${scope} input`, Object.assign({ ph: '输入含量' }, { nth: i }), String(pairs[i][1]).replace('%', ''), 'Tab'); await sleep(500); }
      if (!selMat) this.say(`  [miss] 材质「${pairs[i][0]}」没选上`);
    }
    const got = await this.page.evaluate((scope) => Array.from(document.querySelectorAll(scope)).filter(e => e.offsetParent !== null).map(e => Array.from(e.querySelectorAll('input')).map(x => x.value || (x.closest('.next-select') || {}).innerText || '').join(':').replace(/\s+/g, '')), scope);
    const okAll = pairs.every((p, i) => (got[i] || '').includes(String(p[0]).replace(/\s+/g, '')) && (p[1] == null || (got[i] || '').includes(String(p[1]).replace('%', ''))));
    this.say(`  材质成分回读: ${JSON.stringify(got)} ${okAll ? '✓' : '✗'}`);
    return okAll;
  }
  // 「棉80% 氨纶20%」/「棉 80%，氨纶 20%」→ [['棉','80'],['氨纶','20']]；也接受已经是数组的写法
  parseMaterial(v) {
    if (Array.isArray(v)) {
      // [[棉,98],[聚酯纤维,2]] 原样；[棉,100%] 是一个材质拆成两个元素；其余每个元素是一个不带含量的材质
      if (v.every(x => Array.isArray(x))) return v.map(x => x.map(String));
      if (v.length === 2 && !Array.isArray(v[1]) && /^\s*[\d.]+\s*%?\s*$/.test(String(v[1]))) return [[String(v[0]), String(v[1]).replace('%', '')]];
      return v.map(x => Array.isArray(x) ? x.map(String) : [String(x)]);
    }
    const out = []; const re = /([^\d\s,，、;；]+?)\s*([\d.]+)\s*%/g; let m;
    while ((m = re.exec(String(v)))) out.push([m[1].trim(), m[2]]);
    return out;
  }

  // 类目属性全量填：入参 { 属性名: 值 | [值...] }。按页面 schema 逐个对控件类型下针，品牌跳过。
  // 返回 { filled: [名=值], missed: [原因], defaulted: [名=默认值] }；必填但没给值的按 policy 取（这里不默认，只报出）。
  async fillAttributes(attrs) {
    const schema = await this.catPropSchema();
    const out = { filled: [], missed: [] };
    // 没有必填项的类目（如螺钉）会把全部属性收进「其他属性 0/13」折叠区；有必填项的类目（如 T恤）折叠的是选填部分。
    // 只要有要填的属性还没显示出来，就点「其他属性」标题旁的图标展开。
    await this.expandAttrFold();
    for (let pass = 0; pass < 2; pass++) {
      await this.fillAttributesPass(attrs, out, schema);
      const more = await this.expandAttrFold();
      if (!more) break; // 展开后可能又长出一批，再扫一遍
    }
    out.missed = Array.from(new Set(out.missed)).filter(m => { const label = m.split(/[=（]/)[0]; return !out.filled.some(f => f.startsWith(label + '=')); });
    // 联动属性：选完上级（如 产地）后页面才长出下级（如 省份），不在初始结构里 → 按页面 DOM 复查补填
    for (let pass = 0; pass < 3; pass++) {
      const dom = await this.attrDisplay();
      const todo = dom.find(d => !d.value && attrs[d.label] != null && !out.filled.some(s => s.startsWith(d.label + '=')));
      if (!todo) break;
      const pid = todo.id.replace(/^struct-/, ''); const values = Array.isArray(attrs[todo.label]) ? attrs[todo.label] : [attrs[todo.label]];
      let okAll = true;
      for (const v of values) { const ok = await this.selectAttr(pid, String(v), { multi: values.length > 1 }); if (ok) out.filled.push(`${todo.label}=${v}`); else okAll = false; }
      if (!okAll) out.missed.push(`${todo.label}（联动属性点选失败）`);
      if (todo.label === '品牌') out.missed.push(`品牌=「${values[0]}」留人工（授权风险）`);
      await sleep(800);
    }
    // 先失败后成功的属性，把过期的「未填」提示去掉（必须在所有补填环节之后做）
    out.missed = Array.from(new Set(out.missed)).filter(m => { const label = m.split(/[=（]/)[0]; return !out.filled.some(f => f.startsWith(label + '=')); });
    return out;
  }

  // 展开「其他属性」折叠区（选填属性都收在里面）。点到了返回 true；没有可展开的返回 false。
  async expandAttrFold() {
    const pos = await this.page.evaluate(() => {
      const title = Array.from(document.querySelectorAll('#struct-catProp .title-text')).find(e => e.offsetParent !== null && /^(其他属性|更多属性)/.test((e.innerText || '').trim()));
      if (!title) return null;
      const box = title.parentElement;
      const icon = box.querySelector('.next-icon, i, svg');
      if (!icon) return null;
      // 已展开的标志：标题下方已出现该组的属性行（用「已显示属性数 < 结构里的总数」间接判断在外部做，这里只给坐标）
      icon.scrollIntoView({ block: 'center' });
      const r = icon.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }).catch(() => null);
    if (!pos) return false;
    const before = (await this.attrDisplay()).length;
    await this.page.mouse.click(pos.x, pos.y); await sleep(1500);
    const after = (await this.attrDisplay()).length;
    if (after > before) { this.say(`  展开其他属性：${before} → ${after} 项`); return true; }
    // 没变化：可能点的是折叠箭头把它收起了 → 再点一次还原，不算展开
    if (after < before) { await this.page.mouse.click(pos.x, pos.y); await sleep(1200); }
    return false;
  }

  // 一轮：按结构逐个属性填；已填过（out.filled 里有）的跳过
  async fillAttributesPass(attrs, out, schema) {
    const pickOption = (f, want) => (f.options || []).find(o => o.text === want) || (f.options || []).find(o => o.text.includes(want)) || (f.options || []).find(o => want.includes(o.text));
    for (const f of schema) {
      if (out.filled.some(s => s.startsWith(f.label + '='))) continue;
      if (f.label === '品牌') { if (attrs[f.label]) out.missed.push(`品牌=「${attrs[f.label]}」留人工（授权风险）`); continue; }
      const raw = attrs[f.label];
      if (raw == null || raw === '' || (Array.isArray(raw) && !raw.length)) { if (f.required) out.missed.push(`${f.label}（必填，未提供值）`); continue; }
      const values = Array.isArray(raw) ? raw : [raw];
      try {
        if (f.uiType === 'material') {
          const pairs = this.parseMaterial(values.length === 1 ? values[0] : values);
          if (!pairs.length) { out.missed.push(`${f.label}=「${values.join('/')}」（拆不出「材质 百分比」）`); continue; }
          const okM = await this.fillMaterials(pairs, f.name);
          out.filled.push(`${f.label}=${pairs.map(p => p.join(' ')).join(' + ')}${okM ? '' : '（回读不符）'}`);
          if (!okM) out.missed.push(`${f.label}（材质成分回读不符）`);
          continue;
        }
        if (f.uiType === 'input') {
          // 文本型属性也是自动补全控件（role=combobox、可直接打字），直接键入后 Tab
          const ok = await this.typeInto(`#struct-${f.name} input[role="combobox"]`, null, values[0], 'Tab'); await sleep(500);
          ok ? out.filled.push(`${f.label}=${values[0]}`) : out.missed.push(`${f.label}=「${values[0]}」（未定位到输入框）`); continue;
        }
        if (f.uiType === 'taoSirProp') {
          // 度量控件：数字框（占位符「数字」，可能是范围型有两个框）+ 可选的单位下拉。值写成 "50000" 或 "50000|次"
          const [num, unit] = String(values[0]).split('|');
          // 该属性下所有可见数字框（范围型有两个，实测克重范围只填一个会报「设置信息不完整」）
          const boxes = await this.page.evaluate((nm) => { const root = document.querySelector(`#struct-${nm}`); if (!root) return []; return Array.from(root.querySelectorAll('input[placeholder="数字"]')).filter(e => e.offsetParent !== null).map(e => { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }); }, f.name);
          if (!boxes.length) { out.missed.push(`${f.label}=「${num}」（没定位到数字框）`); continue; }
          let okM = true;
          for (const b of boxes) { await this.page.mouse.click(b.x, b.y); await sleep(500); await this.page.keyboard.down('Control'); await this.page.keyboard.press('a'); await this.page.keyboard.up('Control'); await sleep(150); await this.page.keyboard.type(num, { delay: 60 }); await this.page.keyboard.press('Tab'); await sleep(500); }
          if (unit) { const unitOk = await this.selectAttr(f.name, unit, { keyword: unit }); if (!unitOk) { out.missed.push(`${f.label} 单位「${unit}」选不到`); okM = false; } }
          out.filled.push(`${f.label}=${num}${boxes.length > 1 ? '×' + boxes.length : ''}${unit ? '|' + unit : ''}`);
          continue;
        }
        const multi = f.multi || values.length > 1;
        const hit = [];
        for (const v of values) {
          const opt = f.options ? pickOption(f, v) : null;
          if (f.options && !opt) { out.missed.push(`${f.label}=「${v}」（不在候选里，候选如 ${(f.options.slice(0, 5).map(o => o.text)).join('/')}）`); continue; }
          const ok = await this.selectAttr(f.name, opt.text, { multi, keyword: opt.text });
          if (ok) hit.push(opt.text); else out.missed.push(`${f.label}=「${opt.text}」（点选失败）`);
        }
        if (hit.length) out.filled.push(`${f.label}=${hit.join('|')}`);
      } catch (e) { out.missed.push(`${f.label}（异常 ${e.message.slice(0, 40)}）`); }
    }
  }

  // 每个属性的页面显示值（用于校验：Json 是静态快照，不能当真）
  async attrDisplay() {
    return this.page.evaluate(() => Array.from(document.querySelectorAll('.sell-catProp-item-common[id^="struct-p-"]')).map(e => ({
      id: e.id, label: (e.querySelector('label') || {}).innerText || '', required: !!((e.querySelector('label') || {}).classList || {}).contains?.('required'),
      value: Array.from(e.querySelectorAll('.next-select em, .next-select-values, input:not([role=combobox]), input[role=combobox]:not([readonly])')).filter(x => x.offsetParent !== null).map(x => (x.tagName === 'INPUT' ? x.value : x.innerText).replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ').slice(0, 120) })));
  }

  // 颜色：主色浮层 = 左侧色系 li.color-tag → 右侧 ul.color-list li.color-tag；选后再填「备注(可选)」
  // 关掉选色浮层并确认它真的没了：浮层自带的遮罩会盖住后面的加号/输入框（实测抽屉里加行、点第 2 行全被吃掉）
  async closeColorPopup() {
    const visible = () => this.page.evaluate(() => Array.from(document.querySelectorAll('.colors-panel li.color-tag, .color-group-panel li.color-tag')).some(e => e.offsetParent !== null));
    for (let i = 0; i < 6 && await visible(); i++) { await this.esc(); await sleep(400); }
    return !(await visible());
  }
  // 浮层打开后会自己再挪一次位置（实测选色浮层 y 挪了约 68px = 一行）：按刚量的坐标点会点到隔壁一行（白色→深灰色）。
  // 等位置连续两次读数一致再定位。返回是否稳定。
  async waitOverlayStable(maxMs = 3000) {
    const rect = () => this.page.evaluate(() => { const o = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')).filter(e => e.offsetParent !== null && !e.querySelector('.sku-decouple-drawer')).pop(); if (!o) return null; const r = o.getBoundingClientRect(); return Math.round(r.x) + ',' + Math.round(r.y); });
    const start = Date.now(); let last = await rect(); let stableSince = Date.now();
    while (Date.now() - start < maxMs) {
      await sleep(200); const now = await rect();
      if (now === null) return false;
      if (now !== last) { last = now; stableSince = Date.now(); } else if (Date.now() - stableSince >= 600) return true;
    }
    return true;
  }
  async selectColor(nth, groupText, colorText, remark, pid = 'p-1627207', mainPh = '主色(必选)') {
    const scope = this.colorScope(pid);
    const row = { nth };
    if (!colorText) { this.say(`  [miss] 颜色「${remark}」没有对应标准色，跳过`); return false; }
    const rowValue = () => this.page.evaluate((scope, nth) => (Array.from(document.querySelectorAll(`${scope} input[placeholder="主色(必选)"]`)).filter(e => e.offsetParent !== null)[nth] || {}).value || '', scope, nth);
    // 「量坐标再按坐标点」之间列表会重排（实测把黑色点成了浅灰色）→ 改为页面内按文字直接点元素；点完回读主色值，不对重来
    let ok = false;
    for (let tryN = 0; tryN < 4; tryN++) {
      await this.closeColorPopup();
      // 浮层有时开得慢：必须等到它真的出来且位置稳定才往下点，否则后面的点击全落空（实测点偏后重开时必现）
      let opened = false;
      for (let k = 0; k < 4 && !opened; k++) { await this.click(`${scope} input`, Object.assign({ ph: mainPh }, row), mainPh); await sleep(500); opened = (await this.overlays()).length > 0 && await this.waitOverlayStable(); if (!opened) await sleep(900); }
      if (!opened) { this.say('  [miss] 选色浮层没打开'); continue; }
      const colorVisible = () => this.page.evaluate((c) => Array.from(document.querySelectorAll('.next-overlay-wrapper.opened .colors-panel li.color-tag')).some(e => e.offsetParent !== null && e.innerText.trim() === c), colorText);
      // 点色系 → 等目标色出现；点完具体色后回读。面板偶尔会被迟到的渲染覆盖成别的色系（实测），所以不只点一次，以回读值为准
      // 点色系 → 等目标色出现。★ 色系列表是「悬停即切换」的：点完色系浮层会再挪一行，鼠标没动就悬停到了隔壁色系上，
      // 面板随即被换掉（实测黑色→浅灰色）。所以稳定后必须确认「当前高亮的色系就是目标色系」，不是就再点一次。
      const activeGroup = () => this.page.evaluate(() => { const e = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened .color-group-panel li.color-tag')).find(x => x.offsetParent !== null && /active|selected|checked/.test(x.className)); return e ? e.innerText.trim() : null; });
      for (let k = 0; k < 4; k++) {
        await this.click('.next-overlay-wrapper.opened .color-group-panel li.color-tag', { text: groupText }, `色系「${groupText}」`);
        const dl = Date.now() + 3000; while (Date.now() < dl && !(await colorVisible())) await sleep(250);
        await this.waitOverlayStable(1500); await sleep(300);
        if (!groupText || (await activeGroup()) === groupText) break;
        this.say(`  [校正] 面板停在「${await activeGroup()}」，要点回「${groupText}」`);
      }
      // 把鼠标挪到浮层空白处，避免之后落点又悬停到别的色系
      await this.page.mouse.move(5, 5); await sleep(200);
      if (!(await colorVisible())) { this.say(`  [miss] 色系「${groupText}」里没等到「${colorText}」`); ok = false; continue; }
      ok = await this.click('.next-overlay-wrapper.opened .colors-panel li.color-tag', { text: colorText }, `颜色「${colorText}」`);
      await sleep(900);
      const got = await rowValue();
      if (ok && got === colorText) break;
      this.say(`  [重选] 第 ${nth + 1} 个颜色点成了「${got}」，应为「${colorText}」，重来`);
      ok = false;
    }
    await this.closeColorPopup();
    if (!ok) return false;
    if (remark != null) {
      const r = await this.loc(`${scope} input`, Object.assign({ ph: '备注(可选)' }, row));
      if (r.found) { await this.page.mouse.click(r.x, r.y); await this.page.keyboard.down('Control'); await this.page.keyboard.press('KeyA'); await this.page.keyboard.up('Control'); await this.page.keyboard.type(remark, { delay: 50 }); await this.page.keyboard.press('Tab'); await sleep(1500); }
    }
    return ok;
  }
  // 新增一个颜色值行（选完至少一个颜色后按钮才可点）
  async addColorRow(pid = 'p-1627207') { const ok = await this.click(this._drawerColor ? '.sku-decouple-drawer button.add' : `#struct-${pid} button.add`, null, '新增规格值行'); await sleep(1800); return ok; }
  // 新增一个自定义规格值行（非标准尺码的类目用）
  async addSizeRow() { return this.click('#struct-p-20509 button.size-option-add-btn', null, '新增规格行'); }

  // SKU 表逐行填：单元格 id = `{行号}-skuPrice|skuStock|skuOuterId`
  async fillSkuRows(rows) {
    // 两遍：先全部价格/库存（提交后表格会重渲染），再填商家编码，避免被重渲染冲掉
    for (const pass of [['price', 'skuPrice', 'Tab'], ['stock', 'skuStock', 'Tab'], ['outerId', 'skuOuterId', 'Tab']]) {
      const [key, cell, commit] = pass;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i][key] == null) continue;
        await this.typeInto(`#struct-sku td[id="${i}-${cell}"] input`, null, rows[i][key], commit);
      }
    }
    // 回读校验：表格重渲染会冲掉刚输入的值（实测偶发首行价格为空），为空的格再补一遍
    const read = () => this.page.evaluate((n) => Array.from({ length: n }, (_, i) => ['skuPrice', 'skuStock', 'skuOuterId'].map(c => { const e = document.querySelector(`#struct-sku td[id="${i}-${c}"] input`); return e ? e.value : null; })), rows.length);
    let done = await read();
    for (let round = 0; round < 2; round++) {
      const empties = [];
      rows.forEach((r, i) => [['price', 'skuPrice', 0], ['stock', 'skuStock', 1], ['outerId', 'skuOuterId', 2]].forEach(([key, cell, col]) => { if (r[key] != null && String(r[key]) !== '' && !done[i][col]) empties.push([i, cell, r[key]]); }));
      if (!empties.length) break;
      this.say(`  SKU 表有 ${empties.length} 格为空，重补`);
      for (const [i, cell, v] of empties) { await sleep(1200); await this.typeInto(`#struct-sku td[id="${i}-${cell}"] input`, null, v, 'Tab'); }
      done = await read();
    }
    return done;
  }

  // 整个 Json / noIcmpJson 里搜某个值落在哪（定位属性值的存放位置）
  async findValue(needle) {
    return this.page.evaluate((n) => {
      const hits = [];
      const walk = (v, p, depth) => { if (depth > 9 || hits.length > 12) return;
        if (v === n) { hits.push(p); return; }
        if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], `${p}.${k}`, depth + 1); };
      walk(window.Json, 'Json', 0); walk(window.noIcmpJson, 'noIcmp', 0);
      return hits;
    }, needle);
  }
  async skuTable() {
    return this.page.evaluate(() => { const h = document.querySelector('#struct-sku'); if (!h) return null;
      return { text: (h.innerText || '').replace(/\s+/g, ' ').slice(0, 300), inputs: Array.from(h.querySelectorAll('input')).filter(e => e.offsetParent !== null).map(e => `${e.placeholder}=${e.value}`) }; });
  }
  // ── 规格通用入口：商品 specs（[{name,values}]）→ 页面维度 ──
  // 两种形态：① 类目预置了销售属性行（如 T恤 的 颜色/尺码）；② 「+ 创建规格」抽屉（如 螺钉）。
  async fillSpecs(P) {
    const sp = await this.salePropSchema();
    const presetRows = await this.page.evaluate(() => Array.from(document.querySelectorAll('#struct-saleProp li.sell-component-common-sale-props-option-item')).filter(e => e.offsetParent !== null).length);
    const hasDrawer = await this.page.evaluate(() => Array.from(document.querySelectorAll('#struct-sku button')).some(e => e.offsetParent !== null && /\+\s*创建规格/.test(e.innerText)));
    const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();
    const dims = sp.dims.length ? sp.dims : await this.page.evaluate(() => {
      // 预置行形态下维度不在结构数据里：从销售属性区的行容器现读（id=struct-p-xxx，标题带计数，如「颜色分类(2)」）
      const seen = new Map();
      // 每个维度一个容器 id=struct-p-xxx（class 含 common-wrap），首行文字是标题，如「主要颜色(0) 重要」
      for (const box of Array.from(document.querySelectorAll('#struct-saleProp [id^="struct-p-"]'))) {
        if (box.offsetParent === null || !/^struct-p-\d+$/.test(box.id) || seen.has(box.id)) continue;
        const label = ((box.innerText || '').split('\n')[0] || '').replace(/[\(（]\d+[\)）]/g, '').replace(/重要/g, '').trim();
        const inp = box.querySelector('li input');
        seen.set(box.id, { name: box.id.replace(/^struct-/, ''), label, uiType: inp && /请选择尺码/.test(inp.placeholder) ? 'size' : 'newColorSelect', optionCount: null, options: null });
      }
      return Array.from(seen.values());
    });
    const given = (P.specs || []).map(s => ({ name: s.name, values: s.values.map(v => v && v.value !== undefined ? v.value : v) }));
    if (!presetRows && hasDrawer) {
      await this.click('#struct-sku button', { text: '+ 创建规格' }, '创建规格'); await sleep(2500);
      if (given.length >= 2) return this.fillSpecsDrawerStandard(given);
      await this.click('.sku-decouple-drawer .next-radio-wrapper', { text: '自定义填写规格' }, '自定义填写规格'); await sleep(1500);
      const values = given[0] ? given[0].values : [];
      if (!values.length) return { ok: false };
      for (let i = 0; i < values.length; i++) {
        if (i > 0) { await this.click('.sku-decouple-drawer button.add', null, '加规格行'); await sleep(1200); }
        await this.typeInto('.sku-decouple-drawer input', { ph: '输入规格', nth: i }, values[i], 'Tab'); await sleep(1200);
      }
      const n = await this.page.evaluate(() => parseInt(((document.querySelector('.sku-decouple-drawer .props-label') || {}).innerText || '').replace(/\D/g, ''), 10));
      this.say(`  自定义规格值 ${n}/${values.length} 个已建`);
      await this.click('.sku-decouple-drawer button', { text: '确认创建' }, '确认创建'); await sleep(3500);
      // 自定义规格的 SKU 行不显示规格名，只能按创建顺序对行
      this.specOrder = values.map(v => [v]);
      return { ok: n === values.length };
    }
    // ① 预置行：逐维度填；商品没给的页面维度用页面首个候选补一个（规格必须成套）
    // 商品维度 → 页面维度：按名字包含关系对上（颜色↔主要颜色/颜色分类，尺码↔尺码/规格…）
    const matchDim = (name) => dims.find(d => d.label && (norm(d.label).includes(norm(name)) || norm(name).includes(norm(d.label)) || (name === '颜色' && /颜色/.test(d.label)) || (name === '尺码' && /尺码|身高|规格/.test(d.label))));
    this.say(`  形态: ${presetRows ? '预置销售属性行' : hasDrawer ? '创建规格抽屉' : '未知'}；页面维度 ${dims.map(d => d.label).join('/') || '无'}`);
    for (const d of dims) {
      const g = given.find(s => matchDim(s.name) === d) || given.find(s => norm(s.name) === norm(d.name));
      let values = g ? g.values : [];
      if (!values.length) { values = (d.options || []).slice(0, 1); if (!values.length) { this.say(`  维度「${d.label}」商品未提供且无候选，跳过`); continue; } this.say(`  维度「${d.label}」商品未提供，用页面默认「${values[0]}」补一个`); }
      // 每个维度按它的输入框类型处理：请选择尺码 → 尺码弹层；请输入 → 自由填写；其余 → 选色
      const uiKind = await this.page.evaluate((pid) => { const e = Array.from(document.querySelectorAll(`#struct-${pid} li input`)).find(x => x.offsetParent !== null); return e ? (/请选择尺码/.test(e.placeholder) ? 'size' : /请输入/.test(e.placeholder) ? 'text' : 'color') : 'color'; }, d.name);
      this.say(`  维度「${d.label}」控件: ${uiKind}，值 ${values.join('/')}`);
      if (uiKind === 'text') {
        // 自由填写的规格值（适用床尺寸）：逐行输入，回车/Tab 提交；行数不够先加行
        for (let i = 0; i < values.length; i++) {
          for (let k = 0; k < 2; k++) { if ((await this.page.evaluate((pid) => Array.from(document.querySelectorAll(`#struct-${pid} li input`)).filter(e => e.offsetParent !== null && /请输入/.test(e.placeholder)).length, d.name)) > i) break; await this.addColorRow(d.name); }
          await this.typeInto(`#struct-${d.name} input`, { ph: '请输入', nth: i }, values[i], 'Tab'); await sleep(800);
        }
        this.say(`  自由规格值回读: ${JSON.stringify(await this.page.evaluate((pid) => Array.from(document.querySelectorAll(`#struct-${pid} li input`)).filter(e => e.offsetParent !== null && e.value).map(e => e.value), d.name))}`);
        // 这种输入框带联想列表，填完还开着（实测「0.6m床/0.9m床/…」）：不收掉的话下一点的点击只会把它关掉，等于白点。
        // 先在区块标题上点一下把它收掉（点击落在标题上无副作用），仍在再按 Esc
        await this.click(`#struct-${d.name} .props-label`, null, '收起联想列表'); await sleep(600);
        if (await this.page.evaluate(() => Array.from(document.querySelectorAll('.next-overlay-wrapper.opened .options-item')).some(e => e.offsetParent !== null))) await this.esc();
        await sleep(500);
        continue;
      }
      if (uiKind === 'size') { this.say(`  (选尺码前) 颜色行: ${JSON.stringify(await this.colorRows())}`); const okS = await this.selectSizes(null, values, d.name); if (!okS) { this.say(`  [miss] 维度「${d.label}」尺码没选上: ${values.join('/')}`); this._specMiss = true; } this.say(`  (选尺码后) 颜色行: ${JSON.stringify(await this.colorRows())}`); continue; }
      // 颜色类（newColorSelect）：主色 + 备注。点成功不算数——加行后第二次开浮层不稳定（实测把黑色选成了浅灰色），回读主色值核对，不对重来
      this._drawerColor = false;
      for (let i = 0; i < values.length; i++) {
        // 行不够就补：上一步失败后的收尾动作可能把空的颜色行删掉了（实测），不补的话后面每个值都「找不到主色输入框」
        for (let k = 0; k < 2; k++) { if ((await this.page.evaluate((pid) => Array.from(document.querySelectorAll(`#struct-${pid} input[placeholder="主色(必选)"]`)).filter(e => e.offsetParent !== null).length, d.name)) > i) break; this.say(`  颜色第 ${i + 1} 行不在了，补一行`); await this.addColorRow(d.name); }
        const hit = await this.pickColor(values[i], i);
        // 备注一律填商品里的颜色名：页面显示的是「主色(备注)」，备注为空时会显示成「白色(白色)」。主色值的回读核对在 selectColor 里做
        await this.selectColor(i, hit.group, hit.color, values[i], d.name); await sleep(800);
      }
    }
    return { ok: true };
  }
  // 抽屉「选择标准属性构建规格」二维：勾上商品用到的维度 → 每个维度逐个选值 → 核对各维度计数 → 确认创建
  async fillSpecsDrawerStandard(given) {
    const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();
    const propItems = () => this.page.evaluate(() => Array.from(document.querySelectorAll('.sku-decouple-drawer .prop-item')).filter(e => e.offsetParent !== null).map(e => { const r = e.getBoundingClientRect(); return { label: e.innerText.replace(/\s+/g, ' ').trim(), selected: /selected/.test(e.className), x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
    const match = (name, label) => { const a = norm(name), b = norm(label); return b.includes(a) || a.includes(b); };
    // 有的类目抽屉一打开就是标准属性模式（有维度可选），只有在没有维度项时才去点单选
    if (!(await propItems()).length) { await this.click('.sku-decouple-drawer .next-radio-wrapper', { text: '选择标准属性构建规格' }, '标准属性模式'); await sleep(1800); }
    // 只勾商品用到的维度（默认可能全勾或只勾一个）
    for (const p of await propItems()) { const want = given.some(g => match(g.name, p.label)); if (want !== p.selected) { await this.page.mouse.click(p.x, p.y); await sleep(1200); } }
    // 维度标题 → 值面板容器 id（标题行形如「颜色分类(0)」，面板 id=struct-p-xxx）
    const panels = await this.page.evaluate(() => Array.from(document.querySelectorAll('.sku-decouple-drawer [id^="struct-p-"]')).filter(e => e.offsetParent !== null && /^struct-p-\d+$/.test(e.id)).map(e => ({ pid: e.id.replace(/^struct-/, ''), head: (e.innerText || '').split('\n')[0].replace(/[\(（]\d+[\)）]/g, '').trim(), isColor: !!e.querySelector('input[placeholder="主色(必选)"]') })));
    // 抽屉里输入框不在带维度 id 的标题块内：颜色行按占位符在整个抽屉里找；非颜色维度（只读「请选择」）按出现顺序对应
    this.say(`  抽屉维度: ${panels.map(p => `${p.head}${p.isColor ? '(颜色)' : ''}`).join('，')}｜抽屉文本: ${(await this.page.evaluate(() => ((document.querySelector('.sku-decouple-drawer') || {}).innerText || '').replace(/\s+/g, ' ').slice(-160)))}`);
    let ok = true;
    for (let di = 0; di < given.length; di++) {
      const g = given[di];
      const p = panels.find(x => match(g.name, x.head));
      if (!p) { this.say(`  [miss] 抽屉里没有维度「${g.name}」`); ok = false; continue; }
      for (let i = 0; i < g.values.length; i++) {
        // 每个维度：先选第 1 个值，之后每个值都先点「该维度自己的」加号再加一行（加号按维度顺序排）
        if (i > 0 && !await this.click('.sku-decouple-drawer button.add', { nth: di }, `「${g.name}」加行`)) { this.say(`  [miss] 「${g.name}」没有加号，第 ${i + 1} 个值没处填`); ok = false; break; }
        await sleep(1500);
        if (p.isColor) {
          this._drawerColor = true;
          const hit = await this.pickColor(g.values[i], i);
          await this.selectColor(i, hit.group, hit.color, g.values[i], p.pid); await sleep(1500);
          this._drawerColor = false;
        } else {
          // 非颜色维度两种控件：只读「请选择」下拉（选完占位符消失）或可打字的自动补全「请输入」。
          // 统一取该维度下「还没填的」输入框：值为空且有占位符。新加的行不一定排在最后（实测手机型号新行在前），不能按「最后一个」取
          const SEL = `.sku-decouple-drawer #struct-${p.pid} input:not([type="checkbox"]):not([type="radio"])`;
          const nth = await this.page.evaluate((SEL) => { const all = Array.from(document.querySelectorAll(SEL)).filter(e => e.offsetParent !== null); return all.findIndex(e => e.value === '' && !!e.placeholder); }, SEL);          if (nth < 0) { this.say(`  [miss] 「${g.name}」没有空着的输入框可填「${g.values[i]}」`); ok = false; continue; }
          if (!await this.selectAttr(p.pid, g.values[i], { keyword: g.values[i], selector: SEL, nth })) { this.say(`  [miss] 「${g.name}」选不到「${g.values[i]}」`); ok = false; }
        }
      }
    }
    // 核对：每个维度的计数应等于商品给的值个数（标题形如「颜色分类(0)」，直接从抽屉文本里读）
    const counts = await this.page.evaluate(() => { const txt = (document.querySelector('.sku-decouple-drawer') || {}).innerText || ''; const out = []; const re = /([^\s\n]+?)\((\d+)\)/g; let m; while ((m = re.exec(txt))) out.push(m[1] + '(' + m[2] + ')'); return out; });
    this.say(`  维度计数: ${counts.join('，')}`);
    // 计数只是行数，行里可能有空值（页面会报「所填的值不能为空」且不生成 SKU）。
    // 值存放位置因控件而异：颜色在主色输入框、下拉型（铰链类型）在抽屉文字里、自动补全型（手机型号）在自己的输入框里 → 三处都认
    const chk = await this.page.evaluate(() => { const d = document.querySelector('.sku-decouple-drawer'); return { mainVals: Array.from(d.querySelectorAll('input[placeholder="主色(必选)"]')).filter(e => e.offsetParent !== null).map(e => e.value), inputVals: Array.from(d.querySelectorAll('input:not([type="checkbox"]):not([type="radio"])')).filter(e => e.offsetParent !== null && e.value).map(e => e.value), text: d.innerText.replace(/\s+/g, '') }; });
    this.say(`  抽屉主色各行: ${chk.mainVals.join('，')}｜其它输入框值: ${chk.inputVals.join('，')}`);
    const flat = (s) => String(s).replace(/\s+/g, '');
    const allVals = chk.mainVals.concat(chk.inputVals).map(flat);
    for (const g of given) { const c = counts.find(x => match(g.name, x)); const n = c ? parseInt((c.match(/[\(（](\d+)[\)）]/) || [])[1], 10) : NaN; if (n !== g.values.length) { this.say(`  [miss] 「${g.name}」计数 ${n} ≠ ${g.values.length}`); ok = false; }
      // 每个给的值都要真的在抽屉里（颜色看输入框值，其余看抽屉文字）。页面显示可能带补充说明（尺码「L（45-47）」）→ 认「包含」
      for (const v of g.values) { const fv = flat(v); if (!allVals.some(a => a.includes(fv)) && !chk.text.includes(fv)) { this.say(`  [miss] 抽屉里没有「${g.name}=${v}」这个值`); ok = false; } } }
    if (chk.mainVals.some(m => !m)) { this.say('  [miss] 抽屉里有没选主色的颜色行'); ok = false; }
    if (!ok) { this.say('  二维规格有缺口，不点「确认创建」'); await this.click('.sku-decouple-drawer button', { text: '取消' }, '取消'); return { ok: false }; }
    await this.click('.sku-decouple-drawer button', { text: '确认创建' }, '确认创建'); await sleep(4000);
    return { ok: true };
  }
  // 预置行里各颜色行的值（排查用）
  colorRows() { return this.page.evaluate(() => Array.from(document.querySelectorAll('#struct-saleProp li.sell-component-common-sale-props-option-item')).filter(li => li.offsetParent !== null).map(li => (li.querySelector('input[placeholder="主色(必选)"]') || {}).value + '/' + (li.querySelector('input[placeholder="备注(可选)"]') || {}).value)); }
  // 选色控件的作用域：页面预置行 / 抽屉标准模式（容器不同，控件同款）
  colorScope(pid) { return this._drawerColor ? `.sku-decouple-drawer` : `#struct-saleProp li.sell-component-common-sale-props-option-item`; }
  // 颜色名 → (色系, 具体色)：逐个色系里找完全同名
  async pickColor(name, nth = 0) {
    const scope = this.colorScope();
    const rowOpt = { ph: '主色(必选)', nth };
    const groupsOf = () => this.page.evaluate(() => Array.from(document.querySelectorAll('.next-overlay-wrapper.opened .color-group-panel li.color-tag')).filter(e => e.offsetParent !== null).map(e => e.innerText.trim()));
    // 新增一行后立刻点常常打不开浮层（实测第二行）→ 最多试 4 次，等色列表真的出来
    let groups = [];
    for (let i = 0; i < 4 && !groups.length; i++) {
      if (!await this.click(`${scope} input`, rowOpt, '主色(必选)')) { await sleep(1200); continue; }
      await this.waitOverlay(`${scope} input`, rowOpt);
      await this.waitOverlayStable();
      groups = await groupsOf();
      if (!groups.length) { await sleep(1500); groups = await groupsOf(); }
    }
    if (!groups.length) { this.say('  [miss] 选色浮层没打开'); await this.esc(); return { group: null, color: null, remark: name }; }
    let found = null; const all = [];
    // 先找完全同名；都找完没有，再按「商品色名去掉『色』字后被标准色名包含」近似匹配（粉色→粉红色）。不能反过来包含，否则黑色会配成浅灰色
    for (const g of groups) {
      await this.click('.next-overlay-wrapper.opened .color-group-panel li.color-tag', { text: g }, `色系「${g}」`); await sleep(900);
      const colors = await this.page.evaluate(() => Array.from(document.querySelectorAll('.next-overlay-wrapper.opened .colors-panel li.color-tag')).filter(e => e.offsetParent !== null).map(e => e.innerText.trim()));
      for (const c of colors) all.push({ group: g, color: c });
      this.say(`  色系「${g}」具体色 ${colors.length} 个${colors.length ? '' : '（空）'}: ${colors.slice(0, 12).join('/')}`);
      const c = colors.find(x => x === name);
      if (c) { found = { group: g, color: c }; break; }
    }
    if (!found) {
      const key = String(name).replace(/色$/, '');
      if (key.length >= 1) { const near = all.filter(x => x.color.includes(key) && !/^深|^浅/.test(x.color)).sort((a, b) => a.color.length - b.color.length)[0] || all.filter(x => x.color.includes(key)).sort((a, b) => a.color.length - b.color.length)[0]; if (near) { found = near; this.say(`  「${name}」不是标准色名，按近似匹配用「${near.color}」（${near.group}）`); } }
    }
    if (!found) { await this.closeColorPopup(); this.say(`  [miss] 标准色里没有「${name}」`); return { group: null, color: null, remark: name }; }
    // 浮层保持打开，由 selectColor 接着用
    return found;
  }

  // SKU 表每行的规格值（按页面维度顺序取单元格 title）
  async readSkuRows() {
    const rows = await this.page.evaluate(() => Array.from(document.querySelectorAll('#struct-sku tr.sku-table-row')).filter(e => e.offsetParent !== null).map(tr => Array.from(tr.querySelectorAll('td[id*="-p-"]')).filter(td => /^[\w-]+-p-\d+$/.test(td.id)).map(td => (td.getAttribute('title') || td.innerText || '').trim())));
    // 行里读不到规格值 → 用创建时记下的顺序（一维）
    return rows.map((r, i) => (r.length ? r : (this.specOrder && this.specOrder[i]) || []));
  }
  // 表行 → 商品 SKU（按规格值对齐，不依赖行序）。页面规格名形如「黑色(黑色)」「浅灰色(黑色)」：括号外是页面主色、括号里是备注（=商品颜色名）。
  // 两个都认——主色万一选偏了，还能靠备注对上商品 SKU。
  async mapSkuRows(P, rows) {
    const norm = s => String(s || '').replace(/\s+/g, '').toLowerCase();
    // 完整值必须先比：规格值自己也可能带括号（如「全盖（直臂、直弯）」），不能只比拆开的两段
    const aliases = v => { const s = String(v || ''); const m = s.match(/^([\s\S]*?)[\(（]([\s\S]*?)[\)）]$/); return [norm(s), ...(m ? [norm(m[1]), norm(m[2])] : [])]; };
    return rows.map(r => ({ row: r, sku: (P.skus || []).find(s => { const vals = Object.values(s.specs || {}).map(norm); return vals.length === r.length && r.every(v => aliases(v).some(a => vals.includes(a))); }) || null }));
  }
  // 没对上商品 SKU 的表行要点名报出来——静默跳过会让整张 SKU 表空着（实测）

  // SKU 表的附加列（照 Accio：页面数据里 required 的 skuParam_* 列当作 SKU 填写列，候选从页面读）。
  // 值的来源：P.skuParams[列名]（所有行一样）> P.skus[i].params[列名]（按行）> 不给就不填，必填列取第一个候选并在日志里标明。
  // rows = readSkuRows() 的结果；返回 { filled:[], missed:[] }
  async fillSkuParams(P, rows) {
    const cols = await this.page.evaluate(() => { const a = ((window.Json.components.sku || {}).props || {}).attributes || {}; return Object.keys(a).filter(k => /^skuParam_/.test(k)).map(k => ({ key: k, label: a[k].label, ui: a[k].uiType, required: !!a[k].required, enum: (a[k].dataSource || []).map(x => x && (x.text ?? x.value)).filter(x => x != null) })); });
    const out = { filled: [], missed: [] };
    for (const c of cols) {
      const perRow = rows.map((r, i) => { const g = (P.skuParams || {})[c.label]; const s = (P.sku || P.skus || [])[i]; return g != null ? g : (s && s.params && s.params[c.label] != null ? s.params[c.label] : null); });
      if (perRow.every(v => v == null)) { if (c.required) perRow.forEach((v, i) => { perRow[i] = c.enum[0]; }); else continue; }
      for (let i = 0; i < rows.length; i++) {
        const v = perRow[i]; if (v == null) continue;
        const td = `#struct-sku td[id="${i}-${c.key}"]`;
        const has = await this.page.$(td); if (!has) { out.missed.push(`${c.label}（第 ${i + 1} 行没有这一列）`); continue; }
        if (c.ui === 'skuMeasurement') {
          // 测量格：点格子弹出编辑浮层，真正的数字框在浮层里（placeholder=请输入数量），单位已默认；键入后回车提交（实测双数）
          const inpSel = `${td} input`;
          const box = await this.page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, inpSel);
          if (!box) { out.missed.push(`${c.label}（第 ${i + 1} 行没找到数字框）`); continue; }
          await sleep(500); await this.page.mouse.click(box.x, box.y); await sleep(1200);
          // 最后一行实测偶发点不开浮层：换两种触发方式重试（wrapper 派发鼠标事件 / 遮罩派发）
          const popFind = () => this.page.evaluate(() => { const o = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')).find(e => e.offsetParent !== null); if (!o) return null; const e = o.querySelector('input[placeholder*="数量"], input[placeholder*="规格"], input[type=text]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
          let pop = await popFind();
          for (let attempt = 0; !pop && attempt < 3; attempt++) {
            await this.esc(); await sleep(500);
            await this.page.evaluate((td, t) => { const cell = document.querySelector(td); const el = cell && cell.querySelector(t === 0 ? '.fake-input-wrapper' : '.overlay'); if (!el) return; const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; for (const type of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy })); }, td, attempt);
            await sleep(1400);
            pop = await popFind();
            if (!pop && attempt === 1) { const b2 = await this.page.evaluate((s) => { const e = document.querySelector(s); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, inpSel); await sleep(600); await this.page.mouse.click(b2.x, b2.y); await sleep(1400); pop = await popFind(); }
          }
          if (!pop) { await this.esc(); out.missed.push(`${c.label}（第 ${i + 1} 行浮层弹不出来）`); continue; }
          // 键入后提交不稳定（实测回车只提交一部分行）：回车 → 点遮罩 → Tab 逐个试，直到浮层关闭且格子带上了值
          const cellText = () => this.page.evaluate((s) => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim().slice(0, 30) : null; }, td);
          let cell = null;
          for (let attempt = 0; attempt < 2 && !(cell && cell.includes(String(v))); attempt++) {
            if (attempt === 1) { await this.esc(); await sleep(600); const b2 = await this.page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, inpSel); if (!b2) break; await this.page.mouse.click(b2.x, b2.y); await sleep(1200); pop = await popFind(); if (!pop) break; }
            await this.page.mouse.click(pop.x, pop.y); await sleep(600);
            await this.page.keyboard.down('Control'); await this.page.keyboard.press('a'); await this.page.keyboard.up('Control'); await sleep(200);
            await this.page.keyboard.type(String(v), { delay: 80 });
            for (const commit of ['Enter', 'mask', 'Tab']) {
              if (commit === 'Enter') { await this.page.keyboard.press('Enter'); await sleep(700); }
              else if (commit === 'mask') { const m = await this.page.evaluate(() => { const o = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')).find(e => e.offsetParent !== null); if (!o) return null; const e = o.querySelector('.mask'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }); if (m) { await this.page.mouse.click(m.x, m.y); await sleep(700); } }
              else { await this.page.keyboard.press('Tab'); await sleep(700); }
              const stillOpen = await this.page.evaluate(() => !!Array.from(document.querySelectorAll('.next-overlay-wrapper.opened')).find(e => e.offsetParent !== null && e.querySelector('input[placeholder*="数量"]')));
              cell = await cellText();
              if (!stillOpen && cell && cell.includes(String(v))) break;
              if (!stillOpen && cell && cell.includes(String(v))) break;
              if (stillOpen) continue;
              // 浮层关了但格子没带上值：重开浮层再试
              const b3 = await this.page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, inpSel);
              if (!b3) break;
              await this.page.mouse.click(b3.x, b3.y); await sleep(1200);
              pop = await popFind(); if (!pop) break;
              await this.page.mouse.click(pop.x, pop.y); await sleep(500);
              await this.page.keyboard.down('Control'); await this.page.keyboard.press('a'); await this.page.keyboard.up('Control'); await sleep(200);
              await this.page.keyboard.type(String(v), { delay: 80 });
            }
          }
          cell = await cellText();
          const good = cell != null && cell.replace(/\s+/g, '').includes(String(v).replace(/\s+/g, ''));
          if (!good) await this.esc();
          (good ? out.filled : out.missed).push(good ? `${c.label}=${v}` : `${c.label}=「${v}」第 ${i + 1} 行提交后格子=「${cell}」`);
          continue;
        }
        if (c.ui === 'combobox') {
          // combobox 型（输入框可打字）：往格子输入框打关键词 → 等浮层 → 按坐标点中目标项；先滚动进视口
          const sel = `${td} input[role="combobox"]`;
          const box = await this.page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
          if (!box) { out.missed.push(`${c.label}（第 ${i + 1} 行没找到输入框）`); continue; }
          await sleep(600); await this.page.mouse.click(box.x, box.y); await sleep(1000);
          await this.page.evaluate((s, val) => { const e = document.querySelector(s); if (!e) return; e.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, val); e.dispatchEvent(new Event('input', { bubbles: true })); }, sel, String(v));
          await sleep(1500);
          const items = () => this.page.evaluate(() => Array.from(document.querySelectorAll('.next-overlay-wrapper.opened .options-item, .next-overlay-wrapper.opened .next-menu-item, .next-overlay-wrapper.opened li')).filter(e => e.offsetParent !== null).map(e => ({ t: (e.getAttribute('title') || e.innerText || '').replace(/\s+/g, ' ').trim(), r: (() => { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })() })).filter(x => x.t && x.t.length < 24));
          const nrm = s => String(s).replace(/\s+/g, '');
          const list = await items(); const hit = list.find(x => nrm(x.t) === nrm(v));
          let good = false;
          if (hit) { await this.page.mouse.click(hit.r.x, hit.r.y); await sleep(1200); } else { this.say(`    [${c.label} 第 ${i + 1} 行] 浮层里没有「${v}」，候选如 ${list.slice(0, 8).map(x => x.t).join('/')}`); await this.esc(); await sleep(600); }
          const got = await this.page.evaluate((td) => { const i = document.querySelector(`${td} input[role="combobox"]`); return i ? i.value : (document.querySelector(td) || {}).innerText || null; }, td);
          good = got != null && nrm(got).includes(nrm(v));
          if (!good) await this.esc();
          (good ? out.filled : out.missed).push(good ? `${c.label}=${v}${perRow.every(x => x === perRow[0]) ? '' : `（第 ${i + 1} 行）`}` : `${c.label}=「${v}」第 ${i + 1} 行没选上`);
          continue;
        }
        {
          // 只读下拉型（skuAsyncSelect / select）：走 selectAttr（关键词打在浮层搜索框里才生效，实测裤型）；失败重试 + 自兜底
          const sel = `${td} input[role="combobox"]`;
          const nrm = s => String(s || '').replace(/\s+/g, '');
          let ok = false;
          for (let attempt = 0; attempt < 2 && !ok; attempt++) { if (attempt) { await this.esc(); await sleep(1200); } ok = await this.selectAttr('sku', String(v), { selector: sel, nth: 0 }); }
          if (!ok) {
            // 自兜底：点开浮层 → 搜索框设关键词 → 按坐标点中目标项（selectAttr 打不开浮层时用，实测裤型偶发）
            this.say(`    [${c.label} 第 ${i + 1} 行] selectAttr 未选上，走自兜底`);
            await this.esc(); await sleep(500);
            const box = await this.page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
            if (box) {
              await sleep(500); await this.page.mouse.click(box.x, box.y); await sleep(1800);
              const hasItems = await this.page.evaluate(() => !!document.querySelector('.next-overlay-wrapper.opened .options-item'));
              if (hasItems) {
                await this.page.evaluate((k) => { const e = document.querySelector('.next-overlay-wrapper.opened .options-search input'); if (!e) return; e.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, k); e.dispatchEvent(new Event('input', { bubbles: true })); }, String(v));
                await sleep(1500);
                const hit = await this.page.evaluate((t) => { const n = t.replace(/\s+/g, ''); const e = Array.from(document.querySelectorAll('.next-overlay-wrapper.opened .options-item')).find(x => x.offsetParent !== null && (x.getAttribute('title') || '').replace(/\s+/g, '') === n); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, String(v));
                if (hit) { await this.page.mouse.click(hit.x, hit.y); await sleep(1200); } else { this.say(`    [${c.label} 第 ${i + 1} 行] 兜底浮层里没有「${v}」`); await this.esc(); }
              } else await this.esc();
            } else await this.esc();
          }
          const got = await this.page.evaluate((td) => { const i = document.querySelector(`${td} input[role="combobox"]`); const t = document.querySelector(td); return i ? (i.value || t.innerText) : (t ? t.innerText.replace(/\s+/g, ' ').trim().slice(0, 40) : null); }, td);
          const good = got != null && nrm(got).includes(nrm(v));
          (good ? out.filled : out.missed).push(good ? `${c.label}=${v}${perRow.every(x => x === perRow[0]) ? '' : `（第 ${i + 1} 行）`}` : `${c.label}=「${v}」第 ${i + 1} 行没选上`);
        }
      }
    }
    this.say(`  SKU 附加列: 已填 ${out.filled.join('；') || '无'}｜未填: ${out.missed.join('；') || '无'}`);
    return out;
  }
  // 商品尺寸表（sizeMappingV4，照 Accio 模型：列定义 + 每个尺码一行）。values = { 尺码: [列1值, 列2值, ...] }，按行内「区间值」输入框顺序填。
  async fillSizeTable(values) {
    const info = await this.page.evaluate(() => { const root = document.querySelector('#struct-sizeMapping'); if (!root || root.offsetParent === null) return { hidden: true };
      return { rows: Array.from(root.querySelectorAll('tr')).filter(r => r.offsetParent !== null).map(r => ({ size: (r.innerText.match(/^\s*([^\s|]+?)(?:\s*清空)?$/) || [])[1] || r.innerText.replace(/\s+/g, ' ').trim().slice(0, 10), inputs: Array.from(r.querySelectorAll('input')).filter(i => i.offsetParent !== null && i.type === 'text').map(i => { const b = i.getBoundingClientRect(); return { ph: i.placeholder || '', x: b.left + b.width / 2, y: b.top + b.height / 2 }; }) })) }; });
    if (info.hidden) { this.say('  [miss] 尺码表区块不可见'); return false; }
    const rows = info.rows.filter(r => values[r.size] || values[String(r.size).trim()]);
    if (!rows.length) { this.say(`  [miss] 尺码表行 ${info.rows.map(r => r.size).join('/')} 与商品尺寸 ${Object.keys(values).join('/')} 对不上`); return false; }
    let okAll = true;
    for (const r of rows) { const vals = values[r.size] || values[String(r.size).trim()];
      const cells = r.inputs.filter(i => /区间值|请输入/.test(i.ph) || i.ph === '');
      for (let j = 0; j < Math.min(vals.length, cells.length); j++) {
        // 点击前把格子滚进视口并取最新坐标（实测表格在视口下方时旧坐标点击落空）
        const box = await this.page.evaluate((size, j2) => { const root = document.querySelector('#struct-sizeMapping'); const row = Array.from(root.querySelectorAll('tr')).find(x => x.offsetParent !== null && x.innerText.replace(/\s+/g, ' ').trim().startsWith(size)); if (!row) return null; const ins = Array.from(row.querySelectorAll('input')).filter(i => i.offsetParent !== null && i.type === 'text'); const e = ins[j2]; if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, r.size, j);
        if (!box) break; await sleep(600); await this.page.mouse.click(box.x, box.y); await sleep(500); await this.page.keyboard.type(String(vals[j]), { delay: 60 }); await this.page.keyboard.press('Tab'); await sleep(400);
      }
      const back = await this.page.evaluate((size) => { const root = document.querySelector('#struct-sizeMapping'); const r = Array.from(root.querySelectorAll('tr')).find(x => x.offsetParent !== null && x.innerText.replace(/\s+/g, ' ').trim().startsWith(size)); return r ? Array.from(r.querySelectorAll('input')).filter(i => i.offsetParent !== null).map(i => i.value).join('|') : null; }, r.size);
      const good = back != null && String(vals.join('|')).replace(/\s+/g, '') === String(back).replace(/\s+/g, '');
      this.say(`  尺码 ${r.size}: ${good ? '已填 ✓ ' + back : '没填上 ✗ ' + back}`); if (!good) okAll = false; }
    return okAll;
  }

  // 多件优惠（照 Accio：填「折扣类型 + 折扣值」= 启用）。只点「启用」，档位和折扣用页面默认（满2件打折 9.5 折）。
  async enableMultiDiscount() {
    const s = '#struct-multiDiscountPromotion'; if (!await this.page.$(s)) return null;
    const st = async () => this.page.evaluate(() => { const c = window.Json.components.multiDiscountPromotion; return c ? JSON.stringify(c.props.value) : null; });
    const before = await st();
    if (!/"enable"\s*:\s*true/.test(before || '')) { await this.clickText(s, '启用', '多件优惠 启用'); await sleep(1500); }
    const after = await st(); this.say(`  多件优惠: ${before} → ${after}`); return { before, after };
  }

  // ── 提交前准备（主图 / 提取方式 / 上架时间）。本段不含「点提交」。 ──────────────────────────────
  // 在容器里找「自身文字恰好等于 text」的最深层可见元素，返回其中心坐标；找不到返回 null
  async textPoint(containerSel, text) {
    return this.page.evaluate((containerSel, text) => {
      const norm = s => (s || '').replace(/\s+/g, '').trim(); const root = document.querySelector(containerSel); if (!root) return null;
      const all = Array.from(root.querySelectorAll('*')).filter(e => e.offsetParent !== null && norm(e.innerText) === norm(text));
      if (!all.length) return null;
      const leaf = all.find(e => !all.some(o => o !== e && e.contains(o))) || all[all.length - 1];
      const r = leaf.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: leaf.tagName };
    }, containerSel, text);
  }
  async clickText(containerSel, text, label) {
    await this.page.evaluate((s) => { const e = document.querySelector(s); if (e) e.scrollIntoView({ behavior: 'instant', block: 'center' }); }, containerSel);
    await sleep(500);
    const p = await this.textPoint(containerSel, text);
    if (!p) { this.say(`  [miss] ${label || text}（${containerSel} 里没找到文字「${text}」）`); return false; }
    await this.page.mouse.click(p.x, p.y); await sleep(900); return true;
  }
  // JS 直接触发的文字点击：不经过坐标（坐标点击会被「测量→点击」间隙里的页面重渲染甩开，实测提速下提交按钮偶发点不中）。对 React 组件按完整事件序列派发。
  async jsClickText(containerSel, text, label) {
    const ok = await this.page.evaluate((containerSel, text) => {
      const norm = s => (s || '').replace(/\s+/g, '').trim(); const root = document.querySelector(containerSel); if (!root) return false;
      const all = Array.from(root.querySelectorAll('*')).filter(e => e.offsetParent !== null && norm(e.innerText) === norm(text));
      if (!all.length) return false;
      const leaf = all.find(e => !all.some(o => o !== e && e.contains(o))) || all[all.length - 1];
      const target = leaf.closest('button, [role=button], a, label') || leaf;
      target.scrollIntoView({ behavior: 'instant', block: 'center' });
      const r = target.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) { const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent; target.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 })); }
      return true;
    }, containerSel, text);
    if (!ok) { this.say(`  [miss] ${label || text}（jsClick 找不到文字）`); return false; }
    await sleep(900); return true;
  }
  // 单选项状态：容器里每个选项的文字 + 是否选中。★ 文字取 .item-label / 外层 label（内层 next-radio-wrapper 自己也是 label 但没文字，实测 startTime 的内外双层结构曾导致按文字/下标双双错位）
  async radioStates(containerSel) {
    return this.page.evaluate((s) => { const root = document.querySelector(s); if (!root) return []; return Array.from(root.querySelectorAll('input[type=radio],input[type=checkbox]')).filter(e => e.offsetParent !== null || e.getClientRects().length).map(e => { const item = e.closest('.radio-item') || e.closest('label') || e.parentElement; const lbl = item.querySelector('.item-label') || item; return { type: e.type, text: (lbl.innerText || '').replace(/\s+/g, ' ').trim(), checked: e.checked }; }); }, containerSel);
  }
  // 单选项：按文字点击并核对。idx 给了就按「第几项被选中」核对（有的单选项 label 没文字，读不出哪项是哪项）
  async chooseOption(containerSel, text, idx) {
    const states = async () => { const s = await this.radioStates(containerSel); return idx == null ? s.map(x => x.checked && x.text) : s.map((x, i) => (x.checked ? i : -1)).filter(i => i >= 0); };
    if (idx != null) { const cur = await states(); if (cur.includes(idx)) { this.say(`  「${text}」已是选中状态（第 ${idx + 1} 项）`); return true; } }
    else { const cur = await states(); if (cur.includes(text)) { this.say(`  「${text}」已是选中状态`); return true; } }
    const ok = await this.clickText(containerSel, text, `选项「${text}」`); if (!ok) return false;
    await sleep(300); const cur = await states();
    // 文字能对上就以文字为准（下标在内外双层 label 结构下会错位，实测 startTime）
    const byText = cur.find(x => x.checked && x.text && x.text.replace(/\s+/g, '').includes(String(text).replace(/\s+/g, '')));
    const good = byText ? true : (idx != null ? cur.includes(idx) : cur.includes(text));
    this.say(`  选项「${text}」${good ? '已选中 ✓' : '没选中 ✗ ' + JSON.stringify(await this.radioStates(containerSel))}`); return good;
  }
  // 主图：页面平时没有文件框，点「上传图片」才弹系统选图。用无界面浏览器的文件选择拦截把本地文件送进去。
  async uploadMainImages(files) {
    const scope = '#struct-mainImagesGroup';
    const done = async () => this.page.evaluate((s) => { const root = document.querySelector(s); if (!root) return []; return Array.from(root.querySelectorAll('img')).map(i => i.src).filter(u => /alicdn|taobaocdn/.test(u)); }, scope);
    for (let i = 0; i < files.length; i++) {
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          const waiter = this.page.waitForFileChooser({ timeout: 15000 });
          const clicked = await this.clickText(scope, '上传图片', '上传图片');
          if (!clicked) break;
          const chooser = await waiter; await chooser.accept([files[i]]); ok = true;
        } catch (e) {
          // 没弹出系统选图：有的版本是往页面里塞一个 input[type=file]
          const inp = await this.page.$(`${scope} input[type=file]`);
          if (inp) { await inp.uploadFile(files[i]); ok = true; } else this.say(`  主图第 ${i + 1} 张：没等到选图弹窗（${String(e.message).slice(0, 80)}）`);
        }
      }
      if (!ok) break;
      const dl = Date.now() + 90000; let n = 0;
      while (Date.now() < dl) { n = (await done()).length; if (n >= i + 1) break; await sleep(1000); }
      this.say(`  主图第 ${i + 1} 张${(await done()).length >= i + 1 ? '上传完成' : '等待超时'}（当前 ${n} 张）`);
    }
    const srcs = await done(); this.say(`  主图回读: ${srcs.length} 张 ${srcs.map(u => u.slice(-40)).join(' | ')}`);
    return srcs;
  }
  // 提交前准备：主图、提取方式、运费模板、上架时间。opts: { images, startTime, freight }。本段不含「点提交」。
  async prepareSubmit(opts) {
    const o = Object.assign({ startTime: '放入仓库', freight: '系统模板-商家默认模板' }, opts || {}); const rep = {};
    // 显式传 undefined 会覆盖上面的默认值（Object.assign 对存在的键一律覆盖，实测 startTime）
    if (o.startTime == null) o.startTime = '放入仓库';
    this.step('主图');
    if (o.images && o.images.length) { const r = await this.uploadMainImagesViaSpace(o.images, o.imageKey); rep.images = r.srcs; rep.imageKey = r.key; }
    else rep.images = await this.page.evaluate(() => Array.from(document.querySelectorAll('#struct-mainImagesGroup img')).map(i => i.src).filter(u => /alicdn|taobaocdn/.test(u)));
    this.step('提取方式 / 运费模板');
    const ext = '#struct-tbExtractWay';
    const st = await this.radioStates(ext);
    if (!st.find(x => /物流配送/.test(x.text) && x.checked)) { await this.clickText(ext, '使用物流配送', '使用物流配送'); await sleep(2000); }
    rep.extract = await this.radioStates(ext);
    rep.freight = await this.chooseFreight(o.freight);
    this.step('上架时间');
    const startLabels = await this.page.evaluate(() => Array.from(document.querySelectorAll('#struct-startTime label, #struct-startTime .next-radio-wrapper')).map(e => e.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean));
    rep.startTimeOk = await this.chooseOption('#struct-startTime', o.startTime, Math.max(0, startLabels.indexOf(o.startTime)));
    rep.startTime = await this.radioStates('#struct-startTime');
    if (o.startTime === '定时上架') rep.scheduled = await this.setScheduledStart(o.scheduledAt || '');
    return rep;
  }
  // 定时上架：选「定时上架」后，日期框是 readonly 日期选择器 → 点开面板点明天的日历格 → 确定。at 形如 '2026-11-28'；空则取明天。
  async setScheduledStart(at) {
    await sleep(1500);
    const d = at ? new Date(at.replace(/-/g, '/')) : new Date(Date.now() + 86400000);
    const p = n => String(n).padStart(2, '0'); const ymd = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const box = await this.page.evaluate(() => { const e = document.querySelector('#struct-startTime input[role=combobox]'); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    if (!box) { this.say('  [miss] 没找到日期选择框'); return { ok: false, at: ymd }; }
    await this.page.mouse.click(box.x, box.y); await sleep(1800);
    // 日历格里找目标日：优先 title=完整日期；格子里同号可能出两次（上月尾+本月），按 title 区分
    const cell = await this.page.evaluate((ymd2) => { const day = ymd2.slice(-2); const cand = Array.from(document.querySelectorAll('td[class*="calendar-cell"], .next-calendar-cell')).filter(e => e.offsetParent !== null && !/disabled/.test(e.className)); const byTitle = cand.find(e => (e.getAttribute('title') || '').endsWith(ymd2)); const pick = byTitle || cand.find(e => (e.innerText || '').trim() === String(parseInt(day, 10))); if (!pick) return null; const r = pick.getBoundingClientRect(); return { title: pick.getAttribute('title') || '', x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, ymd);
    if (!cell) { await this.esc(); this.say('  [miss] 日历格里没有 ' + ymd); return { ok: false, at: ymd }; }
    this.say(`  日历格: ${cell.title || cell.x + ',' + cell.y}`); await this.page.mouse.click(cell.x, cell.y); await sleep(900);
    const okBtn = await this.page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).filter(e => e.offsetParent !== null && (e.innerText || '').trim() === '确定')[0]; if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    if (okBtn) { await this.page.mouse.click(okBtn.x, okBtn.y); await sleep(1200); }
    const back = await this.page.evaluate(() => { const e = document.querySelector('#struct-startTime input[role=combobox]'); return e ? e.value : null; });
    const ok = !!back && back.slice(0, 10).replace(/\//g, '-') === ymd;
    this.say(`  定时上架回读: 「${back}」 ${ok ? '✓' : '✗'}`);
    return { ok, at: ymd, back };
  }
  // 主图（正式引擎同链路）：先走图片空间上传接口拿 URL，再在选图窗口里按图名选中。每次打开窗口选 1 张（窗口 max=1）。
  // 上传是纯 HTTP（stream-upload.taobao.com，无签名），可并发（正式引擎 imageSpaceConcurrency 上限 6，这里取 3）；
  // 选图窗口是页面单例只能串行。reuseKey 仅在单文件时生效（多图各传各的，否则会把整批都跳过上传——实测踩过）。
  async uploadMainImagesViaSpace(files, reuseKey, concurrency = 3) {
    const ckReq = require('./img-space.cjs'); const path = require('path');
    const cookies = ckReq.cookieMap(await this.page.cookies());
    // ① 并发上传：没有现成 key 的文件一起传（每文件独立 key）
    const todo = files.map((file, i) => ({ file, i, key: files.length === 1 ? (reuseKey || null) : (this._imgKeys && this._imgKeys[path.basename(file)]) || null }));
    const need = todo.filter(x => !x.key);
    if (need.length) {
      const queue = [...need]; const results = [];
      const worker = async () => { while (queue.length) { const x = queue.shift(); const up = await ckReq.uploadToSpace(x.file, cookies); if (up.ok) { x.key = up.url.split('/').pop().split('.')[0].split('!!')[0]; this.say(`  ${path.basename(x.file)} → 图片空间 ${up.pix || ''}`); } else { x.error = up.error; this.say(`  ${path.basename(x.file)} 上传图片空间失败：${up.error}`); } results.push(x); } };
      await Promise.all(Array.from({ length: Math.min(concurrency, need.length) }, worker));
    }
    // ② 选图窗口串行逐张选中
    const out = []; let lastKey = null;
    for (const x of todo) {
      if (!x.key) break;
      const src = await this.pickMainImageByKey(x.key); if (!src) break;
      out.push(src); lastKey = x.key;
      if (this._imgKeys) this._imgKeys[path.basename(x.file)] = x.key;
    }
    this.say(`  主图回读: ${out.length} 张`); return { srcs: out, key: lastKey };
  }
  // 在选图窗口里选中图片空间中名字含 key 的图；返回主图区里的图地址
  async pickMainImageByKey(key) {
    const have = async () => this.page.evaluate(() => Array.from(document.querySelectorAll('#struct-mainImagesGroup img')).map(i => i.src).filter(u => /alicdn/.test(u)));
    let picked = null;
    for (let attempt = 0; attempt < 2 && !picked; attempt++) {
      await this.clickText('#struct-mainImagesGroup', '上传图片', '上传图片');
      const dl = Date.now() + 20000; let frame = null;
      while (Date.now() < dl && !frame) { frame = this.page.frames().find(f => /sucai-selector/.test(f.url())); if (!frame) await sleep(500); }
      if (!frame) { this.say('  选图窗口没打开'); continue; }
      await sleep(4000);
      const h = await frame.$(`img[src*="${key}"]`).catch(() => null);
      if (!h) { this.say(`  选图窗口里没找到图（${String(key).slice(-12)}）`); await this.esc(); continue; }
      await h.click().catch(() => {}); await sleep(2500);
      await this.confirmDialog(); await sleep(1500);
      const srcs = await have(); picked = srcs.find(s => s.includes(key)) || null;
      if (!picked) { this.say('  点了图但主图区没出现，重试一次'); await this.esc(); }
    }
    return picked;
  }
  // 运费模板下拉：选项文字精确匹配
  async chooseFreight(text) {
    const box = await this.page.$('#struct-tbExtractWay input[role=combobox]');
    if (!box) { this.say('  [miss] 没找到运费模板下拉框'); return null; }
    await box.click(); await sleep(1500);
    const OPT = '.next-overlay-wrapper.opened .next-menu-item';
    const opts = await this.page.evaluate((s) => Array.from(document.querySelectorAll(s)).filter(e => e.offsetParent !== null).map(e => e.innerText.replace(/\s+/g, ' ').trim()), OPT);
    this.say(`  运费模板候选: ${opts.join(' / ')}`);
    const p = await this.page.evaluate((s, t) => { const e = Array.from(document.querySelectorAll(s)).find(x => x.offsetParent !== null && x.innerText.replace(/\s+/g, ' ').trim() === t); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, OPT, text);
    if (!p) { this.say(`  [miss] 运费模板里没有「${text}」`); await this.esc(); return null; }
    await this.page.mouse.click(p.x, p.y); await sleep(1500);
    const shown = await this.page.evaluate(() => { const e = document.querySelector('#struct-tbExtractWay'); return e ? e.innerText.replace(/\s+/g, ' ').trim().slice(0, 200) : ''; });
    this.say(`  运费区现状: ${shown}`); return text;
  }

  async shot(file) { await this.page.screenshot({ path: file, fullPage: false }).catch(() => {}); }
}
module.exports = { TaobaoPublishPage, getBrowser, sleep, setSpeed };

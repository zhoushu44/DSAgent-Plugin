#!/usr/bin/env node
// DS上架工具 MCP Server —— 豆包/任意 MCP 客户端的入口。
// 工具面刻意收窄：逆向（签名/Cookie/页面驱动）全部在 engine 内部，模型只见「预览/确认/采集/验证」四个工具。
// 两步门禁：publish_preview 产出预览+taskId（内存暂存），publish_confirm(taskId) 才真正提交。
const { TaobaoPublishPage, getBrowser, sleep, setSpeed } = require('./engine/lib.cjs');
const path = require('path'); const fs = require('fs');

const ROOT = __dirname;
const PROFILE = path.join(process.env.USERPROFILE || 'C:\\Users\\Administrator', '.dsh', 'browser-profiles', 'accounts', 'taobao_default');
const OUT = path.join(ROOT, 'out'); fs.mkdirSync(OUT, { recursive: true });
// taskId → { page, browser }（预览后暂存，confirm 时复用同一页面提交；10 分钟过期）
const pending = new Map();
// 拼多多发布走 skills/pdd-publish 的 CLI（--confirm true 才提交，自带两步门禁），以子进程运行
const PDD_STEPS = path.join(ROOT, 'engine', 'pdd-publish', 'steps', 'index.mjs');
function runPddCli(args) {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const p = spawn(process.execPath, [PDD_STEPS, ...args], { cwd: path.join(ROOT, 'engine'), timeout: 600000, maxBuffer: 8 * 1024 * 1024 });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    p.on('close', (code) => {
      // steps/index.mjs 结果以 __DSAGENT_RESULT__{...} 行输出
      const m = /__DSAGENT_RESULT__(\{[\s\S]*\})/.exec(out);
      if (m) { try { return resolve(JSON.parse(m[1])); } catch (e) {} }
      resolve({ ok: false, failureKind: 'cli_error', text: (out + '\n' + err).slice(-600) || ('exit ' + code) });
    });
    p.on('error', e => resolve({ ok: false, failureKind: 'spawn_error', text: e.message }));
  });
}

// ── 商品 JSON 读取与校验 ──────────────────────────────────────────────
function loadProduct(ref) {
  // ref：本地文件路径 或 JSON 字符串
  let P;
  if (fs.existsSync(ref)) P = JSON.parse(fs.readFileSync(ref, 'utf8'));
  else { try { P = JSON.parse(ref); } catch (e) { throw new Error(`商品参数不是文件路径也不是合法 JSON：${String(ref).slice(0, 80)}`); } }
  if (!P.catId && !P.category) throw new Error('商品缺少 catId（或 category 关键词）');
  if (!P.title) throw new Error('商品缺少 title');
  if (!P.skus || !P.skus.length) throw new Error('商品缺少 skus');
  return P;
}

// ── MCP over stdio ────────────────────────────────────────────────────
const TOOLS = [
  { name: 'upgrade', description: '升级引擎：本机 git pull 拉取最新版，返回新版本号。升级后需重启豆包（MCP 服务）生效。', inputSchema: { type: 'object', properties: {} } },
  { name: 'publish_preview', description: '商品上架预览（platform=taobao|pdd）：完成全部填写（属性/SKU/图片/运费/上架时间），返回预览摘要与 taskId。不提交，用户确认后需调 publish_confirm。', inputSchema: { type: 'object', properties: { platform: { type: 'string', enum: ['taobao', 'pdd'], description: '平台，默认 taobao' }, product: { type: 'string', description: '商品 JSON 字符串或本地 JSON 文件绝对路径。淘宝字段：catId(必填), title(必填,≤30汉字), price, stock, itemNo, images[](本地图片路径), specs[](规格维度), skus[](必填), attributes{}, materials, sizeTable{}, skuParams{}, fillAllAttrs(bool), startTime, scheduledAt。拼多多字段：title(必填,≤60字), images[](必填,1~10张本地路径), category(类目关键词), price, stock, specs[](≤2维), skus[](必填), attributes[]' } }, required: ['product'] } },
  { name: 'publish_confirm', description: '确认提交：对 publish_preview 返回的 taskId 真正提交，返回商品编号与验证结果。预览后 10 分钟内有效。', inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] } },
  { name: 'check_listing', description: '买家页验证（taobao）：打开商品页，返回标题/价格/是否已下架并截图。', inputSchema: { type: 'object', properties: { itemId: { type: 'string', description: '商品编号' } }, required: ['itemId'] } },
  { name: 'collect_pdd', description: '拼多多商品数据采集（只读，无上架副作用）：mode=search 按关键词搜商品 / mode=goods 按商品 ID 拉详情 / mode=feed 首页推荐流。返回商品名/价格/销量/店铺等结构化数据。', inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['search', 'goods', 'feed'], description: '默认 search；无关键词时用 feed' }, keyword: { type: 'string' }, goodsId: { type: 'string' }, limit: { type: 'number', description: '条数上限，默认 20，最大 100' } } } },
];

function jsonRpcSend(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n'); }
function jsonRpcError(id, code, message) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n'); }

async function toolCall(name, args) {
  if (name === 'upgrade') {
    return await new Promise((resolve) => {
      const { spawnSync } = require('child_process');
      const gv = () => { const r = spawnSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }); return (r.stdout || '').trim(); };
      const before = gv();
      const r = spawnSync('git', ['-C', ROOT, 'pull', '--ff-only'], { encoding: 'utf8', timeout: 120000 });
      const out = ((r.stdout || '') + (r.stderr || '')).trim();
      const after = gv();
      resolve({ updated: before !== after, from: before, to: after, output: out.slice(0, 400), note: after !== before ? '已更新，重启豆包（MCP 服务）生效。' : '已是最新版本。' });
    });
  }
  if (name === 'publish_preview') {
    const platform = (args.platform || 'taobao').toLowerCase();
    if (platform === 'pdd') {
      // 拼多多：写临时商品文件，走 pdd-publish CLI 预览（无 --confirm 即不提交）。--account 必填（拼多多商家账号 shopKey）
      const P = loadProduct(args.product);
      if (!args.account) throw new Error('拼多多发布需要 account（拼多多商家账号 shopKey，登录后由 login-pdd.ps1 写入）');
      const pf = path.join(OUT, `pdd-${Date.now().toString(36)}.json`); fs.writeFileSync(pf, JSON.stringify(P));
      const cliArgs = ['--product-file', pf, '--account', args.account];
      const r = await runPddCli(cliArgs);
      const taskId = 'P' + Date.now().toString(36);
      pending.set(taskId, { platform: 'pdd', pf, account: args.account, at: Date.now() });
      for (const [k, v] of pending) if (Date.now() - v.at > 600000) { if (v.pf) { try { fs.unlinkSync(v.pf); } catch (e) {} } pending.delete(k); }
      return { taskId, platform: 'pdd', preview: r, note: '预览完成，未提交（--confirm 未传）。用户确认后调 publish_confirm(taskId)。如 preview 里报 not_bound/登录类错误，先跑 login-pdd.ps1。' };
    }
    const P = loadProduct(args.product);
    setSpeed(0.6);
    const browser = await getBrowser({ profileDir: PROFILE });
    const page = await browser.newPage();
    const t = new TaobaoPublishPage(null); t.page = page;
    page.on('dialog', d => d.dismiss().catch(() => {}));
    const taskId = 'T' + Date.now().toString(36);
    try {
      await t.open(P.catId);
      for (const [k, v] of [['title', P.title], ['price', P.price], ['quantity', P.stock], ['outerId', P.itemNo]]) { if (v != null) await t.typeInto(`#struct-${k} input`, null, String(v), 'Tab'); }
      await sleep(1200);
      const attrs = Object.assign({}, P.attributes || {}); if (P.materials) { const mf = (await t.catPropSchema()).find(x => x.uiType === 'material'); if (mf) attrs[mf.label] = P.materials; }
      if (P.fillAllAttrs) { const schema = await t.catPropSchema(); for (const f of schema) { if (f.label === '品牌' || f.uiType === 'material' || attrs[f.label] != null) continue; if (f.options && f.options.length) attrs[f.label] = f.multi ? [f.options[0].text] : f.options[0].text; else if (f.uiType === 'input') attrs[f.label] = '2026'; else if (f.uiType === 'taoSirProp') attrs[f.label] = '1' + (f.options && f.options[0] ? '|' + f.options[0].text : ''); } }
      await t.fillAttributes(attrs);
      await t.fillSpecs(P); await sleep(2500);
      const rows = await t.readSkuRows(); const mapped = await t.mapSkuRows(P, rows);
      const skuBack = await t.fillSkuRows(mapped.map(m => m.sku || {}));
      await t.fillSkuParams(P, rows);
      if (P.sizeTable) await t.fillSizeTable(P.sizeTable);
      await t.enableMultiDiscount();
      setSpeed(1);
      const rep = await t.prepareSubmit({ images: Array.isArray(P.images) && P.images.length ? P.images : null, startTime: P.startTime || '放入仓库', scheduledAt: P.scheduledAt || undefined });
      const shot = path.join(OUT, `${taskId}-预览.png`);
      await page.screenshot({ path: shot, timeout: 30000 }).catch(() => {});
      pending.set(taskId, { page, t, P, at: Date.now() });
      for (const [k, v] of pending) if (Date.now() - v.at > 600000) { v.page.close().catch(() => {}); pending.delete(k); }
      return { taskId, title: P.title, skuRows: skuBack.length, skuBack, attrsMissed: [], screenshots: [shot], note: '预览完成，未提交。用户确认后调 publish_confirm(taskId)。' };
    } catch (e) { await page.close().catch(() => {}); throw e; }
  }
  if (name === 'publish_confirm') {
    const p = pending.get(args.taskId);
    if (!p) throw new Error('taskId 不存在或已过期（预览后 10 分钟有效），请重新 publish_preview');
    pending.delete(args.taskId);
    if (p.platform === 'pdd') {
      const r = await runPddCli(['--product-file', p.pf, '--account', p.account, '--confirm', 'true']);
      try { fs.unlinkSync(p.pf); } catch (e) {}
      return { platform: 'pdd', result: r, note: '如 r.text 含「提交成功/上架成功」即完成；截图看 out\\ 目录。' };
    }
    const { page, t, P } = p;
    const before = page.url();
    if (!await t.jsClickText('body', '提交宝贝信息', '提交宝贝信息')) throw new Error('没找到提交按钮');
    let itemId = null, errs = [];
    for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 1500));
      const st = await page.evaluate(() => ({ url: location.href.slice(0, 220), errs: Array.from(document.querySelectorAll('.next-form-item-help.error, .error-msg')).filter(e => e.offsetParent !== null && (e.innerText || '').trim()).map(e => e.innerText.trim()).slice(0, 5) })).catch(() => ({ url: '', errs: [] }));
      const m = /primaryId=(\d+)/.exec(st.url || ''); if (m) { itemId = m[1]; break; }
      errs = st.errs; if (errs.length && i > 5) break; }
    const shot = path.join(OUT, `${args.taskId}-提交结果.png`);
    await page.screenshot({ path: shot, timeout: 30000 }).catch(() => {});
    await page.close().catch(() => {});
    if (!itemId) return { status: '未成功', errors: errs, screenshots: [shot] };
    // 买家页验证
    const browser = await getBrowser({ profileDir: PROFILE }); const b = await browser.newPage();
    await b.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36');
    await b.goto(`https://item.taobao.com/item.htm?id=${itemId}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(5000);
    const buyer = await b.evaluate(() => { const x = document.body.innerText.replace(/\s+/g, ' '); return { title: document.title.slice(0, 70), offShelf: /已经下架/.test(x), price: (x.match(/￥\s*[\d.]+/) || [''])[0] }; });
    const bshot = path.join(OUT, `${args.taskId}-买家页.png`);
    await b.screenshot({ path: bshot, timeout: 30000 }).catch(() => {});
    await b.close().catch(() => {});
    return { status: '提交成功', itemId, buyer, screenshots: [shot, bshot] };
  }
  if (name === 'check_listing') {
    const browser = await getBrowser({ profileDir: PROFILE }); const b = await browser.newPage();
    await b.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36');
    await b.goto(`https://item.taobao.com/item.htm?id=${args.itemId}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(5000);
    const r = await b.evaluate(() => { const x = document.body.innerText.replace(/\s+/g, ' '); return { title: document.title.slice(0, 70), offShelf: /已经下架/.test(x), price: (x.match(/￥\s*[\d.]+/) || [''])[0] }; });
    const shot = path.join(OUT, `check-${args.itemId}.png`);
    await b.screenshot({ path: shot, timeout: 30000 }).catch(() => {});
    await b.close().catch(() => {});
    return { itemId: args.itemId, ...r, screenshots: [shot] };
  }
  if (name === 'collect_pdd') {
    // 采集走 engine\pdd\pdd-crawl-cli.mjs（薄 CLI 包 pdd-crawl.js），账号取本机凭证库已登录的 pdd 账号
    const crawl = path.join(ROOT, 'engine', 'pdd', 'pdd-crawl-cli.mjs');
    if (!fs.existsSync(crawl)) throw new Error('engine\\pdd\\pdd-crawl-cli.mjs 缺失（安装不完整），重新 update.ps1');
    return await new Promise((resolve) => {
      const { spawn } = require('child_process');
      const a = [crawl];
      if (args.mode) a.push('--mode', args.mode); if (args.keyword) a.push('--keyword', args.keyword);
      if (args.goodsId) a.push('--goods-id', args.goodsId); if (args.limit) a.push('--limit', String(Math.min(100, args.limit)));
      const p = spawn(process.execPath, a, { cwd: path.join(ROOT, 'engine', 'pdd'), timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
      let out = '', err = '';
      p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
      p.on('close', () => {
        const m = /__DSAGENT_RESULT__(\{[\s\S]*\})/.exec(out);
        if (m) { try { return resolve({ platform: 'pdd', result: JSON.parse(m[1]) }); } catch (e) {} }
        resolve({ platform: 'pdd', result: { ok: false, text: (out + '\n' + err).slice(-600) } });
      });
      p.on('error', e => resolve({ platform: 'pdd', result: { ok: false, text: e.message } }));
    });
  }
  throw new Error(`未知工具 ${name}`);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => {
  buf += d;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch (e) { continue; }
    (async () => {
      if (msg.method === 'initialize') return jsonRpcSend(msg.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'ds-publish', version: '1.0.0' } });
      if (msg.method === 'tools/list') return jsonRpcSend(msg.id, { tools: TOOLS });
      if (msg.method === 'tools/call') { try { return jsonRpcSend(msg.id, { content: [{ type: 'text', text: JSON.stringify(await toolCall(msg.params.name, msg.params.arguments || {}), null, 1) }] }); } catch (e) { return jsonRpcError(msg.id, -32000, String(e.message || e).slice(0, 300)); } }
      if (msg.id != null) return jsonRpcSend(msg.id, {});
    })();
  }
});
process.stdin.on('end', () => process.exit(0));
console.error('[ds-publish] MCP server ready (stdio)');

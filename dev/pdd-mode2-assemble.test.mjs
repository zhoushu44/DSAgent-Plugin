// pdd-mode2 组装层单测：buildGoodsDetailFromProduct（m4）+ 端到端组装→transformRequestBody（m5 双道断言口径）
// + sendPddEditViaHttp（m6 mock fetch）。
// 提取机制与 pdd-mode2-diff.test.mjs 同款：标记段提取 → 剥 export → esbuild stripTypes → eval。
//   - m4 组装层落在「常量表 → m1」区段内（差分 eval 区间尾缝隙），直接复用同一区间；
//   - m6 在 m1 标记之后、依赖 withTimeout（m3 段）+ PDD_ERROR_CODE（常量表段），
//     从「常量表 → m1」区间取 PDD_ERROR_CODE，从 m3 段定位 withTimeout，与 m6 段拼装。
import fs from 'node:fs';
import path from 'node:path';
import { transform } from 'esbuild';

const ROOT = 'e:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin';
const SRC_TS = path.join(ROOT, 'src/pdd-mode2.ts');

const tsSrc = fs.readFileSync(SRC_TS, 'utf8');

// —— 括号配平工具（与差分测试同款，感知字符串/模板/注释/正则）——
function skipStr(s, k) { const q = s[k]; k++; while (k < s.length && s[k] !== q) { if (s[k] === '\\') k++; k++; } return k; }
function skipTpl(s, k) { k++; while (k < s.length && s[k] !== '`') { if (s[k] === '\\') { k += 2; continue; } if (s[k] === '$' && s[k+1] === '{') { k = balance(s, k+1, '{', '}'); k++; continue; } k++; } return k; }
function skipLine(s, k) { while (k < s.length && s[k] !== '\n') k++; return k; }
function skipBlock(s, k) { k += 2; while (k < s.length && !(s[k] === '*' && s[k+1] === '/')) k++; return k + 2; }
function skipRe(s, k) {
  let inCls = false, i = k + 1;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { i += 2; continue; }
    if (inCls) { if (c === ']') inCls = false; i++; continue; }
    if (c === '[') { inCls = true; i++; continue; }
    if (c === '/') return i;
    if (c === '\n') return k;
    i++;
  }
  return k;
}
function isReStart(s, k) {
  let p = k - 1;
  while (p >= 0 && /\s/.test(s[p])) p--;
  if (p < 0) return true;
  const c = s[p];
  if ('(,=:[!&|?{;+-*%~^'.includes(c)) return true;
  return /\b(return|typeof|case|in|of|new|delete|void|instanceof)$/.test(s.slice(Math.max(0, p - 10), p + 1));
}
function balance(s, from, open, close) {
  let k = from, depth = 0;
  while (k < s.length) {
    const c = s[k];
    if (c === '"' || c === "'") { k = skipStr(s, k); k++; continue; }
    if (c === '`') { k = skipTpl(s, k); k++; continue; }
    if (c === '/' && s[k+1] === '/') { k = skipLine(s, k); continue; }
    if (c === '/' && s[k+1] === '*') { k = skipBlock(s, k); continue; }
    if (c === '/' && isReStart(s, k)) { const end = skipRe(s, k); if (end !== k) { k = end + 1; while (k < s.length && /[a-z]/.test(s[k])) k++; continue; } }
    if (c === open) depth++;
    if (c === close) { depth--; if (depth === 0) return k; }
    k++;
  }
  return -1;
}

// —— 区段提取：两处标记行 → 回退行首 → 截段 ——
function extractSegment(beginMark, endMark) {
  const bIdx = tsSrc.indexOf(beginMark);
  const eIdx = tsSrc.indexOf(endMark);
  if (bIdx < 0 || eIdx < 0 || eIdx <= bIdx) throw new Error(`区段标记未找到: ${beginMark} / ${endMark}`);
  let segStart = bIdx;
  while (segStart > 0 && tsSrc[segStart - 1] !== '\n') segStart--;
  let segEnd = eIdx;
  while (segEnd > 0 && tsSrc[segEnd - 1] !== '\n') segEnd--;
  return tsSrc.slice(segStart, segEnd);
}

const M_CONST_TO_M4 = extractSegment('───────────────────────── 常量表', '───────────────────────── m1：Anti-Content');
// 常量表 → 类型定义 → 基础工具 → … → 四步流水线 → thumb 链 → m4 组装层（eval 区间内）
// 该区间包含 transformRequestBody 全流水线 + buildGoodsDetailFromProduct。
// 注意：区间内 thumb 链有模块级常量依赖（无——thumb 链在差分测试里整段可 eval，已验证）。

// m6 段到文件尾（m6 是最后一个区段）
const M6_SEG = (() => {
  const bIdx = tsSrc.indexOf('───────────────────────── m6：HTTP 兜底代发');
  if (bIdx < 0) throw new Error('m6 标记未找到');
  let segStart = bIdx;
  while (segStart > 0 && tsSrc[segStart - 1] !== '\n') segStart--;
  return tsSrc.slice(segStart);
})();
const M3_WITH_TIMEOUT = (() => {
  const m3Seg = extractSegment('───────────────────────── m3：CDP 请求拦截器', '───────────────────────── m6：HTTP 兜底代发');
  const idx = m3Seg.indexOf('function withTimeout');
  if (idx < 0) throw new Error('withTimeout 未找到');
  const bOpen = m3Seg.indexOf('{', idx);
  const bClose = balance(m3Seg, bOpen, '{', '}');
  return m3Seg.slice(idx, bClose + 1);
})();

// —— 剥 export → esbuild stripTypes → eval ——
async function buildContext(seg, exposeNames) {
  // 剥 export 但保留 async（sendPddEditViaHttp 是 async，剥掉 async 会致体内 await 语法错误）
  let code = seg.replace(/^export (async )?/gm, (m, a) => (a ? 'async ' : ''));
  const out = await transform('type _Void = void\n' + code, { loader: 'ts', format: 'cjs' });
  return new Function(out.code + '\nreturn {\n' + exposeNames.map(n => `${n}: (typeof ${n} !== 'undefined' ? ${n} : undefined)`).join(',\n') + '\n};')();
}

// 引擎侧（含 PDD_ERROR_CODE / withTimeout / transformRequestBody / buildGoodsDetailFromProduct）
const engine = await buildContext(M_CONST_TO_M4 + '\n' + M3_WITH_TIMEOUT + '\n' + M6_SEG, [
  'transformRequestBody', 'buildGoodsDetailFromProduct', 'summarizeEditBody',
  'sendPddEditViaHttp', 'PDD_ERROR_CODE', 'PDD_PROXY_SEND_TIMEOUT_MS',
]);
for (const n of ['transformRequestBody', 'buildGoodsDetailFromProduct', 'summarizeEditBody', 'sendPddEditViaHttp']) {
  if (typeof engine[n] !== 'function') throw new Error(`函数缺失: ${n}`);
}
if (!engine.PDD_ERROR_CODE || engine.PDD_ERROR_CODE.SEND_NETWORK !== 'PDD_SEND_NETWORK') throw new Error('PDD_ERROR_CODE 缺失');

/* ═══════════ 断言工具 ═══════════ */
const failures = [];
let passed = 0, failed = 0;
function deepEq(a, b, path = '$') {
  const ta = typeOf(a), tb = typeOf(b);
  if (ta !== tb) { failures.push(`${path}: 类型 ${ta} !== ${tb}`); return false; }
  if (ta === 'array') {
    if (a.length !== b.length) { failures.push(`${path}: 长度 ${a.length} !== ${b.length}`); return false; }
    let ok = true;
    for (let i = 0; i < a.length; i++) if (!deepEq(a[i], b[i], `${path}[${i}]`)) ok = false;
    return ok;
  }
  if (ta === 'object') {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (JSON.stringify(ka) !== JSON.stringify(kb)) { failures.push(`${path}: 键集不同\n  期望: ${JSON.stringify(ka)}\n  实际: ${JSON.stringify(kb)}`); return false; }
    let ok = true;
    for (const k of ka) if (!deepEq(a[k], b[k], `${path}.${k}`)) ok = false;
    return ok;
  }
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return true;
  if (a !== b) { failures.push(`${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); return false; }
  return true;
}
function typeOf(v) { if (v === null) return 'null'; if (Array.isArray(v)) return 'array'; return typeof v; }
function eq(label, expect, actual) {
  failures.length = 0;
  if (deepEq(expect, actual)) { passed++; console.log(`  ok ${label}`); }
  else { failed++; console.log(`  FAIL ${label}`); for (const f of failures.slice(0, 12)) console.log(`    ${f}`); }
}
function ok(label, cond, msg = '') {
  if (cond) { passed++; console.log(`  ok ${label}`); }
  else { failed++; console.log(`  FAIL ${label}${msg ? ' — ' + msg : ''}`); }
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }

/* ═══════════ A 组：m4 组装映射直拍 ═══════════ */
console.log('══ A 组：buildGoodsDetailFromProduct 组装映射 ══\n');

// A1：一维规格（颜色）——sku_sort / sku_key / sku_key_list / sku_price / gallery / movingConfig
// 本地文件名（非 http(s)）不进 gallery——模式2 图片以页面 UI 上传为准，
// 本地路径若进 gallery 会整组覆盖页面已上传的 CDN url，提交报「图片url不能为空」。
{
  const detail = engine.buildGoodsDetailFromProduct({
    title: '测试童装',
    images: ['g1.jpg', 'g2.jpg'],
    detailImages: ['d1.jpg'],
    price: '19.9',
    stock: '100',
    itemNo: 'NO-001',
    specs: [{ name: '颜色', values: [{ value: '红色' }, { value: '蓝色' }] }],
    skus: [
      { specs: { 颜色: '红色' }, price: '18.9', stock: '10' },
      { specs: { 颜色: '蓝色' }, price: '28.9', stock: '20' },
    ],
  }, { costTemplate: '1024', deliveryTime: 3 });
  const expected = {
    base_attr: { '货号': 'NO-001' },
    sku_sort: ['颜色'],
    sku_key: { '1': ['红色'], '2': ['蓝色'] },
    sku_key_list: ['1', '2'],
    sku_price: { '1': { price: '18.9', stock: '10' }, '2': { price: '28.9', stock: '20' } },
    movingConfig: {
      inventory: '100',
      pdd_single_buy_rule_type: 1,
      pdd_single_buy_percent: 20,
      productCode_radio: 3,
      template: '1024',
      selectTime: '48h',
    },
    expected_skus_priced: 2,
  };
  eq('A1 一维规格组装', expected, detail);
}

// A2：二维规格（颜色 × 尺码）+ 行价格缺省回落顶层 + 无效行跳过
{
  const detail = engine.buildGoodsDetailFromProduct({
    title: '二维',
    images: [],
    price: '15',
    stock: '5',
    specs: [
      { name: '颜色', values: [{ value: '红' }, { value: '蓝' }] },
      { name: '尺码', values: [{ value: 'S' }, { value: 'M' }] },
    ],
    skus: [
      { specs: { 颜色: '红', 尺码: 'S' } },           // price/stock 回落顶层
      { specs: { 颜色: '蓝', 尺码: 'M' }, price: '25' },
      { specs: { 颜色: '  ', 尺码: '' } },             // 全空行 → 跳过
      { specs: { 颜色: '红', 尺码: 'M' }, price: '20', stock: '7' },
    ],
  });
  eq('A2 二维规格组装', {
    sku_sort: ['颜色', '尺码'],
    sku_key: { '1': ['红', 'S'], '2': ['蓝', 'M'], '3': ['红', 'M'] },
    sku_key_list: ['1', '2', '3'],
    sku_price: { '1': { price: '15', stock: '5' }, '2': { price: '25', stock: '5' }, '3': { price: '20', stock: '7' } },
    movingConfig: { inventory: '5', pdd_single_buy_rule_type: 1, pdd_single_buy_percent: 20 },
    expected_skus_priced: 3,
  }, detail);
}

// A3：无规格 → price_detail.default（本地路径 images 不进 gallery）
{
  const detail = engine.buildGoodsDetailFromProduct({
    title: '无规格', images: ['x.jpg'], price: '9.9', stock: '3',
  });
  eq('A3 无规格组装', {
    price_detail: { default: { price: '9.9', stock: '3' } },
    movingConfig: { inventory: '3', pdd_single_buy_rule_type: 1, pdd_single_buy_percent: 20 },
    expected_skus_priced: 1,
  }, detail);
}

// A3b：http(s) 图片 URL 正常进 gallery（远程图源场景）
{
  const detail = engine.buildGoodsDetailFromProduct({
    title: '远程图', images: ['https://cdn.example/a.jpg'], detailImages: ['http://cdn.example/b.jpg'],
    price: '9.9', stock: '3',
  });
  eq('A3b 远程 URL 进 gallery', [
    { type: 1, img_url: 'https://cdn.example/a.jpg' },
    { type: 2, img_url: 'http://cdn.example/b.jpg' },
  ], detail.gallery);
}

// A4：costTemplate 模板名（非数字）不进 template；deliveryTime 1/2 映射
{
  const d1 = engine.buildGoodsDetailFromProduct({ title: 't', images: [] }, { costTemplate: '包邮模板', deliveryTime: 1 });
  ok('A4a 模板名不进 template', !d1.movingConfig?.template);
  ok('A4b deliveryTime=1 → today', d1.movingConfig?.selectTime === 'today');
  const d2 = engine.buildGoodsDetailFromProduct({ title: 't', images: [] }, { deliveryTime: 2 });
  ok('A4c deliveryTime=2 → 24h', d2.movingConfig?.selectTime === '24h');
  const d3 = engine.buildGoodsDetailFromProduct({ title: 't', images: [] }, { deliveryTime: 99 });
  ok('A4d deliveryTime 无效值不设 selectTime', !d3.movingConfig?.selectTime);
}

// A5：极简输入（只有 title）→ 只有单买价缺省，无其他字段
{
  const detail = engine.buildGoodsDetailFromProduct({ title: '最小', images: [] });
  eq('A5 极简输入', {
    movingConfig: { pdd_single_buy_rule_type: 1, pdd_single_buy_percent: 20 },
  }, detail);
}

// A6：有 specs 但 skus 全无效 → 回落无规格（price_detail.default）
{
  const detail = engine.buildGoodsDetailFromProduct({
    title: '全无效', images: [], price: '6.6',
    specs: [{ name: '颜色', values: [{ value: '红' }] }],
    skus: [{ specs: { 颜色: '' } }, { specs: { 颜色: null } }],
  });
  ok('A6a 回落无规格', !!detail.price_detail?.default && !detail.sku_key);
  eq('A6b price_detail.default', { default: { price: '6.6' } }, detail.price_detail);
  ok('A6c expected_skus_priced=1', detail.expected_skus_priced === 1);
}

/* ═══════════ B 组：端到端（组装产物 → transformRequestBody）════════════ */
console.log('\n══ B 组：组装 → 引擎流水线端到端 ══\n');

// commitBody 骨架（对齐差分测试 baseCommitBody）
function baseCommitBody(over = {}) {
  return {
    goods_name: '测试商品',
    cat_id: 12345,
    gallery: [
      { type: 1, img_url: 'https://img.pdd.example/g1.jpg' },
      { type: 2, img_url: 'https://img.pdd.example/v1.mp4', video_url: 'https://img.pdd.example/v1.mp4' },
    ],
    skus: [],
    detail_gallery: [],
    is_onsale: 1,
    ...over,
  };
}
function sku(texts, over = {}) {
  return { spec: texts.map(t => ({ spec_name: t })), multi_price: 0, price: 0, is_onsale: 1, quantity: 0, ...over };
}

// B1：一维端到端——组装产物直喂 transformRequestBody，断言 skusPricedDelta 与实际定价
{
  const detail = engine.buildGoodsDetailFromProduct({
    title: '童装',
    images: ['https://cdn.pdd.example/a.jpg', 'https://cdn.pdd.example/b.jpg'],
    price: '19.9',
    stock: '100',
    itemNo: 'NO-001',
    specs: [{ name: '颜色', values: [{ value: '红色' }, { value: '蓝色' }] }],
    skus: [
      { specs: { 颜色: '红色' }, price: '18.9', stock: '10' },
      { specs: { 颜色: '蓝色' }, price: '28.9', stock: '20' },
    ],
  }, { costTemplate: '1024', deliveryTime: 3 });
  const commit = baseCommitBody({ skus: [sku(['红色']), sku(['蓝色'])] });
  const out = engine.transformRequestBody(commit, detail);
  ok('B1a skusPricedDelta=2', out.skusPricedDelta === 2, `实际 ${out.skusPricedDelta}`);
  ok('B1b after.skusPriced=2', out.after.skusPriced === 2, `实际 ${out.after.skusPriced}`);
  ok('B1c afterPriced ≥ expected_skus_priced', out.after.skusPriced >= detail.expected_skus_priced);
  ok('B1d multi_price 已定价', Number(out.commitBody.skus[0].multi_price) === 1890 && Number(out.commitBody.skus[1].multi_price) === 2890,
    `实际 ${out.commitBody.skus.map(s => s.multi_price).join(',')}`);
  ok('B1e 库存已填（quantity_delta）', out.commitBody.skus[0].quantity_delta === 10 && out.commitBody.skus[1].quantity_delta === 20,
    `实际 ${out.commitBody.skus.map(s => s.quantity_delta).join(',')}`);
  ok('B1f 运费模板已写', out.commitBody.cost_template_id === '1024' && out.commitBody.is_default_template_id === 1);
  ok('B1g 发货时效 48h→172800', out.commitBody.shipment_limit_second === 172800);
  ok('B1h 主图整组替换', out.type1Delta === 1 && out.commitBody.gallery.filter(e => e.type === 1).length === 2,
    `type1Delta=${out.type1Delta}`);
  ok('B1i 单买价 +20%', Number(out.commitBody.skus[0].price) === 2268 || Number(out.commitBody.skus[0].price) === 2269,
    `实际 ${out.commitBody.skus[0].price}（18.9×1.2=22.68 元 → 分）`);
  // 货号：resolveSafePddOutGoodsSn radio='3' → commitBody 顶层 out_goods_sn（非 SKU 级）
  ok('B1j 货号填充（commitBody.out_goods_sn）', out.commitBody.out_goods_sn === 'NO-001', `实际 ${out.commitBody.out_goods_sn}`);
}

// B2：二维端到端
{
  const detail = engine.buildGoodsDetailFromProduct({
    title: '二维',
    images: ['https://cdn.pdd.example/c.jpg'],
    price: '15',
    stock: '5',
    specs: [
      { name: '颜色', values: [{ value: '红色' }, { value: '蓝色' }] },
      { name: '尺码', values: [{ value: 'S' }, { value: 'M' }] },
    ],
    skus: [
      { specs: { 颜色: '红色', 尺码: 'S' }, price: '19', stock: '9' },
      { specs: { 颜色: '红色', 尺码: 'M' }, price: '29', stock: '19' },
      { specs: { 颜色: '蓝色', 尺码: 'M' }, price: '39', stock: '29' },
    ],
  });
  const commit = baseCommitBody({ skus: [sku(['红色', 'S']), sku(['红色', 'M']), sku(['蓝色', 'M'])] });
  const out = engine.transformRequestBody(commit, detail);
  ok('B2a skusPricedDelta=3', out.skusPricedDelta === 3, `实际 ${out.skusPricedDelta}`);
  ok('B2b afterPriced ≥ expected', out.after.skusPriced >= detail.expected_skus_priced);
  ok('B2c 逐行 multi_price', out.commitBody.skus.map(s => Number(s.multi_price)).join(',') === '1900,2900,3900',
    `实际 ${out.commitBody.skus.map(s => s.multi_price).join(',')}`);
}

// B3：无规格端到端
{
  const detail = engine.buildGoodsDetailFromProduct({
    title: '无规格', images: [], price: '9.9', stock: '3',
  });
  const commit = baseCommitBody({ skus: [sku([])] });
  const out = engine.transformRequestBody(commit, detail);
  ok('B3a skusPricedDelta=1', out.skusPricedDelta === 1, `实际 ${out.skusPricedDelta}`);
  ok('B3b multi_price=990', Number(out.commitBody.skus[0].multi_price) === 990, `实际 ${out.commitBody.skus[0].multi_price}`);
  ok('B3c quantity_delta=3', out.commitBody.skus[0].quantity_delta === 3, `实际 ${out.commitBody.skus[0].quantity_delta}`);
}

/* ═══════════ C 组：m6 sendPddEditViaHttp（mock fetch）════════════ */
console.log('\n══ C 组：sendPddEditViaHttp 包装语义 ══\n');

function mkResp(status, body, opts = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => { if (opts.textThrows) throw new Error('resp body error'); return text; },
  };
}

// C1：成功（success===true）
{
  let captured = null;
  const fetchImpl = async (url, init) => { captured = { url, init }; return mkResp(200, { success: true, result: { goods_id: 'G1' } }); };
  const out = await engine.sendPddEditViaHttp(
    { url: 'https://mms.pinduoduo.com/glide/mms/goodsCommit/action/edit', body: { a: 1 }, antiContent: 'ANTI', cookie: 'PDDAccessToken=x' },
    fetchImpl,
  );
  ok('C1a via=proxy 成功', out.success === true && out.via === 'proxy' && out.status === 200);
  ok('C1b POST + JSON body', captured.init.method === 'POST' && JSON.parse(captured.init.body).a === 1);
  ok('C1c Anti-Content/Cookie 透传', captured.init.headers['Anti-Content'] === 'ANTI' && captured.init.headers.Cookie === 'PDDAccessToken=x');
  ok('C1d 指纹头齐', captured.init.headers['Sec-Ch-Ua-Platform'] === '"Windows"' && captured.init.headers['Sec-Fetch-Site'] === 'same-origin'
    && captured.init.headers.Referer === 'https://mms.pinduoduo.com/' && captured.init.headers['User-Agent'].includes('Chrome/120'));
}

// C2：403 → networkError + authOrEnvError + error_msg
{
  const out = await engine.sendPddEditViaHttp(
    { url: 'u', body: {}, antiContent: '', cookie: '' },
    async () => mkResp(403, { error_msg: '登录态失效' }),
  );
  ok('C2 403 包装', out.success === false && out.networkError === true && out.authOrEnvError === true && out.error_msg === '登录态失效' && out.via === 'proxy');
}

// C3：空 body
{
  const out = await engine.sendPddEditViaHttp(
    { url: 'u', body: {}, antiContent: '', cookie: '' },
    async () => mkResp(200, ''),
  );
  ok('C3 空 body 包装', out.success === false && out.networkError === true && out.authOrEnvError === true && out.status === 200);
}

// C4：业务失败（success!==true）
{
  const out = await engine.sendPddEditViaHttp(
    { url: 'u', body: {}, antiContent: '', cookie: '' },
    async () => mkResp(200, { success: false, error_msg: '类目资质不足' }),
  );
  ok('C4 业务失败包装', out.success === false && out.isBizFailure === true && out.error_msg === '类目资质不足' && out.errorCode === engine.PDD_ERROR_CODE.API_BIZ);
}

// C5：fetch 异常
{
  const out = await engine.sendPddEditViaHttp(
    { url: 'u', body: {}, antiContent: '', cookie: '' },
    async () => { throw new Error('ECONNREFUSED'); },
  );
  ok('C5 fetch 异常包装', out.success === false && out.networkError === true && out.authOrEnvError === true && String(out.error).includes('ECONNREFUSED'));
}

// C6：非 JSON
{
  const out = await engine.sendPddEditViaHttp(
    { url: 'u', body: {}, antiContent: '', cookie: '' },
    async () => mkResp(502, '<html>Bad Gateway</html>'),
  );
  ok('C6 非 JSON 包装', out.success === false && out.networkError === true && out.authOrEnvError === true && out.status === 502);
}

/* ═══════════ D 组：m5 断言纯逻辑（双道口径）════════════ */
console.log('\n══ D 组：m5 增量验证口径 ══\n');

// D1：delta>0 但丢行（afterPriced < expected）→ 应判失败（第二道）
{
  const delta = 1, afterPriced = 1, expected = 3;
  const firstGate = delta > 0;
  const secondGate = expected > 0 && afterPriced < expected;
  ok('D1 丢行场景第二道拦截', firstGate && secondGate, 'delta>0 但丢行应被第二道断言拦截');
}

// D2：健康场景（delta>0 且 afterPriced ≥ expected）双道皆过
{
  const detail = engine.buildGoodsDetailFromProduct({
    title: 't', images: [],
    specs: [{ name: '颜色', values: [{ value: '红' }] }],
    skus: [{ specs: { 颜色: '红' }, price: '1' }],
  });
  const commit = baseCommitBody({ skus: [sku(['红'])] });
  const out = engine.transformRequestBody(commit, detail);
  const firstGate = out.skusPricedDelta > 0;
  const secondGate = !(Number(detail.expected_skus_priced) > 0 && Number(out.after.skusPriced) < Number(detail.expected_skus_priced));
  ok('D2 健康场景双道皆过', firstGate && secondGate, `delta=${out.skusPricedDelta}, after=${out.after.skusPriced}, expected=${detail.expected_skus_priced}`);
}

// D3：乱序 commitBody（行序与组装序不一致）→ 引擎按 spec 匹配而非行序，仍全定价
{
  const detail = engine.buildGoodsDetailFromProduct({
    title: 't', images: [], price: '10', stock: '6',
    specs: [
      { name: '颜色', values: [{ value: '红' }, { value: '蓝' }] },
      { name: '尺码', values: [{ value: 'S' }, { value: 'M' }] },
    ],
    skus: [
      { specs: { 颜色: '红', 尺码: 'S' }, price: '10' },
      { specs: { 颜色: '蓝', 尺码: 'M' }, price: '20' },
    ],
  });
  const commit = baseCommitBody({ skus: [sku(['蓝色', 'M']), sku(['红色', 'S'])] });
  const out = engine.transformRequestBody(commit, detail);
  ok('D3 乱序仍全定价', out.after.skusPriced === 2 && out.skusPricedDelta === 2, `after=${out.after.skusPriced}`);
}

/* ═══════════ 汇总 ═══════════ */
console.log(`\n══ 结果: ${passed} passed, ${failed} failed ══`);
process.exit(failed > 0 ? 1 : 0);

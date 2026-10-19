// pdd-mode2 差分黄金测试：原版引擎（m_042_8087 原文抽取）vs 移植版（src/pdd-mode2.ts 标记段）
// 同一输入喂两侧，断言 commitBody 逐字段一致。
import fs from 'node:fs';
import path from 'node:path';
import { transform } from 'esbuild';

const ROOT = 'e:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin';
const SRC_TS = path.join(ROOT, 'src/pdd-mode2.ts');
const ORIG_JS = 'C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/rea-gm-modules/m_042_8087.js';

/* ═══════════ 一、通用工具：字符串/模板/注释/正则感知的括号配平 ═══════════ */

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
function nameChar(c) { return /[_$A-Za-z0-9]/.test(c); }

/* ═══════════ 二、原版方法抽取器：两段式（参数表 + 方法体），先原名再 _ 前缀 ═══════════ */

const ORIG = fs.readFileSync(ORIG_JS, 'utf8');

function findMethodDef(name) {
  for (const full of [name, '_' + name]) {
    let idx = 0;
    while ((idx = ORIG.indexOf(full, idx)) !== -1) {
      const prev = idx > 0 ? ORIG[idx - 1] : '';
      const next = ORIG[idx + full.length] || '';
      if (!nameChar(prev) && next === '(') {
        const pOpen = idx + full.length;
        const pClose = balance(ORIG, pOpen, '(', ')');
        if (pClose < 0) { idx += full.length; continue; }
        let b = pClose + 1;
        while (b < ORIG.length && /\s/.test(ORIG[b])) b++;
        if (ORIG[b] !== '{') { idx += full.length; continue; }
        const bodyEnd = balance(ORIG, b, '{', '}');
        if (bodyEnd < 0) { idx += full.length; continue; }
        return ORIG.slice(idx, bodyEnd + 1); // 形如 name(a,b){...}
      }
      idx += full.length;
    }
  }
  return null;
}

// 流水线依赖树方法清单（8087 内）
const METHOD_LIST = [
  // 顶层四步
  'transformRequestBody', 'fillImageData', 'fillSkuPriceData', 'fillShippingConfig',
  'applyPddElecGoodsAttributes', 'fillNoSpecSkuPriceDataInRequest',
  // thumb 链
  '_applyPddSkuThumbUrlToCommitSku', '_resolvePddSkuIdKeyForThumb', '_resolvePddSkuKeyPathForThumb',
  '_resolvePddSearchSkuIdFromSkuListForThumb', '_bridgePddSearchSkuIdFromKeyPath',
  '_findPddSkuListRowByKeyPathOrSkuId', '_resolvePddSpecThumbFromUploadMap',
  '_resolvePddSpecImageDimIndex', '_scorePddThumbSpecRowMatch', '_pickBestPddSpecCandidateForThumb',
  '_pickUniqueBestThumbScoredId', '_matchPddSpecValueStrictForThumb', '_matchPddSizeSpecValueForThumb',
  '_isPddThumbSizeDimension', '_isPddLikelySizeSpecValue', '_normalizePddSizeSpecToken',
  '_extractPddLeadingSizeCodeForThumb', '_isPddUsableSkuId', 'isColorLikeSpecTypeName',
  '_getEffectivePddSkuImageMode',
  // 规格/价格清洗
  'sanitizePddSpecWhitelist', 'cleanSpecName', 'canonicalizePddSpecValue', 'truncatePddSpecLikePlatform',
  'cleanSkuMatchKey', 'fuzzyMatch', 'dimMatchSkuToSpec',
  // 价格归一/取价
  'normalizeSkuPriceRecord', 'isSkuPriceLeaf', 'pickSingleNestedPriceLeaf', 'collectSpecTextsFromPddSku',
  'computePddSingleBuyYuan', 'extractPrice', 'priceToFenAndYuan', 'applyPddMarketReferencePrice',
  // 库存族
  'getPddStockMode', 'getPddCustomInventory', '_peekStockFromPriceData', '_readExplicitStockNumber',
  'extractStock', 'applyResolvedStockToCommitSku', 'resolveSkuStockForFill', 'logPddSkuStockDecision',
  // 价格表匹配族
  'getOrderedSkuKeyIdsWithPrice', 'specTextsLookLikeRowCodePlaceholders', 'buildStablePriceDetailForFill',
  'isEmptyPriceDetailTable', 'findPriceDataByPublishedSpec', 'findTwoDimPriceByCombinedSingleSpec',
  'findTwoDimPriceByFirstDimOrdinal', 'findTwoDimPriceFromSkuMatrixUnordered',
  'fuzzyMatchPriceDetailLeafOnly', 'fuzzyMatchKey', 'findPriceDataForSkuFuzzy',
  'findPriceDataForMultiDimensionalSku', 'resolveSingleSkuPriceFallback',
  // 商家编码
  'resolveSafePddOutGoodsSn', 'getChineseEnglishLength', 'truncateByChineseEnglishLength',
  // 无规格
  'resolveNoSpecPriceRecord', 'resolveNoSpecStock',
];

function buildOrigEngine() {
  const parts = [];
  const missing = [];
  for (const name of METHOD_LIST) {
    const def = findMethodDef(name);
    if (!def) { missing.push(name); continue; }
    parts.push(def);
  }
  // 外部依赖（S 常量表 / y 数字转换 / localStorage）在引擎闭包前缀注入
  const prefix = `
    const S = { PDD_SPEC_MAX_JS_LEN: 40, PDD_OUT_GOODS_SN_MAX_WEIGHTED_LEN: 100 };
    const y = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
    const localStorage = { setItem() {}, getItem() { return null; } };
    // m_040_6169 原文为模块级函数，isSkuSearchImageUploadEnabled 体内裸调用 → 提升为闭包函数
    const _coerceMovingConfigBool = (e) => !0 === e || 'true' === e || 1 === e || '1' === e;
  `;
  if (missing.length) throw new Error('原版方法抽取失败: ' + missing.join(', '));
  // 外部依赖 stub + 2 个非 8087 方法（m_040_6169 原文抽录，this._coerceMovingConfigBool 改为本地 _coerceMovingConfigBool）
  const glue = `
    // —— 非 8087 方法（m_040_6169 原文）——
    isSkuSearchImageUploadEnabled(e = {}, t = {}) {
      const { allowTmallLegacy: r = !1 } = t;
      const i = e?.movingConfig && 'object' === typeof e.movingConfig ? e.movingConfig : {};
      let n = i.sku_search_img_upload_switch ?? e.sku_search_img_upload_switch ?? i.upload_sku_search_image ?? e.upload_sku_search_image;
      void 0 === n && r && (n = i.tmall_upload_sku_search_image ?? e.tmall_upload_sku_search_image);
      const s = _coerceMovingConfigBool(n);
      return s;
    },
    _coerceMovingConfigBool(e) { return !0 === e || 'true' === e || 1 === e || '1' === e; },
    // —— 纯日志/摘要 stub ——
    _pddHijackPageTrace() {},
    _pddSummarizeEditBody(e) { if (!e || 'object' !== typeof e) return { empty: !0 }; return {}; }
  `;
  const code = prefix + '\nconst engine = {\n' + parts.join(',\n') + ',\n' + glue + '\n};\nreturn engine;';
  return new Function(code)();
}

/* ═══════════ 三、移植引擎组装：标记段提取 → 剥 export → stripTypes → eval ═══════════ */

const tsSrc = fs.readFileSync(SRC_TS, 'utf8');
const BEGIN = '───────────────────────── 常量表';
const END = '───────────────────────── m1：Anti-Content';
const bIdx = tsSrc.indexOf(BEGIN);
const eIdx = tsSrc.indexOf(END);
if (bIdx < 0 || eIdx < 0 || eIdx <= bIdx) throw new Error(`pdd-mode2.ts 标记段未找到 (bIdx=${bIdx}, eIdx=${eIdx})`);
// 常量表标记行往前回退到行首的 /*，从注释行起点截取；m1 标记行也回退到行首，避免截断注释
let segStart = bIdx;
while (segStart > 0 && tsSrc[segStart - 1] !== '\n') segStart--;
let segEnd = eIdx;
while (segEnd > 0 && tsSrc[segEnd - 1] !== '\n') segEnd--;
let seg = tsSrc.slice(segStart, segEnd);
seg = seg.replace(/^export (async )?/gm, '');

// 挑出要暴露的函数名（原版引擎同清单，去掉 _ 前缀差异——移植版全部无前缀）
// logPddSkuStockDecision：原版是空方法体纯日志（保留 this 调用形态但无实现），移植版已省略，EXPOSE 跳过
const EXPOSE = METHOD_LIST.filter(n => n !== 'logPddSkuStockDecision').map(n => n.replace(/^_/, ''));

let out;
try {
  out = await transform('type _Void = void\n' + seg, { loader: 'ts', format: 'cjs' });
} catch (e) {
  throw new Error('esbuild transform 失败: ' + e.message);
}
const jsCode = out.code;
const ported = new Function(jsCode + '\nreturn {\n' + EXPOSE.map(n => `${n}: (typeof ${n} !== 'undefined' ? ${n} : undefined)`).join(',\n') + '\n};')();

const portedMissing = EXPOSE.filter(n => typeof ported[n] !== 'function');
if (portedMissing.length) throw new Error('移植版函数缺失: ' + portedMissing.join(', '));

/* ═══════════ 四、对拍适配：把模块函数包成与原版引擎同名同 this 结构 ═══════════ */
// 原版方法互调用 this.xxx；移植版是模块内直接调用 xxx。
// 组装一个代理对象：this.xxx → ported.xxx；模块内直接引用保持原样。
// 由于移植版内部是直接函数调用（不经过 this），两边只需在顶层入口对拍即可。
const origEngine = buildOrigEngine();

/* ═══════════ 五、断言工具 ═══════════ */

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
    if (JSON.stringify(ka) !== JSON.stringify(kb)) {
      failures.push(`${path}: 键集不同\n  原版: ${JSON.stringify(ka)}\n  移植: ${JSON.stringify(kb)}`);
      return false;
    }
    let ok = true;
    for (const k of ka) if (!deepEq(a[k], b[k], `${path}.${k}`)) ok = false;
    return ok;
  }
  // NaN === NaN（parseFloat('￥29.9元') 两版同返 NaN，应视为相等）
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return true;
  if (a !== b) { failures.push(`${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); return false; }
  return true;
}
function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
function eq(label, a, b) {
  failures.length = 0;
  if (deepEq(a, b)) { passed++; console.log(`  ok ${label}`); }
  else { failed++; console.log(`  FAIL ${label}`); for (const f of failures.slice(0, 12)) console.log(`    ${f}`); }
}

/* ═══════════ 六、黄金用例 ═══════════ */

function clone(x) { return JSON.parse(JSON.stringify(x)); }

// —— 基础 commitBody 骨架（拼多多 goods_commit 常见字段，只放流水线会读写/带走的）——
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
// —— 基础 goodsDetail（移植版 GoodsDetail 真实结构：sku_sort/sku_key/sku_price/movingConfig）——
function baseDetail(over = {}) {
  return {
    goods_id: 'G100',
    goods_url: 'https://yangkeduo.com/goods.html?goods_id=G100',
    sku_sort: ['颜色'],
    sku_key: { '1': ['红色'], '2': ['蓝色'] },
    sku_price: { '1': { price: 19.9, stock: 10 }, '2': { price: 29.9, stock: 20 } },
    movingConfig: {},
    ...over,
  };
}
// —— 提交 SKU：spec 数组形态 [{spec_name}]（collectSpecTextsFromPddSku 七键序之首）——
function sku(texts, over = {}) {
  return { spec: texts.map(t => ({ spec_name: t })), multi_price: 0, price: 0, is_onsale: 1, quantity: 0, ...over };
}

console.log('══ pdd-mode2 差分黄金测试（原版 8087 vs 移植版）══\n');

/* —— G1：无规格商品（sku_sort 空 → fillNoSpecSkuPriceDataInRequest，price_detail.default）—— */
{
  const detail = baseDetail({
    sku_sort: [], sku_key: {}, sku_price: {},
    price_detail: { default: { price: 15.5, stock: 33 } },
  });
  const commit1 = baseCommitBody({ skus: [sku([])] });
  const commit2 = clone(commit1);
  const outO = origEngine.transformRequestBody(clone(commit1), clone(detail));
  const outP = ported.transformRequestBody(clone(commit2), clone(detail));
  eq('G1 无规格商品 commitBody', outO, outP.commitBody);
}

/* —— G2：一维规格（颜色，sku_key/sku_price 直连）—— */
{
  const detail = baseDetail();
  const commit1 = baseCommitBody({ skus: [sku(['红色']), sku(['蓝色'])] });
  const commit2 = clone(commit1);
  const outO = origEngine.transformRequestBody(clone(commit1), clone(detail));
  const outP = ported.transformRequestBody(clone(commit2), clone(detail));
  eq('G2 一维规格 commitBody', outO, outP.commitBody);
}

/* —— G2b：一维规格走 price_detail 表（sku_key/sku_price 为空）—— */
{
  const detail = baseDetail({
    sku_key: {}, sku_price: {},
    price_detail: { '红色': { price: 19.9, stock: 10 }, '蓝色': { price: 29.9, stock: 20 } },
  });
  const commit1 = baseCommitBody({ skus: [sku(['红色']), sku(['蓝色'])] });
  const commit2 = clone(commit1);
  const outO = origEngine.transformRequestBody(clone(commit1), clone(detail));
  const outP = ported.transformRequestBody(clone(commit2), clone(detail));
  eq('G2b price_detail 表 commitBody', outO, outP.commitBody);
}

/* —— G3：二维规格（颜色×尺码）—— */
{
  const detail = baseDetail({
    sku_sort: ['颜色', '尺码'],
    sku_key: { '1': ['红色', 'S'], '2': ['红色', 'M'], '3': ['蓝色', 'M'] },
    sku_price: { '1': { price: 19.9, stock: 5 }, '2': { price: 21.9, stock: 6 }, '3': { price: 29.9, stock: 7 } },
  });
  const commit1 = baseCommitBody({
    skus: [sku(['红色', 'S']), sku(['红色', 'M']), sku(['蓝色', 'M'])],
  });
  const commit2 = clone(commit1);
  const outO = origEngine.transformRequestBody(clone(commit1), clone(detail));
  const outP = ported.transformRequestBody(clone(commit2), clone(detail));
  eq('G3 二维规格 commitBody', outO, outP.commitBody);
}

/* —— G4：匹配失败行清零（价格表只有红蓝，sku 有绿色）—— */
{
  const detail = baseDetail();
  const commit1 = baseCommitBody({ skus: [sku(['红色']), sku(['绿色'])] });
  const commit2 = clone(commit1);
  const outO = origEngine.transformRequestBody(clone(commit1), clone(detail));
  const outP = ported.transformRequestBody(clone(commit2), clone(detail));
  eq('G4 匹配失败清零 commitBody', outO, outP.commitBody);
}

/* —— G5：单买价规则 rule_type=2（加固定元）—— */
{
  const detail = baseDetail({ movingConfig: { pdd_single_buy_rule_type: 2, pdd_single_buy_fixed_yuan: 3 } });
  const commit1 = baseCommitBody({ skus: [sku(['红色']), sku(['蓝色'])] });
  const commit2 = clone(commit1);
  const outO = origEngine.transformRequestBody(clone(commit1), clone(detail));
  const outP = ported.transformRequestBody(clone(commit2), clone(detail));
  eq('G5 单买价 rule_type=2 commitBody', outO, outP.commitBody);
}
/* —— G5b：单买价百分比 —— */
{
  const detail = baseDetail({ movingConfig: { pdd_single_buy_rule_type: 1, pdd_single_buy_percent: 15 } });
  const commit1 = baseCommitBody({ skus: [sku(['红色']), sku(['蓝色'])] });
  const commit2 = clone(commit1);
  const outO = origEngine.transformRequestBody(clone(commit1), clone(detail));
  const outP = ported.transformRequestBody(clone(commit2), clone(detail));
  eq('G5b 单买价百分比 commitBody', outO, outP.commitBody);
}

/* —— G6：运费模板 + 发货时限 + 两件折扣（movingConfig: template/selectTime/sku_multi_discount）—— */
{
  const detail = baseDetail({ movingConfig: { template: 'T1024', selectTime: '48h', sku_multi_discount: 7 } });
  const commit1 = baseCommitBody({ skus: [sku(['红色']), sku(['蓝色'])] });
  const commit2 = clone(commit1);
  const outO = origEngine.transformRequestBody(clone(commit1), clone(detail));
  const outP = ported.transformRequestBody(clone(commit2), clone(detail));
  eq('G6 运费模板+时限 commitBody', outO, outP.commitBody);
}

/* —— G7：thumb 回填（search 模式：sku_search_img_upload_switch + keyPath→sku_stock 桥接）—— */
{
  const detail = baseDetail({
    movingConfig: { sku_search_img_upload_switch: true },
    sku_stock: { '1': { skuId: '501' }, '2': { skuId: '502' } },
    upload_search_img_map: {
      '501': { url: 'https://img.pdd.example/s-red.jpg', id: 'FR1' },
      '502': { url: 'https://img.pdd.example/s-blue.jpg', id: 'FR2' },
    },
  });
  const commit1 = baseCommitBody({ skus: [sku(['红色']), sku(['蓝色'])] });
  const commit2 = clone(commit1);
  const outO = origEngine.transformRequestBody(clone(commit1), clone(detail));
  const outP = ported.transformRequestBody(clone(commit2), clone(detail));
  eq('G7 thumb search 模式 commitBody', outO, outP.commitBody);
}

/* —— G8：thumb 回填（spec_map 模式：mode=1 + sku_img 定维 + upload_spec_img_map）—— */
{
  const detail = baseDetail({
    movingConfig: {},
    sku_img: { '红色': { url: 'https://img.pdd.example/orig-red.jpg' }, '蓝色': { url: 'https://img.pdd.example/orig-blue.jpg' } },
    upload_spec_img_map: {
      '红色': { url: 'https://img.pdd.example/sp-red.jpg', id: 'FS1' },
      '蓝色': { url: 'https://img.pdd.example/sp-blue.jpg', id: 'FS2' },
    },
    specList: [{ name: '颜色', values: [{ name: '红色' }, { name: '蓝色' }] }],
  });
  const commit1 = baseCommitBody({ skus: [sku(['红色']), sku(['蓝色'])] });
  const commit2 = clone(commit1);
  const outO = origEngine.transformRequestBody(clone(commit1), clone(detail));
  const outP = ported.transformRequestBody(clone(commit2), clone(detail));
  eq('G8 thumb spec_map 模式 commitBody', outO, outP.commitBody);
}

/* —— G9：电子凭证 elec_goods_attributes（time_type=3, days_time=15）—— */
{
  const detail = baseDetail({ sku_key: { '1': ['红色'] }, sku_price: { '1': { price: 19.9, stock: 10 } } });
  const commit1 = baseCommitBody({ skus: [sku(['红色'])], elec_goods_attributes: { days: 7 } });
  const commit2 = clone(commit1);
  const outO = origEngine.transformRequestBody(clone(commit1), clone(detail));
  const outP = ported.transformRequestBody(clone(commit2), clone(detail));
  eq('G9 电子凭证 commitBody', outO, outP.commitBody);
}

/* —— G10：商家编码 out_goods_sn（movingConfig.productCode_radio 2/3/4）—— */
for (const [radio, label] of [[2, 'goods_id'], [3, '货号'], [4, 'goods_url']]) {
  const detail = baseDetail({
    movingConfig: { productCode_radio: radio },
    base_attr: { '货号': 'HUO-001' },
  });
  const commit1 = baseCommitBody({ skus: [sku(['红色']), sku(['蓝色'])] });
  const commit2 = clone(commit1);
  const outO = origEngine.transformRequestBody(clone(commit1), clone(detail));
  const outP = ported.transformRequestBody(clone(commit2), clone(detail));
  eq(`G10 商家编码 radio=${radio}(${label}) commitBody`, outO, outP.commitBody);
}

/* —— G11：多维规格（3 维 → findPriceDataForMultiDimensionalSku）—— */
{
  const detail = baseDetail({
    sku_sort: ['颜色', '尺码', '套餐'],
    sku_key: { '1': ['红色', 'S', '标准'], '2': ['蓝色', 'M', '豪华'] },
    sku_price: { '1': { price: 19.9, stock: 10 }, '2': { price: 29.9, stock: 20 } },
  });
  const commit1 = baseCommitBody({ skus: [sku(['红色', 'S', '标准']), sku(['蓝色', 'M', '豪华'])] });
  const commit2 = clone(commit1);
  const outO = origEngine.transformRequestBody(clone(commit1), clone(detail));
  const outP = ported.transformRequestBody(clone(commit2), clone(detail));
  eq('G11 多维规格 commitBody', outO, outP.commitBody);
}

/* —— G12：图片/视频整组替换（gallery/floor_list/preview_url/video_upload）—— */
{
  const detail = baseDetail({
    gallery: [
      { type: 1, img_url: 'https://img.pdd.example/n1.jpg' },
      { type: 1, img_url: 'https://img.pdd.example/n2.jpg' },
    ],
    floor_list: [{ type: 'floor', content: 'x' }],
    preview_url: 'https://img.pdd.example/preview.jpg',
    video_upload: {
      id: 'V9', url: 'https://img.pdd.example/v9.mp4', check_comment: '通过',
      extra_info: { height: 720, width: 1280, video_cover_url: 'https://img.pdd.example/cover.jpg' },
    },
  });
  const commit1 = baseCommitBody({ skus: [sku(['红色'])] });
  const commit2 = clone(commit1);
  const outO = origEngine.transformRequestBody(clone(commit1), clone(detail));
  const outP = ported.transformRequestBody(clone(commit2), clone(detail));
  eq('G12 图片视频替换 commitBody', outO, outP.commitBody);
}

/* —— G13：自定义库存（stock_mode=2 + movingConfig.inventory）—— */
{
  const detail = baseDetail({ movingConfig: { stock_mode: 2, inventory: 66 } });
  const commit1 = baseCommitBody({ skus: [sku(['红色']), sku(['蓝色'])] });
  const commit2 = clone(commit1);
  const outO = origEngine.transformRequestBody(clone(commit1), clone(detail));
  const outP = ported.transformRequestBody(clone(commit2), clone(detail));
  eq('G13 自定义库存 commitBody', outO, outP.commitBody);
}

/* —— G14：行码占位模式（全部 spec 文本为纯数字 → 按 orderedKeys 顺序填价）—— */
{
  const detail = baseDetail({
    sku_key: { '1': ['01'], '2': ['02'] },
    sku_price: { '1': { price: 19.9, stock: 10 }, '2': { price: 29.9, stock: 20 } },
  });
  const commit1 = baseCommitBody({ skus: [sku(['01']), sku(['02'])] });
  const commit2 = clone(commit1);
  const outO = origEngine.transformRequestBody(clone(commit1), clone(detail));
  const outP = ported.transformRequestBody(clone(commit2), clone(detail));
  eq('G14 行码占位模式 commitBody', outO, outP.commitBody);
}

/* —— G15：合并单规格（一维 sku 文本 = 二维键行拼接「红色 S」）—— */
{
  const detail = baseDetail({
    sku_sort: ['颜色', '尺码'],
    sku_key: { '1': ['红色', 'S'], '2': ['蓝色', 'M'] },
    sku_price: { '1': { price: 19.9, stock: 5 }, '2': { price: 29.9, stock: 7 } },
  });
  const commit1 = baseCommitBody({ skus: [sku(['红色 S']), sku(['蓝色/M'])] });
  const commit2 = clone(commit1);
  const outO = origEngine.transformRequestBody(clone(commit1), clone(detail));
  const outP = ported.transformRequestBody(clone(commit2), clone(detail));
  eq('G15 合并单规格 commitBody', outO, outP.commitBody);
}

/* —— G16：单 SKU 兜底（只有 1 个有价键，spec 乱写也兜底命中）—— */
{
  const detail = baseDetail({
    sku_key: { '1': ['红色'] },
    sku_price: { '1': { price: 25.5, stock: 8 } },
  });
  const commit1 = baseCommitBody({ skus: [sku(['不知名规格'])] });
  const commit2 = clone(commit1);
  const outO = origEngine.transformRequestBody(clone(commit1), clone(detail));
  const outP = ported.transformRequestBody(clone(commit2), clone(detail));
  eq('G16 单 SKU 兜底 commitBody', outO, outP.commitBody);
}

/* —— 纯函数直拍 —— */
eq('P1 sanitizePddSpecWhitelist "红×色 M①"', origEngine.sanitizePddSpecWhitelist('红×色 M①'), ported.sanitizePddSpecWhitelist('红×色 M①'));
eq('P2 sanitizePddSpecWhitelist null', origEngine.sanitizePddSpecWhitelist(null), ported.sanitizePddSpecWhitelist(null));
eq('P3 truncatePddSpecLikePlatform 超长', origEngine.truncatePddSpecLikePlatform('红'.repeat(25) + ' 4' + 'x'.repeat(30)), ported.truncatePddSpecLikePlatform('红'.repeat(25) + ' 4' + 'x'.repeat(30)));
eq('P4 canonicalizePddSpecValue', origEngine.canonicalizePddSpecValue('红色 XL ╳'), ported.canonicalizePddSpecValue('红色 XL ╳'));
eq('P5 cleanSkuMatchKey', origEngine.cleanSkuMatchKey(' 红 色 '), ported.cleanSkuMatchKey(' 红 色 '));
eq('P6 fuzzyMatch', origEngine.fuzzyMatch('红色XXL', '红色'), ported.fuzzyMatch('红色XXL', '红色'));
eq('P7 computePddSingleBuyYuan fixed', origEngine.computePddSingleBuyYuan(19.9, { pdd_single_buy_rule_type: 2, pdd_single_buy_fixed_yuan: 1 }), ported.computePddSingleBuyYuan(19.9, { pdd_single_buy_rule_type: 2, pdd_single_buy_fixed_yuan: 1 }));
eq('P8 computePddSingleBuyYuan pct', origEngine.computePddSingleBuyYuan(19.9, { pdd_single_buy_rule_type: 1, pdd_single_buy_percent: 20 }), ported.computePddSingleBuyYuan(19.9, { pdd_single_buy_rule_type: 1, pdd_single_buy_percent: 20 }));
eq('P9 priceToFenAndYuan', origEngine.priceToFenAndYuan(19.9), ported.priceToFenAndYuan(19.9));
eq('P10 extractPrice 字符串', origEngine.extractPrice('￥29.9元'), ported.extractPrice('￥29.9元'));
eq('P11 getChineseEnglishLength', origEngine.getChineseEnglishLength('红色red'), ported.getChineseEnglishLength('红色red'));
eq('P12 truncateByChineseEnglishLength', origEngine.truncateByChineseEnglishLength('红色red1234567890123456789012345678901234567890123456789012345678901234567890123456789', 100), ported.truncateByChineseEnglishLength('红色red1234567890123456789012345678901234567890123456789012345678901234567890123456789', 100));
eq('P13 getPddStockMode 默认', origEngine.getPddStockMode({}), ported.getPddStockMode({}));
eq('P13b getPddStockMode mode2', origEngine.getPddStockMode({ movingConfig: { stock_mode: 2 } }), ported.getPddStockMode({ movingConfig: { stock_mode: 2 } }));
eq('P14 specTextsLookLikeRowCodePlaceholders', origEngine.specTextsLookLikeRowCodePlaceholders(['S', 'M']), ported.specTextsLookLikeRowCodePlaceholders(['S', 'M']));
eq('P14b specTextsLookLikeRowCodePlaceholders 数字', origEngine.specTextsLookLikeRowCodePlaceholders(['01', '02']), ported.specTextsLookLikeRowCodePlaceholders(['01', '02']));
eq('P15 isEmptyPriceDetailTable 空', origEngine.isEmptyPriceDetailTable({}), ported.isEmptyPriceDetailTable({}));
eq('P15b isEmptyPriceDetailTable 非空', origEngine.isEmptyPriceDetailTable({ '红色': { price: 19.9 } }), ported.isEmptyPriceDetailTable({ '红色': { price: 19.9 } }));
eq('P16 collectSpecTextsFromPddSku 七键序', origEngine.collectSpecTextsFromPddSku({ spec: [{ spec_name: '红色' }, { value: 'XL' }, { label: '套餐A' }] }), ported.collectSpecTextsFromPddSku({ spec: [{ spec_name: '红色' }, { value: 'XL' }, { label: '套餐A' }] }));
eq('P17 resolveSafePddOutGoodsSn radio3', origEngine.resolveSafePddOutGoodsSn({ goods_id: 'G1', base_attr: { '货号': 'HUO-9' } }, { productCode_radio: 3 }), ported.resolveSafePddOutGoodsSn({ goods_id: 'G1', base_attr: { '货号': 'HUO-9' } }, { productCode_radio: 3 }));
eq('P18 resolveNoSpecPriceRecord', origEngine.resolveNoSpecPriceRecord({ price_detail: { default: { price: 9.9, stock: 3 } } }), ported.resolveNoSpecPriceRecord({ price_detail: { default: { price: 9.9, stock: 3 } } }));
eq('P19 applyResolvedStockToCommitSku', (() => { const a = { quantity: 5 }; const r1 = origEngine.applyResolvedStockToCommitSku(a, 0); return [a, r1]; })(), (() => { const b = { quantity: 5 }; const r2 = ported.applyResolvedStockToCommitSku(b, 0); return [b, r2]; })());

console.log(`\n══ 结果: ${passed} passed, ${failed} failed ══`);
process.exit(failed > 0 ? 1 : 0);

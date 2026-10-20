// 从 8087 原文按清单抽取全部方法，拼装原版引擎并 smoke：transformRequestBody 跑一维用例
import fs from 'node:fs';

const ORIG = fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/rea-gm-modules/m_042_8087.js', 'utf8');

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
        return ORIG.slice(idx, bodyEnd + 1);
      }
      idx += full.length;
    }
  }
  return null;
}

const METHOD_LIST = [
  'transformRequestBody', 'fillImageData', 'fillSkuPriceData', 'fillShippingConfig',
  'applyPddElecGoodsAttributes', 'fillNoSpecSkuPriceDataInRequest',
  '_applyPddSkuThumbUrlToCommitSku', '_resolvePddSkuIdKeyForThumb', '_resolvePddSkuKeyPathForThumb',
  '_resolvePddSearchSkuIdFromSkuListForThumb', '_bridgePddSearchSkuIdFromKeyPath',
  '_findPddSkuListRowByKeyPathOrSkuId', '_resolvePddSpecThumbFromUploadMap',
  '_resolvePddSpecImageDimIndex', '_scorePddThumbSpecRowMatch', '_pickBestPddSpecCandidateForThumb',
  '_pickUniqueBestThumbScoredId', '_matchPddSpecValueStrictForThumb', '_matchPddSizeSpecValueForThumb',
  '_isPddThumbSizeDimension', '_isPddLikelySizeSpecValue', '_normalizePddSizeSpecToken',
  '_extractPddLeadingSizeCodeForThumb', '_isPddUsableSkuId', 'isColorLikeSpecTypeName',
  '_getEffectivePddSkuImageMode',
  'sanitizePddSpecWhitelist', 'cleanSpecName', 'canonicalizePddSpecValue', 'truncatePddSpecLikePlatform',
  'cleanSkuMatchKey', 'fuzzyMatch', 'dimMatchSkuToSpec',
  'normalizeSkuPriceRecord', 'isSkuPriceLeaf', 'pickSingleNestedPriceLeaf', 'collectSpecTextsFromPddSku',
  'computePddSingleBuyYuan', 'extractPrice', 'priceToFenAndYuan', 'applyPddMarketReferencePrice',
  'getPddStockMode', 'getPddCustomInventory', '_peekStockFromPriceData', '_readExplicitStockNumber',
  'extractStock', 'applyResolvedStockToCommitSku', 'resolveSkuStockForFill', 'logPddSkuStockDecision',
  'getOrderedSkuKeyIdsWithPrice', 'specTextsLookLikeRowCodePlaceholders', 'buildStablePriceDetailForFill',
  'isEmptyPriceDetailTable', 'findPriceDataByPublishedSpec', 'findTwoDimPriceByCombinedSingleSpec',
  'findTwoDimPriceByFirstDimOrdinal', 'findTwoDimPriceFromSkuMatrixUnordered',
  'fuzzyMatchPriceDetailLeafOnly', 'fuzzyMatchKey', 'findPriceDataForSkuFuzzy',
  'findPriceDataForMultiDimensionalSku', 'resolveSingleSkuPriceFallback',
  'resolveSafePddOutGoodsSn', 'getChineseEnglishLength', 'truncateByChineseEnglishLength',
  'resolveNoSpecPriceRecord', 'resolveNoSpecStock',
];

const parts = [];
const missing = [];
for (const name of METHOD_LIST) {
  const def = findMethodDef(name);
  if (!def) { missing.push(name); continue; }
  parts.push(def);
}
console.log('抽取:', parts.length, '/', METHOD_LIST.length, '缺失:', missing.join(',') || '无');

const prefix = `
  const S = { PDD_SPEC_MAX_JS_LEN: 40, PDD_OUT_GOODS_SN_MAX_WEIGHTED_LEN: 100 };
  const y = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
  const localStorage = { setItem() {}, getItem() { return null; } };
`;
const glue = `
  isSkuSearchImageUploadEnabled(e = {}, t = {}) {
    const mc = e?.movingConfig && typeof e.movingConfig === 'object' ? e.movingConfig : {};
    const v = mc.sku_search_img_upload_switch ?? e.sku_search_img_upload_switch
      ?? mc.upload_sku_search_image ?? e.upload_sku_search_image;
    return v === true || v === 'true' || v === 1 || v === '1';
  },
  _coerceMovingConfigBool(e) { return true === e || 'true' === e || 1 === e || '1' === e; },
  _pddHijackPageTrace() {},
  _pddSummarizeEditBody(e) { if (!e || 'object' !== typeof e) return { empty: !0 }; return {}; }
`;
const code = prefix + '\nconst engine = {\n' + parts.join(',\n') + ',\n' + glue + '\n};\nreturn engine;';
let engine;
try {
  engine = new Function(code)();
} catch (e) {
  console.log('引擎组装失败:', e.message);
  // dump 失败定位
  process.exit(1);
}
console.log('引擎组装成功，方法数:', Object.keys(engine).length);

// smoke：一维规格
const detail = {
  goods_id: 'G100',
  sku_sort: ['颜色'],
  sku_key: { '1': ['红色'], '2': ['蓝色'] },
  sku_price: { '1': { price: 19.9, stock: 10 }, '2': { price: 29.9, stock: 20 } },
  movingConfig: {},
};
const commitBody = {
  goods_name: '测试商品',
  gallery: [{ type: 1, img_url: 'https://img.pdd.example/g1.jpg' }],
  skus: [
    { spec: [{ spec_name: '红色' }], multi_price: 0, price: 0, is_onsale: 1, quantity: 0 },
    { spec: [{ spec_name: '蓝色' }], multi_price: 0, price: 0, is_onsale: 1, quantity: 0 },
  ],
};
try {
  const out = engine.transformRequestBody(JSON.parse(JSON.stringify(commitBody)), JSON.parse(JSON.stringify(detail)));
  console.log('smoke out:', JSON.stringify(out, null, 2));
} catch (e) {
  console.log('smoke 失败:', e.stack);
}

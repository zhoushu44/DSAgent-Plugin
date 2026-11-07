/**
 * 浏览器指纹多样化（每账号一套，取自比特浏览器 18 套预制 WebGL 模板）。
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要（2026-10-28 用户反馈：2 个号经常被风控）
 * ══════════════════════════════════════════════════════════════════
 * 多账号共用同一套机器指纹 = 平台一眼看出"这些号是同一台机器"。
 * WebGL 参数（getParameter 的 78 项）是最硬的机器标识之一：
 * 同一张显卡 + 同一驱动 → 所有账号返回值完全相同。
 *
 * ══════════════════════════════════════════════════════════════════
 * 方案来源（比特浏览器逆向，见 artifacts/_archive/bitbrowser-re/）
 * ══════════════════════════════════════════════════════════════════
 * 比特不用随机生成，而是**预制 18 套真实设备的完整参数集**：
 *   Win32×5 / Linux x86_64×4 / Linux armv81×4 / MacIntel×4 / iPhone×1
 *
 * ★ 为什么不随机生成：随机值会产生"真实硬件不可能的组合"
 *   （如 MAX_TEXTURE_SIZE=16384 但 MAX_VERTEX_ATTRIBS=8），反而更可疑。
 *   **自洽 = 整套参数来自同一台真实设备的采样**。
 *
 * ══════════════════════════════════════════════════════════════════
 * 关键设计：同账号必须稳定
 * ══════════════════════════════════════════════════════════════════
 *   · 同一 shopKey → 永远同一套模板（按 shopKey hash 选，不随机）
 *   · 不同 shopKey → 不同模板
 * 如果每次启动都换，"指纹漂移"本身就是异常信号。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE_FILE = path.resolve(HERE, '../../artifacts/_archive/bitbrowser-re/WebGLParameters.json')

/** 18 套预制模板（懒加载，读不到就返回 null 走降级） */
let _templates = null
function templates() {
  if (_templates !== null) return _templates
  try {
    _templates = JSON.parse(fs.readFileSync(TEMPLATE_FILE, 'utf8'))
  } catch {
    _templates = null
  }
  return _templates
}

/**
 * 为账号选一套 WebGL 指纹模板（稳定：同 shopKey 永远同一套）
 * @param {string} shopKey
 * @returns {{ id: string, os: string, parameters: object } | null}
 */
export function pickWebGLTemplate(shopKey) {
  const tpl = templates()
  if (!tpl) return null
  const ids = Object.keys(tpl).sort()
  if (!ids.length) return null
  // ★ 用 shopKey 的稳定 hash 选模板 —— 不用 Math.random（那会让同账号指纹漂移）
  const h = createHash('sha1').update(String(shopKey || 'default')).digest('hex')
  const idx = parseInt(h.slice(0, 8), 16) % ids.length
  const id = ids[idx]
  const t = tpl[id]
  if (!t || !t.Parameters) return null
  return { id, os: t.os, parameters: t.Parameters }
}

/**
 * WebGL 常量名 → 数值（pname）映射。
 *
 * ★ 为什么需要：`getParameter(pname)` 的 pname 是**数字**（如 MAX_TEXTURE_SIZE=0x0D33=3379），
 *   而模板的 key 是**字符串**（"MAX_TEXTURE_SIZE"）。注入脚本若用 `String(pname)` 查表
 *   得到 "3379"，永远匹配不上 —— 实测踩过：hook 函数确实被替换了，
 *   但返回值全是原生值（只有恰好相等的才对得上）。
 */
const GL_ENUM = {
  ACTIVE_TEXTURE: 33984, ALIASED_LINE_WIDTH_RANGE: 33946, ALIASED_POINT_SIZE_RANGE: 33901,
  ALPHA_BITS: 3413, ALPHA_TEST_FUNC: 3009, ALPHA_TEST_REF: 3010,
  BLEND: 3042, BLEND_COLOR: 32773, BLEND_DST_ALPHA: 32970, BLEND_DST_RGB: 32968,
  BLEND_EQUATION: 32777, BLEND_EQUATION_ALPHA: 34877, BLEND_EQUATION_RGB: 32777,
  BLEND_SRC_ALPHA: 32971, BLEND_SRC_RGB: 32969, BLUE_BITS: 3412,
  COLOR_CLEAR_VALUE: 3106, COLOR_BUFFER_BIT: 16384, COLOR_WRITEMASK: 3107,
  COMPRESSED_TEXTURE_FORMATS: 34467, CULL_FACE: 2884, CULL_FACE_MODE: 2885,
  CURRENT_PROGRAM: 35725, DEPTH_BITS: 3414, DEPTH_CLEAR_VALUE: 2931, DEPTH_FUNC: 2932,
  DEPTH_RANGE: 2928, DEPTH_TEST: 2929, DEPTH_WRITEMASK: 2930, DITHER: 3024,
  FRONT_FACE: 2886, GENERATE_MIPMAP_HINT: 33170, GREEN_BITS: 3411,
  IMPLEMENTATION_COLOR_READ_FORMAT: 35739, IMPLEMENTATION_COLOR_READ_TYPE: 35738,
  LINE_WIDTH: 2849, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 35661,
  MAX_CUBE_MAP_TEXTURE_SIZE: 34076, MAX_FRAGMENT_UNIFORM_VECTORS: 36349,
  MAX_RENDERBUFFER_SIZE: 34024, MAX_TEXTURE_IMAGE_UNITS: 34930,
  MAX_TEXTURE_SIZE: 3379, MAX_VARYING_VECTORS: 36348, MAX_VERTEX_ATTRIBS: 34921,
  MAX_VERTEX_TEXTURE_IMAGE_UNITS: 35660, MAX_VERTEX_UNIFORM_VECTORS: 36347,
  MAX_VIEWPORT_DIMS: 3386, PACK_ALIGNMENT: 3333, POLYGON_OFFSET_FACTOR: 32824,
  POLYGON_OFFSET_FILL: 32823, POLYGON_OFFSET_UNITS: 10752, RED_BITS: 3410,
  SAMPLE_BUFFERS: 32936, SAMPLE_COVERAGE_INVERT: 32939, SAMPLE_COVERAGE_VALUE: 32938,
  SAMPLES: 32937, SCISSOR_BOX: 3088, SCISSOR_TEST: 3089, STENCIL_BACK_FAIL: 34817,
  STENCIL_BACK_FUNC: 34816, STENCIL_BACK_PASS_DEPTH_FAIL: 34818,
  STENCIL_BACK_PASS_DEPTH_PASS: 34819, STENCIL_BACK_REF: 36003,
  STENCIL_BACK_VALUE_MASK: 36005, STENCIL_BACK_WRITEMASK: 36004, STENCIL_BITS: 3415,
  STENCIL_CLEAR_VALUE: 2966, STENCIL_FAIL: 2964, STENCIL_FUNC: 2962,
  STENCIL_PASS_DEPTH_FAIL: 2965, STENCIL_PASS_DEPTH_PASS: 2967, STENCIL_REF: 2967,
  STENCIL_TEST: 2960, STENCIL_VALUE_MASK: 2963, STENCIL_WRITEMASK: 2968,
  SUBPIXEL_BITS: 3408, UNPACK_ALIGNMENT: 3317,
  UNPACK_COLORSPACE_CONVERSION_WEBGL: 37443, UNPACK_FLIP_Y_WEBGL: 37440,
  UNPACK_PREMULTIPLY_ALPHA_WEBGL: 37441, VIEWPORT: 2978,
  VERSION: 7938, RENDERER: 7937, VENDOR: 7936, SHADING_LANGUAGE_VERSION: 35724,
}

/**
 * 生成 WebGL 指纹注入脚本（按账号）
 *
 * 注入点：page.evaluateOnNewDocument（与 STEALTH_SCRIPT 一起）
 * 做法：hook WebGLRenderingContext.prototype.getParameter，
 *       对模板里有的参数返回模板值，其余走原生实现。
 *
 * ★ 为什么不整体替换 getContext：那会让 canvas 完全不可用，
 *   且 `getContext('webgl')` 返回的对象原型对不上更容易露馅。
 *   只 hook getParameter 覆盖面足够（指纹采集就是调 getParameter）。
 */
export function webglFingerprintScript(shopKey) {
  const t = pickWebGLTemplate(shopKey)
  if (!t) return ''   // 模板缺失 → 不注入（降级为原生指纹）

  // 只序列化数值/数组类参数，避免把函数等不可序列化东西带进去
  const params = {}
  for (const [k, v] of Object.entries(t.parameters)) {
    if (v === null || v === undefined) continue
    if (typeof v === 'object') {
      if (v.type && Array.isArray(v.value)) { params[k] = { type: v.type, value: v.value }; continue }
      continue
    }
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') params[k] = v
  }

  // ★ 把「常量名 → 数值」表里**模板中存在的项**转成「数值 → 值」，
  //   这样注入脚本里用数字 pname 直接查表。
  const byPname = {}
  for (const [name, val] of Object.entries(params)) {
    const pname = GL_ENUM[name]
    if (pname === undefined) continue
    byPname[pname] = val
  }

  return `
(function () {
  'use strict';
  var BY_PNAME = ${JSON.stringify(byPname)};
  var COUNT = Object.keys(BY_PNAME).length;
  if (!COUNT) return;
  function hook(proto) {
    if (!proto || !proto.getParameter) return;
    var orig = proto.getParameter;
    proto.getParameter = function (pname) {
      var key = String(pname);
      if (Object.prototype.hasOwnProperty.call(BY_PNAME, key)) {
        var v = BY_PNAME[key];
        // 数组型参数要还原成对应 TypedArray（平台会检查 .length / 索引）
        if (v && typeof v === 'object' && v.type && Array.isArray(v.value)) {
          try { return new window[v.type](v.value); } catch (e) { return v.value; }
        }
        return v;
      }
      return orig.call(this, pname);
    };
  }
  try {
    hook(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype);
    // WebGL2 一起覆盖（很多检测优先用 webgl2）
    hook(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype);
  } catch (e) { /* 静默：指纹注入失败不应阻断业务 */ }
})();
`;
}

/**
 * 账号的语言/时区配置（来自比特 Lang 映射表，56 条）
 * 用途：navigator.languages 按账号区分，不再全账号硬编码同一值。
 */
const LANG_MAP = {
  'zh-CN': ['zh-CN', 'zh'],
  'zh-TW': ['zh-TW', 'zh', 'en-US', 'en'],
  'en-US': ['en-US', 'en'],
  'ja-JP': ['ja-JP', 'ja', 'en'],
  'ko-KR': ['ko-KR', 'ko', 'en'],
  'de-DE': ['de-DE', 'de', 'en-US', 'en'],
  'fr-FR': ['fr-FR', 'fr', 'en'],
  'es-ES': ['es-ES', 'es', 'en-US', 'en'],
  'ru-RU': ['ru-RU', 'ru', 'en-US', 'en'],
  'pt-BR': ['pt-BR', 'pt', 'en'],
  'th-TH': ['th-TH', 'th', 'en-US', 'en'],
  'vi-VN': ['vi-VN', 'vi', 'en'],
  'id-ID': ['id-ID', 'id', 'en'],
}

/**
 * 为账号选语言（稳定）
 * @param {string} shopKey
 * @returns {string[]} navigator.languages 的值
 */
export function pickLanguages(shopKey) {
  // ★ 国内电商账号默认中文，但**不同账号允许不同中文变体**，
  //   避免所有账号 languages 完全一致。
  //   将来接代理后，应按 IP 地理位置选（比特的做法）。
  const variants = ['zh-CN', 'zh-CN', 'zh-CN', 'zh-TW']   // 加权：多数仍为简体
  const h = createHash('sha1').update('lang:' + String(shopKey || 'default')).digest('hex')
  const idx = parseInt(h.slice(0, 8), 16) % variants.length
  const key = variants[idx]
  return LANG_MAP[key] || LANG_MAP['zh-CN']
}

/** 导出供测试/诊断 */
export function fingerprintDebug(shopKey) {
  const t = pickWebGLTemplate(shopKey)
  return {
    shopKey,
    webglTemplateId: t ? t.id : null,
    webglOs: t ? t.os : null,
    webglParamCount: t ? Object.keys(t.parameters).length : 0,
    languages: pickLanguages(shopKey),
    templateFileExists: fs.existsSync(TEMPLATE_FILE),
  }
}

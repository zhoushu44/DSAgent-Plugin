/**
 * step10.mjs — 拼多多上架 步骤 10
 * 组件依赖：见 modules/ 目录（由另一个 agent 维护）
 */
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(__dirname, '..', '..', '..')
const ORIGIN = 'https://mms.pinduoduo.com'
const LIST_URL = ORIGIN + '/goods/goods_list'
const sleep = ms => new Promise(r => setTimeout(r, ms))

const MOD = path.join(__dirname, '..', 'modules')
async function loadModules() {
  const load = (p) => import(pathToFileURL(path.join(MOD, p)).href)
  return {
    M: await load('01-image-upload/index.mjs'),
    F: await load('02-form-input/index.mjs'),
    B: await load('03-button/index.mjs'),
    S: await load('04-select/index.mjs'),
    R: await load('05-radio/index.mjs'),
    T: await load('06-sku-thumb/index.mjs'),
    A: await load('07-attributes/index.mjs'),
  }
}
// ═══════════════════════════════════════════════════════════════════
//  步骤 10：商品详情图（商详图）
//     位置：id="detail_pic"
//     计数：快捷编辑「已上传 N/50 张」
//     input 标识：detail_img_localfile_upload
//     上限 50 张，只支持图片
// ═══════════════════════════════════════════════════════════════════
export async function step10_uploadDetailImages(page, opts = {}) {
  const { M } = await loadModules()
  return M.uploadImages(page, {
    target: 'detail',
    files: opts.files || [],
    timeoutMs: opts.timeoutMs ?? 180000,
    onProgress: opts.onProgress,
  })
}

/**
 * 读商详图计数（「已上传 N/50 张」）
 */
export async function readDetailImageCount(page) {
  return page.evaluate(() => {
    const box = document.querySelector('#detail_pic')
    if (!box) return { found: false, got: 0, max: 0, text: '' }
    const el = box.querySelector('[class*="quick_decoration_v2_num"], [class*="num__"]')
    const text = el ? (el.innerText || '').replace(/\s+/g, '') : ''
    const m = text.match(/(\d+)\/(\d+)张?/)
    return {
      found: !!m,
      got: m ? Number(m[1]) : 0,
      max: m ? Number(m[2]) : 50,
      text,
    }
  }).catch(() => ({ found: false, got: 0, max: 0, text: '' }))
}

export default step10_uploadDetailImages







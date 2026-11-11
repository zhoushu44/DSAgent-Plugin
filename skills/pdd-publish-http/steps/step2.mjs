/**
 * step2.mjs — 拼多多上架 步骤 2
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
//  步骤 2：上传商品主图（1~10 张）
// ═══════════════════════════════════════════════════════════════════
export async function step2_uploadMainImages(page, opts = {}) {
  const { M } = await loadModules()
  return M.uploadImages(page, {
    target: 'carousel-step1',
    files: opts.files || [],
    timeoutMs: opts.timeoutMs ?? 120000,
    onProgress: opts.onProgress,
  })
}

export default step2_uploadMainImages







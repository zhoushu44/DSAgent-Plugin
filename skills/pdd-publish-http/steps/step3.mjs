/**
 * step3.mjs — 拼多多上架 步骤 3
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
//  步骤 3：填写商品标题（≤30 汉字）
// ═══════════════════════════════════════════════════════════════════
export async function step3_fillTitle(page, opts = {}) {
  const title = String(opts.title ?? '')
  // 本地先校验
  const cjk = (title.match(/[\u4e00-\u9fa5]/g) || []).length
  if (!title.trim()) return { ok: false, error: '标题为空', cjk: 0 }
  if (cjk > 30) return { ok: false, error: `汉字 ${cjk} 个，超过 30`, cjk }
  if (title.length > 60) return { ok: false, error: `字符 ${title.length} 个，超过 60`, cjk }

  const { F } = await loadModules()
  return F.fillInput(page, {
    placeholder: '商品标题组成',
    value: title,
    verify: true,
    timeoutMs: 15000,
  })
}

export default step3_fillTitle







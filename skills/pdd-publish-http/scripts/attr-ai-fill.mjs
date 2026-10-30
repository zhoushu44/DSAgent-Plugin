/**
 * 发布组件 · 属性 AI 一键填充（attr-ai-fill.mjs）
 *
 * ★ 2026-10-30 用户要求：
 *   「把属性表格和产品图片发给 AI，返回 JSON 数据就可以了，对话一次」
 *   只有**用户没给属性**时才走这条路；用户给了就用用户的。
 *
 *   做法：
 *     ① 截图属性区（含所有下拉）+ 商品主图
 *     ② 发给视觉模型（cn:glm-5v-turbo），附标题和类目
 *     ③ 让它返回 {属性名: 值} 的 JSON
 *     ④ 按 JSON 填（JS setter 优先，真实鼠标兜底）
 *
 *   对比旧方式：
 *     旧：每个属性开下拉 → 读候选 → AI 选 → 点选（N 次对话，N 次下拉）
 *     新：一次截图 + 一次对话 → 返回全部属性 JSON → 按 JSON 填（1 次对话）
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PY = process.env.PYTHON || 'C:/Users/Administrator/AppData/Local/Programs/Python/Python313/python.exe'
const ANALYZER = path.join(HERE, 'analyze_spec_ui.py')
const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * 一次截图 + 一次对话 → 返回全部属性的 JSON
 *
 * @param page 表单页
 * @param product { title, category, images }
 * @param opts { log? }
 * @returns { ok, attrs: {name: value}, raw }
 */
export async function analyzeAttrsByVision(page, product, opts = {}) {
  const log = opts.log || (() => {})
  const tmp = path.join(process.env.TEMP || '/tmp', `attrai_${Date.now()}.png`)

  // ① 截图属性区（滚到属性区顶部再截全视口）
  await page.evaluate(() => {
    const box = document.querySelector('#property, .goods-propertys, [id^="basic.propertys"]')
    if (box) box.scrollIntoView({ block: 'start' })
  }).catch(() => {})
  await sleep(900)
  await page.screenshot({ path: tmp }).catch(() => {})
  if (!fs.existsSync(tmp)) {
    return { ok: false, error: 'screenshot failed' }
  }
  log(`[attr-ai] 已截图 ${Math.round(fs.statSync(tmp).size / 1024)}KB`)

  // ② 商品主图（第一张）
  const mainImg = (product.images || [])[0]
  const imgB64 = mainImg && fs.existsSync(mainImg)
    ? fs.readFileSync(mainImg).toString('base64') : ''

  // ③ 构造 prompt：属性区截图 + 主图 + 标题 + 类目 → 返回 JSON
  const prompt = `这是拼多多商品发布页的「商品属性」区域截图，以及商品主图。

商品标题：${product.title || ''}
商品类目：${product.category || ''}

请观察截图和主图，为**所有可见的属性字段**挑选最合适的值。

要求（只输出 JSON，不要任何解释）：
{
  "属性名1": "选中的值（必须是截图里下拉的候选之一）",
  "属性名2": "选中的值",
  ...
}

规则：
1. 只填截图里**真实存在**的属性，不要编造属性名
2. 每个属性的值**必须**是该属性下拉框里的候选值之一（从截图里能看到的候选）
3. 优先选与标题、主图、类目最匹配的值
4. 如果某个属性明显应该留空（比如"商品资质"），可以省略不填
5. 材质成分/面料材质这类，根据主图和标题判断（如"棉""聚酯纤维""莫代尔"）
6. 风格/图案这类，根据主图判断（如"纯色""卡通""条纹"）
7. 产地默认"中国大陆"
8. 适用性别默认"通用"（除非是明显的男装/女装/童装）

只输出 JSON。`

  const pyCode = [
    'import sys, json, base64, urllib.request, ssl',
    'from pathlib import Path',
    'sys.path.insert(0, r"E:\\360MoveData\\Users\\Administrator\\Desktop\\aiimgnew1")',
    'from imgkit import BASE, KEY',
    'ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE',
    `img = Path(${JSON.stringify(tmp)})`,
    'b64 = base64.b64encode(img.read_bytes()).decode()',
    `prompt = ${JSON.stringify(prompt)}`,
    'content = [{"type":"text","text":prompt}]',
    'content.append({"type":"image_url","image_url":{"url":f"data:image/png;base64,{b64}"}})',
    imgB64 ? `content.append({"type":"image_url","image_url":{"url":"data:image/jpeg;base64,${imgB64}"}})` : '',
    'payload = {"model":"cn:glm-5v-turbo","messages":[{"role":"user","content":content}],"temperature":0.1}',
    'req = urllib.request.Request(f"{BASE}/chat/completions", data=json.dumps(payload).encode(), method="POST",',
    '    headers={"Authorization":f"Bearer {KEY}","Content-Type":"application/json"})',
    'with urllib.request.urlopen(req, timeout=120, context=ctx) as r: j = json.loads(r.read().decode())',
    'print(j["choices"][0]["message"]["content"].strip())',
  ].filter(Boolean).join('\n')

  let out = ''
  try {
    out = execFileSync(PY, ['-c', pyCode], {
      encoding: 'utf8', timeout: 150000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
  } catch (e) {
    return { ok: false, error: `AI call failed: ${(e.message || '').slice(0, 120)}` }
  } finally {
    try { fs.unlinkSync(tmp) } catch { /* ignore */ }
  }

  // ④ 抠 JSON
  const raw = String(out).trim()
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return { ok: false, error: 'no json', raw: raw.slice(0, 300) }
  try {
    const attrs = JSON.parse(m[0])
    log(`[attr-ai] AI 返回 ${Object.keys(attrs).length} 个属性`)
    return { ok: true, attrs, raw }
  } catch (e) {
    return { ok: false, error: `json parse: ${e.message}`, raw: raw.slice(0, 300) }
  }
}

/**
 * 按 AI 返回的 JSON 填属性
 *
 * @param page
 * @param attrs {name: value}
 * @param opts { log? }
 * @returns { filled: string[], missed: string[] }
 */
export async function fillAttrsByAI(page, attrs, opts = {}) {
  const log = opts.log || (() => {})
  const filled = []
  const missed = []

  for (const [name, value] of Object.entries(attrs || {})) {
    if (!value) continue

    // ① 找该属性的下拉并打开
    const opened = await page.evaluate((attrName) => {
      const norm = s => String(s || '').replace(/\s+/g, '')
      const items = [...document.querySelectorAll('.property-item, [id^="basic.propertys."]')]
      for (const it of items) {
        const label = (it.querySelector('label')?.innerText || it.innerText || '').replace(/重要|必填|[*＊]/g, '').trim()
        if (!label || !norm(label).includes(norm(attrName))) continue
        const inp = it.querySelector('input[data-testid="beast-core-select-htmlInput"]')
        if (!inp) continue
        const head = it.querySelector('[data-testid="beast-core-select-header"]') || inp
        head.scrollIntoView({ block: 'center' })
        for (const ev of ['mousedown', 'mouseup', 'click']) {
          head.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window }))
        }
        return true
      }
      return false
    }, name).catch(() => false)

    if (!opened) {
      missed.push(`${name}（未找到下拉）`)
      continue
    }
    await sleep(700)

    // ② 读候选并点选
    const clicked = await page.evaluate((want) => {
      const panels = [...document.querySelectorAll('[class*="dropdownPanel"], [class*="dropdownMain"]')]
        .filter(p => p.offsetParent !== null)
      const panel = panels[panels.length - 1]
      if (!panel) return false
      const nodes = [...panel.querySelectorAll('li, [role="option"], [class*="ST_item"]')]
      const hit = nodes.find(n => (n.innerText || '').trim() === want)
        || nodes.find(n => (n.innerText || '').includes(want) || want.includes((n.innerText || '').trim()))
      if (!hit) return false
      const r = hit.getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    }, value).catch(() => null)

    if (clicked) {
      await page.mouse.click(clicked.x, clicked.y).catch(() => {})
      await sleep(500)
      // 校验
      const confirmed = await page.evaluate((attrName, want) => {
        const norm = s => String(s || '').replace(/\s+/g, '')
        const items = [...document.querySelectorAll('.property-item, [id^="basic.propertys."]')]
        for (const it of items) {
          const label = (it.querySelector('label')?.innerText || it.innerText || '').replace(/重要|必填|[*＊]/g, '').trim()
          if (!label || !norm(label).includes(norm(attrName))) continue
          const inp = it.querySelector('input[data-testid="beast-core-select-htmlInput"]')
          if (inp && norm(inp.value).includes(norm(want))) return true
          if (norm(it.innerText).includes(norm(want))) return true
        }
        return false
      }, name, value).catch(() => false)

      if (confirmed) filled.push(`${name}=${value}`)
      else missed.push(`${name}（点选后未确认）`)
    } else {
      missed.push(`${name}（候选里没有「${value}」）`)
    }

    await page.keyboard.press('Escape').catch(() => {})
    await sleep(300)
  }

  log(`[attr-ai] 已填 ${filled.length} 项，未填 ${missed.length} 项`)
  return { filled, missed }
}

/**
 * 完整流程：分析 + 填写（用户没给属性时才走）
 *
 * @param page
 * @param product { title, category, images, attributes? }
 * @param opts { log? }
 * @returns { filled: string[], missed: string[], aiAttrs }
 */
export async function fillAttrsWithAI(page, product, opts = {}) {
  const log = opts.log || (() => {})

  // ★ 用户给了属性就用用户的，不走 AI
  if (product.attributes?.length) {
    log('[attr-ai] 用户已提供属性，不走 AI')
    return { filled: [], missed: [], aiAttrs: null, skipped: true }
  }

  // ★ 2026-10-30 优化：查视觉缓存（同类目第 2 单起直接用，省 8s）
  try {
    const { getVisionCache, setVisionCache, bumpVisionHit } = await import('./vision-cache.mjs')
    const cached = getVisionCache(product.category || '', '__attrs__')
    if (cached?.attrs && Object.keys(cached.attrs).length) {
      log(`[attr-ai] 命中属性缓存 ${Object.keys(cached.attrs).length} 条（已用 ${cached.hitCount || 0} 次）`)
      bumpVisionHit(product.category || '', '__attrs__')
      const r = await fillAttrsByAI(page, cached.attrs, opts)
      return { ...r, aiAttrs: cached.attrs, fromCache: true }
    }
  } catch { /* ignore */ }

  const analysis = await analyzeAttrsByVision(page, product, opts)
  if (!analysis.ok) {
    log(`[attr-ai] 分析失败：${analysis.error}`)
    return { filled: [], missed: [`AI 分析失败：${analysis.error}`], aiAttrs: null }
  }

  const r = await fillAttrsByAI(page, analysis.attrs, opts)

  // 存缓存
  if (analysis.attrs && Object.keys(analysis.attrs).length) {
    try {
      const { setVisionCache } = await import('./vision-cache.mjs')
      setVisionCache(product.category || '', '__attrs__', {
        dim_type: 'attrs',
        strategy: 'json',
        element_hints: [],
        confidence: 'medium',
        attrs: analysis.attrs,
      })
    } catch { /* ignore */ }
  }

  return { ...r, aiAttrs: analysis.attrs }
}

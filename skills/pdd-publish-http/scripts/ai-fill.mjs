/**
 * AI 辅助规格填写 v2 —— DOM 文本判断，不截图。
 *
 * 用户给的 XPath 锚点：
 *   规格区根：//*[@id="goods-spec-sku"]
 *   添加规格类型按钮：//*[@id="newSpec"]/div[2]/div/div/div/div[4]/button/div
 *   SKU 表：//*[@id="sku"]
 *
 * 思路（不用视觉）：
 *   ① DOM dump 规格区结构（维度名 + 每个输入框的 placeholder/value/索引）
 *   ② 文本喂给 GLM 文本模型，让它判断该填哪个输入框
 *   ③ 按返回索引用真实键盘填
 *
 * 为什么比纯选择器稳：
 *   · 新建维度的空框/已填框混在一起，AI 看全量列表判断
 *   · 类目间结构差异（有的预置 2 维、有的 0 维）
 *   · 不用等 vision 模型看图，快 10 倍
 */
import { execFileSync } from 'node:child_process'
import * as path from 'node:path'

const SPEC_ROOT = '#goods-spec-sku'
const SKU_ROOT = '#sku'
const NEW_SPEC_BTN_XPATH = '//*[@id="newSpec"]/div[2]/div/div/div/div[4]/button/div'
const PY = 'C:/Users/Administrator/AppData/Local/Programs/Python/Python313/python.exe'
const IMGKIT_DIR = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/pajama'
const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 调 GLM 文本模型（非视觉，快） */
function askText(prompt) {
  const code = [
    'import sys, json, urllib.request, ssl',
    `sys.path.insert(0, ${JSON.stringify(IMGKIT_DIR)})`,
    'ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE',
    'from imgkit import BASE, KEY',
    'payload = {"model": "glm-4-flash", "messages":[{"role":"user","content":' + JSON.stringify(prompt) + '}], "temperature":0.1}',
    'req = urllib.request.Request(f"{BASE}/chat/completions", data=json.dumps(payload).encode(), method="POST",',
    '    headers={"Authorization":f"Bearer {KEY}","Content-Type":"application/json"})',
    'with urllib.request.urlopen(req, timeout=60, context=ctx) as r: j = json.loads(r.read().decode())',
    'print(j["choices"][0]["message"]["content"].strip())',
  ].join('\n')
  const out = execFileSync(PY, ['-c', code], {
    encoding: 'utf8', timeout: 90000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })
  return out.trim()
}

/**
 * DOM dump：规格区所有维度 + 输入框（不用图）。
 */
async function dumpSpecDom(page) {
  await page.evaluate(sel => {
    document.querySelector(sel)?.scrollIntoView({ block: 'start' })
  }, SPEC_ROOT)
  await sleep(400)

  return page.evaluate((sel, skuSel) => {
    const root = document.querySelector(sel)
    if (!root) return { dims: [], boxes: [], skuRows: 0 }

    const dims = []
    const boxes = []
    // ★ 两种容器：.property-container-v2（预置）+ .goods-spec-row（新建）
    const containers = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')]
    containers.forEach((c, ci) => {
      const typeVal = c.querySelector('input[placeholder^="规格类型"]')?.value?.trim()
        || c.querySelector('.property-name-title')?.textContent?.trim()
        || c.querySelector('.sizeStandardWrapper_title__7s9I-')?.textContent?.trim()
        || ('dim' + ci)
      const cbCount = [...c.querySelectorAll('.package-item-container')].length
      dims.push({ idx: ci, name: typeVal, cbCount })

      c.querySelectorAll('input').forEach(e => {
        const ph = e.placeholder || ''
        const r = e.getBoundingClientRect()
        if (r.width < 30 || r.height < 12 || ph.startsWith('规格类型')) return
        boxes.push({
          dimIdx: ci,
          dim: typeVal,
          ph,
          val: e.value || '',
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
        })
      })
    })

    let skuRows = 0
    const skuRoot = document.querySelector(skuSel)
    if (skuRoot) {
      for (const tb of skuRoot.querySelectorAll('table')) {
        const heads = [...tb.querySelectorAll('thead th')].map(th => th.textContent.trim())
        if (heads.some(h => /拼单价/.test(h))) { skuRows = tb.querySelectorAll('tbody tr').length; break }
      }
    }
    return { dims, boxes, skuRows }
  }, SPEC_ROOT, SKU_ROOT)
}

/**
 * AI 判断该填哪个框。返回 boxIndex 或 null。
 */
export async function aiPickBox(state, dimName, value) {
  if (!state.boxes.length) return null

  const boxesText = state.boxes
    .map((b, i) => `${i}. 维度=${b.dim} placeholder="${b.ph}" 当前值="${b.val}"`)
    .join('\n')

  const prompt = [
    '拼多多商品规格区域，以下是所有输入框：',
    boxesText,
    '',
    `任务：把「${value}」填进「${dimName}」维度的规格值输入框。`,
    '规则：',
    '1. 只选目标维度的输入框',
    '2. 优先选当前值为空的',
    '3. 不要选「规格类型」下拉框和备注框',
    '4. 如果目标维度没有空框，选该维度最后一个输入框',
    '5. 如果目标维度不在列表里，返回 -1',
    '',
    '只回复一个数字（输入框序号），不要任何解释。',
  ].join('\n')

  try {
    const txt = await askText(prompt)
    const m = txt.match(/-?\d+/)
    if (!m) return null
    const idx = parseInt(m[0], 10)
    if (idx < 0 || idx >= state.boxes.length) return null
    // 校验：AI 选的框必须属于目标维度
    const box = state.boxes[idx]
    if (box.dim !== dimName && !box.dim.includes(dimName) && !dimName.includes(box.dim)) return null
    return idx
  } catch (e) {
    console.log('[ai-fill] 文本模型调用失败: ' + (e?.message || e))
    return null
  }
}

/**
 * 用 XPath 点「添加规格类型」按钮（用户给的锚点）。
 */
export async function clickAddSpecType(page) {
  return page.evaluate(xpath => {
    const r = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
    const el = r.singleNodeValue
    if (!el) return false
    el.scrollIntoView({ block: 'center' })
    el.click()
    return true
  }, NEW_SPEC_BTN_XPATH)
}

/**
 * AI 辅助填一个维度的所有值。
 */
export async function aiFillDim(page, dimName, values, opts = {}) {
  const log = []
  for (let i = 0; i < values.length; i++) {
    const val = values[i]
    const state = await dumpSpecDom(page)
    if (!state.boxes.length) { log.push({ v: val, ok: false, via: 'no-boxes' }); continue }

    const idx = await aiPickBox(state, dimName, val)
    if (idx === null) { log.push({ v: val, ok: false, via: 'ai-null' }); continue }
    const box = state.boxes[idx]

    // 滚到目标框 → 重取坐标 → 点击
    const pos = await page.evaluate((bx, by, bw, bh) => {
      for (const el of [...document.querySelectorAll('#goods-spec-sku input')]) {
        const r = el.getBoundingClientRect()
        if (Math.abs(r.x - bx) < 40 && Math.abs(r.y - by) < 40 && Math.abs(r.width - bw) < 40) {
          el.scrollIntoView({ block: 'center' })
          break
        }
      }
      return null
    }, box.x, box.y, box.w, box.h)
    await sleep(500)

    const pos2 = await page.evaluate((bx, by, bw, bh) => {
      for (const el of [...document.querySelectorAll('#goods-spec-sku input')]) {
        const r = el.getBoundingClientRect()
        if (Math.abs(r.x - bx) < 40 && Math.abs(r.y - by) < 40 && Math.abs(r.width - bw) < 40) {
          return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
        }
      }
      return null
    }, box.x, box.y, box.w, box.h)
    if (!pos2) { log.push({ v: val, ok: false, via: 'no-pos' }); continue }

    await page.mouse.click(pos2.x, pos2.y)
    await sleep(500)
    await page.keyboard.type(val, { delay: 40 })
    await sleep(400)
    await page.keyboard.press('Enter')
    await sleep(1500)
    await page.mouse.click(30, 300)
    await sleep(1000)

    // 回读
    const state2 = await dumpSpecDom(page)
    const filled = state2.boxes.some(b => b.val === val)
    log.push({ v: val, ok: filled, via: 'ai' })
  }
  return log
}

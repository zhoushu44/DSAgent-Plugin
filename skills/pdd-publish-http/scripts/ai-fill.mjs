/**
 * AI 辅助规格填写 —— 用 glm-5v-turbo 看页面截图，决定填哪个框、点哪里。
 *
 * 思路：
 *   ① puppeteer 截图规格区 + dump DOM 文本（每个输入框的 placeholder/value/y）
 *   ② 一起喂给 vision 模型
 *   ③ 模型返回：该填的输入框索引 + 理由
 *   ④ 按返回结果用真实键盘填
 *
 * 解决纯选择器搞不定的情况：
 *   · 新建维度的空框/已填框混在一起
 *   · 页面结构类目间有差异
 *   · React 重渲染后坐标漂移
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'

const SPEC_ROOT = '#goods-spec-sku'
const PY = 'C:/Users/Administrator/AppData/Local/Programs/Python/Python313/python.exe'
const IMGKIT = 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/pajama/imgkit.py'
const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 调 glm-5v-turbo */
function askVision(imagePath, prompt) {
  const code = [
    'import sys, json',
    `sys.path.insert(0, ${JSON.stringify(path.dirname(IMGKIT))})`,
    'from imgkit import vision',
    'from pathlib import Path',
    `r = vision([Path(${JSON.stringify(imagePath)})], ${JSON.stringify(prompt)})`,
    'print(json.dumps(r, ensure_ascii=False))',
  ].join('\n')
  const out = execFileSync(PY, ['-c', code], {
    encoding: 'utf8',
    timeout: 240000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })
  return JSON.parse(out.trim().split('\n').pop())
}

/** 截图规格区 + dump 输入框列表 */
async function captureSpecState(page, shotPath) {
  // ★ 先把规格区滚到视口内（否则 getBoundingClientRect 返回负 y，框被滤掉）
  await page.evaluate(sel => {
    document.querySelector(sel)?.scrollIntoView({ block: 'start' })
  }, SPEC_ROOT)
  await sleep(600)

  const dims = await page.evaluate(sel => {
    const root = document.querySelector(sel)
    if (!root) return { boxes: [], dims: [], skuRows: 0 }
    const boxes = []
    const dims = []
    const containers = [...root.querySelectorAll('.property-container-v2'), ...root.querySelectorAll('.goods-spec-row')]
    containers.forEach((c, ci) => {
      const typeVal = c.querySelector('input[placeholder^="规格类型"]')?.value?.trim()
        || c.querySelector('.property-name-title')?.textContent?.trim()
        || c.querySelector('.sizeStandardWrapper_title__7s9I-')?.textContent?.trim() || ('dim' + ci)
      dims.push({ idx: ci, name: typeVal })
      c.querySelectorAll('input').forEach(e => {
        const ph = e.placeholder || ''
        const r = e.getBoundingClientRect()
        // ★ 只过滤宽高，不过滤 y（滚动后 y 可能为负但框仍在 DOM）
        if (r.width < 30 || r.height < 12 || ph.startsWith('规格类型')) return
        boxes.push({
          dimIdx: ci, dim: typeVal, ph, val: e.value || '',
          y: Math.round(r.y), x: Math.round(r.x),
          w: Math.round(r.width), h: Math.round(r.height),
        })
      })
    })
    // SKU 表行数
    let skuRows = 0
    for (const tb of root.querySelectorAll('#sku table')) {
      const heads = [...tb.querySelectorAll('thead th')].map(th => th.textContent.trim())
      if (heads.some(h => /拼单价/.test(h))) { skuRows = tb.querySelectorAll('tbody tr').length; break }
    }
    return { boxes, dims, skuRows }
  }, SPEC_ROOT)

  // 截图（规格区可见部分）
  await page.screenshot({ path: shotPath, clip: await page.evaluate(sel => {
    const r = document.querySelector(sel)?.getBoundingClientRect()
    if (!r || r.height < 50) return undefined
    return {
      x: Math.max(0, Math.min(r.x, 1900)),
      y: Math.max(0, Math.min(r.y, 900)),
      width: Math.min(1900, Math.max(r.width, 200)),
      height: Math.min(880, Math.max(r.height, 200)),
    }
  }, SPEC_ROOT) })
  return dims
}

/**
 * AI 决策：给页面状态 + 要填的值，返回该点哪个输入框。
 *
 * @returns {{boxIndex: number, reason: string} | null}
 */
export async function aiPickBox(page, state, imagePath, dimName, value) {
  const boxesText = state.boxes
    .map((b, i) => `${i}. [${b.dim}] ph="${b.ph}" val="${b.val}" @(${b.x},${b.y}) ${b.w}x${b.h}`)
    .join('\n')

  const prompt = [
    '这是拼多多商品发布页的规格区域截图。下面是页面里所有输入框的列表（索引/所属维度/placeholder/当前值/坐标）。',
    '',
    '【输入框列表】',
    boxesText,
    '',
    `【任务】我要把「${value}」填进「${dimName}」维度的规格值输入框。`,
    '',
    '请告诉我应该点哪个输入框（返回列表中的索引序号）。规则：',
    '1. 必须属于目标维度的输入框',
    '2. 优先选当前值为空的输入框',
    '3. 不要选「规格类型」下拉框、不要选备注框',
    '4. 如果目标维度的空框填满了，选该维度最后一个输入框',
    '',
    '只返回 JSON：{"boxIndex": 序号, "reason": "一句话理由"}',
  ].join('\n')

  try {
    const r = await askVision(imagePath, prompt)
    // ★ 容错解析：模型可能返回 JSON 也可能返回带解释的文本
    let idx = -1
    if (typeof r?.boxIndex === 'number') idx = r.boxIndex
    else if (typeof r?.boxIndex === 'string' && /^\d+$/.test(r.boxIndex.trim())) idx = parseInt(r.boxIndex.trim(), 10)
    else if (r?.raw) {
      const m = String(r.raw).match(/boxIndex["\s:：]+(\d+)/)
      if (m) idx = parseInt(m[1], 10)
      else {
        const m2 = String(r.raw).match(/^\s*\{?\s*"?(\d+)"?\s*\}?/)
        if (m2) idx = parseInt(m2[1], 10)
      }
    }
    if (idx >= 0 && idx < state.boxes.length) {
      return { boxIndex: idx, reason: r.reason || '' }
    }
    console.log('[ai-fill] vision 未返回有效 boxIndex: ' + JSON.stringify(r).slice(0, 300))
    return null
  } catch (e) {
    console.log('[ai-fill] vision 调用失败: ' + (e?.message || e))
    return null
  }
}

/**
 * AI 辅助填一个维度的所有值。
 */
export async function aiFillDim(page, dimIdx, dimName, values, opts = {}) {
  const shotDir = opts.shotDir || 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/pajama/ai_shots'
  fs.mkdirSync(shotDir, { recursive: true })
  const log = []

  for (let i = 0; i < values.length; i++) {
    const val = values[i]
    const shot = path.join(shotDir, `${dimName}_${i}_${Date.now()}.png`)

    // 截当前状态
    const state = await captureSpecState(page, shot)

    // AI 决策
    const pick = await aiPickBox(page, state, shot, dimName, val)
    if (!pick) {
      log.push({ v: val, ok: false, via: 'ai-fail' })
      continue
    }
    const box = state.boxes[pick.boxIndex]
    if (!box) { log.push({ v: val, ok: false, via: 'no-box' }); continue }

    // ★ 点击前把目标框滚到视口中央，重新取坐标（滚动后原坐标可能已失效）
    const freshPos = await page.evaluate((bx, by, bw, bh) => {
      const els = [...document.querySelectorAll('#goods-spec-sku input')]
        for (const el of els) {
          const r = el.getBoundingClientRect()
          if (Math.abs(r.x - bx) < 40 && Math.abs(r.y - by) < 40 && Math.abs(r.width - bw) < 40) {
            el.scrollIntoView({ block: 'center' })
            return true
          }
        }
        return false
    }, box.x, box.y, box.w, box.h)
    await sleep(500)

    const pos2 = freshPos ? await page.evaluate((bx, by, bw, bh) => {
      for (const el of [...document.querySelectorAll('#goods-spec-sku input')]) {
        const r = el.getBoundingClientRect()
        if (Math.abs(r.x - bx) < 40 && Math.abs(r.y - by) < 40 && Math.abs(r.width - bw) < 40) {
          return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
        }
      }
      return null
    }, box.x, box.y, box.w, box.h) : null

    const cx = pos2 ? pos2.x : box.x + box.w / 2
    const cy = pos2 ? pos2.y : box.y + box.h / 2
    await page.mouse.click(Math.round(cx), Math.round(cy))
    await sleep(500)
    await page.keyboard.type(val, { delay: 40 })
    await sleep(400)
    await page.keyboard.press('Enter')
    await sleep(1500)
    // 点空白失焦
    await page.mouse.click(30, 300)
    await sleep(1000)

    // 回读：按坐标附近的输入框取值（页面重渲染后容器顺序可能变，坐标不变）
    const state2 = await captureSpecState(page, path.join(shotDir, `${dimName}_${i}_after.png`))
    let filled = false
    for (const b of state2.boxes) {
      if (Math.abs(b.x - box.x) < 60 && Math.abs(b.y - box.y) < 60) {
        if (b.val === val) { filled = true; break }
      }
    }
    // 兜底：任何框有这个值也算成功
    if (!filled) filled = state2.boxes.some(b => b.val === val)
    log.push({ v: val, ok: filled, via: 'ai', reason: pick.reason })
  }
  return log
}

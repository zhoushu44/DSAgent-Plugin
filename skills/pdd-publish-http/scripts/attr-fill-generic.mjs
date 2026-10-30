/**
 * 发布组件 · 属性填写（通用版 v3，基于真机验证）
 *
 * ★★ 2026-10-30 真机定论 ★★
 *
 *   拼多多属性区结构：
 *     <div class="property-item">
 *       <label>适用场景</label>
 *       <div id="basic.propertys.2.value">
 *         <div data-testid="beast-core-select-header">
 *           <input data-testid="beast-core-select-htmlInput">
 *         </div>
 *       </div>
 *     </div>
 *
 *   两种控件类型（必须区分！）：
 *     ① **单选下拉**：点选项后自动关闭，`input.value` 被写入 → 用 inputValue 校验
 *     ② **多选下拉**：点选项后**面板不关闭**，`input.value` 仍为空，
 *        但 **box.innerText 里会显示已选值** → 用 boxText 校验
 *
 *   ✗ 之前只校验 inputValue → 多选全部误报「未确认」
 *   ✓ 正确判据：inputValue 或 boxText 任一包含目标值
 *
 *   填法：
 *     ① 找字段：从 [id^="basic.propertys."] 往上找 label（最内层、长度<=15）
 *     ② 开下拉：header mousedown/mouseup/click（JS 事件，React 认）
 *     ③ 点选项：**真实鼠标坐标点击**（JS click 对选项无效）
 *     ④ 校验：inputValue 或 boxText 包含目标值
 *     ⑤ 关闭：Escape
 */

const sleep = ms => new Promise(r => setTimeout(r, ms))

/** 找某个属性字段的 box id（支持模糊：字段名互相包含） */
async function findFieldBoxId(page, fieldName) {
  return page.evaluate((name) => {
    const norm = s => String(s || '').replace(/\s+/g, '')
    const root = document.querySelector('#property') || document.querySelector('.goods-propertys')
    if (!root) return ''
    const all = []
    for (const box of root.querySelectorAll('[id^="basic.propertys."]')) {
      // ★ 2026-10-30：与 harvestAttributes 用**完全一致**的 label 提取逻辑
      let label = ''
      const ownLabel = box.querySelector('label')
      if (ownLabel) {
        label = (ownLabel.innerText || '').replace(/重要|必填|[*＊]/g, '').trim()
      }
      if (!label) {
        let cur = box
        for (let d = 0; d < 8 && cur; d++) {
          const item = cur.closest('.property-item') || cur.parentElement
          if (item) {
            for (const lb of [...item.querySelectorAll('label')]) {
              if (lb.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING) {
                const t = (lb.innerText || '').replace(/重要|必填|[*＊]/g, '').trim()
                if (t && t.length <= 15) { label = t; break }
              }
            }
            if (label) break
          }
          cur = cur.parentElement
        }
      }
      if (!label) continue
      all.push({ id: box.id, label })
    }
    const n = norm(name)
    // ① 精确 ② 包含
    let hit = all.find(a => norm(a.label) === n)
    if (!hit) hit = all.find(a => norm(a.label).includes(n) || n.includes(norm(a.label)))
    return hit?.id || ''
  }, fieldName).catch(() => '')
}

/** 打开下拉 */
async function openDropdown(page, boxId) {
  return page.evaluate((id) => {
    const box = document.getElementById(id)
    if (!box) return false
    const head = box.querySelector('[data-testid="beast-core-select-header"]')
      || box.querySelector('input[data-testid="beast-core-select-htmlInput"]')
    if (!head) return false
    head.scrollIntoView({ block: 'center' })
    for (const ev of ['mousedown', 'mouseup', 'click']) {
      head.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window }))
    }
    return true
  }, boxId).catch(() => false)
}

/** 读当前面板选项 */
async function readOptions(page) {
  return page.evaluate(() => {
    const panels = [...document.querySelectorAll('[class*="dropdownPanel"], [class*="dropdownMain"], [class*="PP_popover"]')]
      .filter(x => x.offsetParent !== null)
    const panel = panels[panels.length - 1]
    if (!panel) return []
    const out = []
    const seen = new Set()
    for (const n of panel.querySelectorAll('li, [role="option"], [class*="ST_item"]')) {
      const t = (n.innerText || '').trim()
      if (!t || seen.has(t) || t.length > 40) continue
      seen.add(t)
      out.push(t)
    }
    return out
  }).catch(() => [])
}

/** 点某个选项（真实鼠标） */
async function clickOption(page, want) {
  const pos = await page.evaluate((w) => {
    const panels = [...document.querySelectorAll('[class*="dropdownPanel"], [class*="dropdownMain"], [class*="PP_popover"]')]
      .filter(x => x.offsetParent !== null)
    const panel = panels[panels.length - 1]
    if (!panel) return null
    const norm = s => String(s || '').replace(/\s+/g, '').trim()
    const nodes = [...panel.querySelectorAll('li, [role="option"], [class*="ST_item"]')]
      .filter(n => (n.innerText || '').trim())

    // ★ 严格顺序：精确 > 去空格精确 > 短候选优先的包含匹配
    //   （避免「纸」匹配到「纸+PE膜」这种更长的候选）
    const W = norm(w)
    let hit = nodes.find(n => (n.innerText || '').trim() === w)
    if (!hit) hit = nodes.find(n => norm(n.innerText) === W)
    if (!hit) {
      // 包含匹配时，**优先最短的候选**（「纸」比「纸+PE膜」更贴近用户想选的）
      const cands = nodes
        .filter(n => {
          const t = norm(n.innerText)
          return t.includes(W) || W.includes(t)
        })
        .sort((a, b) => norm(a.innerText).length - norm(b.innerText).length)
      hit = cands[0]
    }
    if (!hit) return null

    hit.scrollIntoView({ block: 'center' })
    const r = hit.getBoundingClientRect()
    if (r.width < 5) return null
    return {
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
      text: (hit.innerText || '').trim(),
    }
  }, want).catch(() => null)

  if (!pos) return false
  await page.mouse.click(pos.x, pos.y)
  await sleep(800)
  return pos.text   // 返回实际点中的文本
}

/** 校验：inputValue 或 boxText 任一包含目标值 */
async function verifyField(page, boxId, want) {
  return page.evaluate((id, w) => {
    const box = document.getElementById(id)
    if (!box) return { ok: false, inputValue: '', boxText: '' }
    const inp = box.querySelector('input[data-testid="beast-core-select-htmlInput"]')
    const inputValue = inp?.value || ''
    const boxText = (box.innerText || '').replace(/\n/g, '|')
    return {
      ok: inputValue.includes(w) || boxText.includes(w),
      inputValue,
      boxText: boxText.slice(0, 200),
    }
  }, boxId, want).catch(() => ({ ok: false, inputValue: '', boxText: '' }))
}

/**
 * 检查某个字段是否已填（任意值，不要求特定值）
 *
 * ★ 2026-10-30 用户指出：带「重要」标记的是必填，必须逐项复核。
 *
 * 判据：
 *   · input.value 有值 → 已填
 *   · 或 box.innerText 里除了字段名之外还有内容（说明选中了值）
 *
 * @param page
 * @param boxId
 * @returns { filled: boolean, value: string, boxText: string }
 */
export async function checkFieldFilled(page, boxId) {
  return page.evaluate((id) => {
    const box = document.getElementById(id)
    if (!box) return { filled: false, value: '', boxText: '' }
    const inp = box.querySelector('input[data-testid="beast-core-select-htmlInput"]')
    const inputValue = (inp?.value || '').trim()
    const boxText = (box.innerText || '').replace(/\n/g, '|').trim()

    // 拿字段名（label）
    let label = ''
    let cur = box
    for (let d = 0; d < 6 && cur; d++) {
      const lb = cur.querySelector('label')
      if (lb) {
        const t = (lb.innerText || '').replace(/重要|必填|[*＊]/g, '').trim()
        if (t && t.length <= 15) { label = t; break }
      }
      cur = cur.parentElement
    }

    // ★ 2026-10-30 关键修复（第二次）：把**提示文字**全部剔除
    //   实测误判：`✅ 平方克重 = 重要`（label 提取带了空格，split 没命中）
    //   现在改成：不去 split label，而是**直接把所有提示词从整段文本里剔掉**，
    //   再判断剩下有没有实质内容。
    let rest = boxText
      .replace(/重要|必填|[*＊]/g, '')
      .replace(/请选择|请输入|搜索|点击申请|未找到需要的品牌/g, '')
      .replace(/请确保该商品中含有所选材质/g, '')
      .replace(/填写率|请准确填写属性[^|]*/g, '')
      .replace(/[|｜]/g, '')
      .replace(/[\s？?。，,、：:；;！!…]+/g, '')   // ★ 标点也剔掉（避免「？」被当成值）
      .trim()

    // 再剔除字段名本身（用去空格的字段名去匹配）
    if (label) {
      const labelNorm = label.replace(/\s+/g, '')
      if (labelNorm) rest = rest.split(labelNorm).join('')
    }

    // 只有 inputValue 有值，或 rest 里还有实质内容
    const filled = !!inputValue || rest.length >= 1
    return {
      filled,
      value: inputValue || rest,
      boxText: boxText.slice(0, 120),
      label,
      rest,
    }
  }, boxId).catch(() => ({ filled: false, value: '', boxText: '' }))
}

/**
 * 采集所有属性字段 + 候选值
 *
 * @param page
 * @param opts { log? }
 * @returns { fields: [{ name, id, required, options }] }
 */
export async function harvestAttributes(page, opts = {}) {
  const log = opts.log || (() => {})

  // ★ 2026-10-30：属性区是**异步渲染**的（规格填完后才陆续出现）。
  //   实测坑：流程里只检测到 7 个字段，单独测试却有 8 个 —— 第 8 个出现得更晚。
  //   三步确保全部渲染：
  //     ① 滚到属性区顶部 → 底部 → 再回顶部（强制触发懒渲染）
  //     ② 等「数量连续 4 次不变」且总等待 >= 3 秒
  //     ③ 再补一次 1.5 秒静置
  await page.evaluate(() => {
    const root = document.querySelector('#property') || document.querySelector('.goods-propertys')
    if (!root) return
    root.scrollIntoView({ block: 'start' })
    window.scrollBy(0, 400)
  }).catch(() => {})
  await sleep(600)
  await page.evaluate(() => window.scrollBy(0, 800)).catch(() => {})
  await sleep(600)
  await page.evaluate(() => {
    const root = document.querySelector('#property') || document.querySelector('.goods-propertys')
    if (root) root.scrollIntoView({ block: 'start' })
  }).catch(() => {})
  await sleep(600)

  let lastCount = 0
  let stable = 0
  const t0 = Date.now()
  for (let w = 0; w < 40; w++) {
    const cnt = await page.evaluate(() => {
      const root = document.querySelector('#property') || document.querySelector('.goods-propertys')
      return root ? root.querySelectorAll('[id^="basic.propertys."]').length : 0
    }).catch(() => 0)
    if (cnt > 0 && cnt === lastCount) {
      stable++
      // ★ 连续 4 次不变 **且** 已等 >=3 秒才认为稳定
      if (stable >= 4 && Date.now() - t0 >= 3000) break
    } else {
      stable = 0
    }
    lastCount = cnt
    await sleep(500)
  }
  await sleep(1500)
  log(`[attr] 属性区渲染稳定：${lastCount} 个字段`)

  // ① 列出所有字段
  //   ★ 2026-10-30 关键修复：不能只扫 [id^="basic.propertys."]，
  //     因为属性区是异步渲染的，某些字段（如「适用型号」）的 box 出现得晚。
  //     改成扫**所有 property-item**，每个 item 里找 select 控件。
  const fields = await page.evaluate(() => {
    const root = document.querySelector('#property') || document.querySelector('.goods-propertys')
    if (!root) return []

    const out = []
    const seen = new Set()

    // ── 路径 A：所有带 basic.propertys 的 box ──
    for (const box of root.querySelectorAll('[id^="basic.propertys."]')) {
      if (seen.has(box.id)) continue
      let label = ''
      let required = false

      const ownLabel = box.querySelector('label')
      if (ownLabel) {
        label = (ownLabel.innerText || '').replace(/重要|必填|[*＊]/g, '').trim()
        if (/重要|必填|[*＊]/.test(ownLabel.innerText || '')) required = true
      }
      if (!label) {
        let cur = box
        for (let d = 0; d < 8 && cur; d++) {
          const item = cur.closest('.property-item') || cur.parentElement
          if (item) {
            for (const lb of [...item.querySelectorAll('label')]) {
              if (lb.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING) {
                const t = (lb.innerText || '').replace(/重要|必填|[*＊]/g, '').trim()
                if (t && t.length <= 15) {
                  label = t
                  if (/重要|必填|[*＊]/.test(lb.innerText || '')) required = true
                  break
                }
              }
            }
            if (label) break
          }
          cur = cur.parentElement
        }
      }
      if (!label) continue
      if (!required) {
        const itemText = (box.closest('.property-item')?.innerText || '').slice(0, 100)
        if (/重要|必填/.test(itemText)) required = true
      }
      seen.add(box.id)
      out.push({
        name: label,
        id: box.id,
        required,
        hasSelect: !!box.querySelector('input[data-testid="beast-core-select-htmlInput"]'),
      })
    }

    // ── 路径 B：补齐「有 label 但 box 还没 id」的字段 ──
    const labels = [...root.querySelectorAll('label')]
    for (const lb of labels) {
      const raw = (lb.innerText || '').trim()
      if (!raw || raw.length > 20) continue
      const name = raw.replace(/重要|必填|[*＊]/g, '').trim()
      if (!name) continue
      if (out.some(f => f.name === name)) continue

      // 找该 label 后面最近的 select
      const item = lb.closest('.property-item') || lb.parentElement?.parentElement
      if (!item) continue
      const box = item.querySelector('[id^="basic.propertys."]')
        || [...item.querySelectorAll('div[id]')].find(d => d.querySelector('input[data-testid="beast-core-select-htmlInput"]'))
      if (!box) continue
      if (seen.has(box.id)) continue
      seen.add(box.id)
      out.push({
        name,
        id: box.id || '',
        required: /重要|必填|[*＊]/.test(raw) || /重要|必填/.test((item.innerText || '').slice(0, 100)),
        hasSelect: !!box.querySelector('input[data-testid="beast-core-select-htmlInput"]'),
      })
    }

    return out
  }).catch(() => [])

  const reqCount = fields.filter(f => f.required).length
  log(`[attr] 发现 ${fields.length} 个属性字段，其中**必填（重要）${reqCount} 个**`)
  fields.forEach(f => {
    if (f.required) log(`[attr]   ★必填「${f.name}」`)
  })

  // ② 逐个读候选
  for (const f of fields) {
    if (!f.hasSelect) continue
    if (!(await openDropdown(page, f.id))) { f.options = []; continue }
    await sleep(800)
    f.options = await readOptions(page)
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(250)
    log(`[attr] 「${f.name}」${f.options.length} 个候选`)
  }

  return { fields }
}

/**
 * 用 AI 从**已采集的真实候选**里为每个字段挑一个值
 *
 * ★ 2026-10-30：用户没给全属性时，不能留空。
 *   用文本模型（快、便宜）从页面真实候选中选，不是凭空编。
 *
 * @param page
 * @param fields harvestAttributes() 的输出（含 options）
 * @param product { title, category }
 * @param opts { log?, skip?: string[] }
 * @returns { [fieldName]: value }
 */
export async function pickAttrValuesByAI(page, fields, product, opts = {}) {
  const log = opts.log || (() => {})
  const skip = new Set((opts.skip || []).map(s => String(s || '').replace(/\s+/g, '')))
  const { execFileSync } = await import('node:child_process')
  const PY = process.env.PYTHON || 'C:/Users/Administrator/AppData/Local/Programs/Python/Python313/python.exe'

  const todo = (fields || [])
    .filter(f => f.options?.length && !skip.has(String(f.name).replace(/\s+/g, '')))
    .map(f => ({ name: f.name, options: f.options }))

  if (!todo.length) return {}

  const prompt = `商品标题：${product.title || ''}
商品类目：${product.category || ''}

下面是拼多多商品发布页的属性字段和它们的**真实候选值**。请为每个字段选一个最合适的值。

${todo.map((f, i) => `${i + 1}. ${f.name}：${f.options.join(' / ')}`).join('\n')}

规则：
1. 只能从每个字段给出的候选值里选，**原样输出候选值**，不要改写
2. 优先选与标题/类目最匹配的
3. 没有明显匹配时，选最通用的（如「其他」「通用」「否」「无品牌/无注册商标」）
4. 材质类按标题判断（纸杯→纸或纸+PE膜）

只输出 JSON，格式：{"字段名": "选中的候选值", ...}
不要任何解释。`

  // ★ 2026-10-30：prompt 里有换行/引号，直接拼进 Python -c 会语法错误。
  //   改成写临时 JSON 文件，Python 读文件 → 彻底避免转义问题。
  const fs = await import('node:fs')
  const os = await import('node:os')
  const pathMod = await import('node:path')
  const tmpPayload = pathMod.join(os.tmpdir(), `attrpick_${Date.now()}.json`)
  fs.writeFileSync(tmpPayload, JSON.stringify({
    model: 'cn:glm-5.3-flash',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
  }), 'utf8')

  const pyCode = [
    'import sys, json, urllib.request, ssl',
    // ★ 2026-10-30：imgkit.py 实际在 pajama 目录（不是 aiimgnew1）
    'sys.path.insert(0, r"E:\\360MoveData\\Users\\Administrator\\Desktop\\童装\\artifacts\\pajama")',
    'from imgkit import BASE, KEY',
    'ctx = ssl.create_default_context(); ctx.check_hostname=False; ctx.verify_mode=ssl.CERT_NONE',
    `payload = json.loads(open(r"${tmpPayload}", encoding="utf-8").read())`,
    'req = urllib.request.Request(f"{BASE}/chat/completions", data=json.dumps(payload).encode(), method="POST",',
    '    headers={"Authorization":f"Bearer {KEY}","Content-Type":"application/json"})',
    'with urllib.request.urlopen(req, timeout=90, context=ctx) as r: j = json.loads(r.read().decode())',
    'print(j["choices"][0]["message"]["content"].strip())',
  ].join('\n')

  let out = ''
  try {
    out = execFileSync(PY, ['-c', pyCode], {
      encoding: 'utf8', timeout: 120000,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    })
  } catch (e) {
    const msg = String(e.stderr || e.message || '').split('\n').slice(-3).join(' | ')
    log(`[attr] AI 选值失败：${msg.slice(0, 120)}`)
    try { fs.unlinkSync(tmpPayload) } catch { /* ignore */ }
    return {}
  }
  try { fs.unlinkSync(tmpPayload) } catch { /* ignore */ }

  const txt = String(out || '').trim()
  const m = txt.match(/\{[\s\S]*\}/)
  if (!m) {
    log('[attr] AI 返回无 JSON')
    return {}
  }

  let raw = {}
  try { raw = JSON.parse(m[0]) } catch { return {} }

  // ★ 只接受候选里的原值（防止 AI 编造）
  const picked = {}
  for (const f of todo) {
    const v = raw[f.name]
    if (!v) continue
    const hit = f.options.find(o => o === v) || f.options.find(o => o.includes(v) || v.includes(o))
    if (hit) picked[f.name] = hit
    else log(`[attr] AI 给「${f.name}」的值「${v}」不在候选里，跳过`)
  }

  log(`[attr] AI 选值 ${Object.keys(picked).length}/${todo.length} 个字段`)
  return picked
}
export async function fillAttributesGeneric(page, values, opts = {}) {
  const log = opts.log || (() => {})
  const filled = []
  const missed = []
  const detail = []

  // ★ 2026-10-30：清洗脏后缀（模板/缓存带来的标注）
  const cleanValue = (v) => String(v || '')
    .replace(/（缓存命中）/g, '')
    .replace(/（显式指定）/g, '')
    .replace(/（模板）/g, '')
    .replace(/（AI）/g, '')
    .replace(/（自动）/g, '')
    .trim()

  for (const [name, rawWant] of Object.entries(values || {})) {
    const want = cleanValue(rawWant)
    if (!want) continue

    const boxId = await findFieldBoxId(page, name)
    if (!boxId) {
      missed.push(`${name}（未找到字段）`)
      detail.push({ name, ok: false, err: 'not-found' })
      continue
    }

    if (!(await openDropdown(page, boxId))) {
      missed.push(`${name}（下拉打不开）`)
      detail.push({ name, ok: false, err: 'no-dropdown' })
      continue
    }
    await sleep(800)

    const clicked = await clickOption(page, want)
    if (!clicked) {
      await page.keyboard.press('Escape').catch(() => {})
      missed.push(`${name}（候选里没有「${want}」）`)
      detail.push({ name, ok: false, err: 'option-not-found' })
      continue
    }

    // ★ 多选：面板不关闭，直接校验 boxText
    let verified = await verifyField(page, boxId, want)

    // ★ 失败重试一次（材质这类候选带特殊字符的下拉，首次点击可能没落到正确项）
    if (!verified.ok) {
      log(`[attr] 「${name}」首次未确认，重试`)
      await page.keyboard.press('Escape').catch(() => {})
      await sleep(400)
      if (await openDropdown(page, boxId)) {
        await sleep(800)
        const clickedAgain = await clickOption(page, want)
        if (clickedAgain) {
          await sleep(600)
          verified = await verifyField(page, boxId, want)
          if (verified.ok) log(`[attr] 「${name}」重试成功（实际选中「${clickedAgain}」）`)
        }
      }
    }

    if (verified.ok) {
      filled.push(`${name}=${want}`)
      log(`[attr] 「${name}」= ${want} ✅`)
    } else {
      missed.push(`${name}（未确认）`)
      log(`[attr] 「${name}」= ${want} ❌ input="${verified.inputValue}" text="${verified.boxText}"`)
    }
    detail.push({ name, ok: verified.ok, ...verified })

    await page.keyboard.press('Escape').catch(() => {})
    await sleep(350)
  }

  log(`[attr] 已填 ${filled.length} 项，未填 ${missed.length} 项`)
  return { filled, missed, detail }
}

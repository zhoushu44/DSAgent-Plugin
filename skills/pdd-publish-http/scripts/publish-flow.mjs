/**
 * 发布组件 · 总编排（publish-flow.mjs）
 *
 * ★★ 核心原则（2026-10-29 定稿，血泪教训）★★
 *
 *   组件化 = **把已验证能跑通的东西拆成模块**，不是重写逻辑。
 *
 *   之前我犯的错：把 lib/pdd-publish.js 里已经上架成功过的
 *   fillAttributes / fillSkuSpecMulti / fillPriceTable 全部重写成
 *   新的纯 JS 实现，结果材质成分连续坏 3 次，上架直接失败。
 *
 *   现在的做法：所有子组件只 **re-export lib 的已验证函数**，
 *   本文件只负责「按 lib 内部相同的顺序和参数调用」，一行业务逻辑都不新写。
 *
 * ── 调用顺序（与 lib 段3/段4 完全一致，实测能上架）──
 *   段3：标题 → 参考价 → 主图（全部）→ 详情图
 *   段4：规格 → SKU价格库存 → 商品属性 → 发货与售后
 *
 *   ★ 注意属性在价格表**之后**，这个顺序不能改：
 *     属性下拉重渲染会冲掉前面填的东西，放最后最安全。
 */
import { fillTitle, fillField } from './field-basic.mjs'
import { uploadImages, uploadDetailImages } from './field-images.mjs'
import { fillSkuSpecMulti, fillSkuSpec } from './spec-dims.mjs'
import { fillPriceTable } from './sku-table.mjs'
import { fillShippingAndFreight, disableSizeChart } from './field-shipping.mjs'

/** 主图 file input 锚点（与 lib 内一致） */
const MAIN_IMAGE_INPUT = 'input[data-tracking-click-viewid="carousel_img_localfile_upload"]'

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * 跑完整段3 + 段4
 *
 * @param page   表单页（goods_add/index）
 * @param product 统一商品 JSON
 * @param opts {
 *   log?: (msg) => void,
 *   costTemplate?: string,
 *   deliveryTime?: string,
 *   attrModel?: any,
 * }
 * @returns { filled: string[], missed: string[] }
 */
export async function publishFlow(page, product, opts = {}) {
  const log = opts.log || (() => {})
  const filled = []
  const missed = []

  const title = String(product.title || '').trim()
  const stock = String(product.stock || '100')   // ★ 2026-10-30 用户定：每个 SKU 默认库存 100

  // ★ 2026-10-31 用户定：**商品参考价默认 = 最大 SKU 拼单价 + 1**
  //   平台要求参考价 > 最大单买价，所以取 max(price) + 1 最稳妥。
  //   product.price 显式给了就用显式的（用户可覆盖）。
  let price = String(product.price || '').trim()
  {
    const allPrices = (product.skus || [])
      .map(s => parseFloat(s?.price))
      .filter(n => Number.isFinite(n) && n > 0)
    if (allPrices.length) {
      const maxPrice = Math.max(...allPrices)
      const autoRef = Math.round((maxPrice + 1) * 100) / 100
      if (!price) {
        price = String(autoRef)
        log(`  参考价未指定 → 自动取「最大SKU价 ${maxPrice} + 1 = ${price}」`)
      } else {
        // 显式给了但低于 max+1 时，仍按用户给的（只提示）
        const given = parseFloat(price)
        if (Number.isFinite(given) && given <= maxPrice) {
          log(`  ⚠ 参考价 ${price} <= 最大SKU价 ${maxPrice}，平台可能拦；建议 ${autoRef}`)
        }
      }
    }
  }
  const itemNo = String(product.itemNo || '').trim()
  const category = String(product.category || '').trim()
  const images = product.images || []
  const detailImages = product.detailImages || []
  const attributes = product.attributes || []

  // 规格 / SKU 行（★ 形状必须与 lib 内部一致：values 是对象数组 {value, image}，
  //   不是字符串数组。lib 用 `String(v?.value||'')` 取值，传字符串会全部被过滤 → 0 项）
  const specs = (product.specs || [])
    .filter(d => d && d.name && Array.isArray(d.values) && d.values.length)
    .map(d => ({
      name: String(d.name).trim(),
      values: d.values
        .map(v => (v && typeof v === 'object')
          ? { value: String(v.value ?? '').trim(), image: v.image ? String(v.image).trim() : undefined }
          : { value: String(v ?? '').trim(), image: undefined })
        .filter(v => v.value),
    }))
    .filter(d => d.values.length)

  const skuRows = (product.skus || []).map(s => ({
    specs: s.specs || {},
    price: String(s.price || price),
    stock: String(s.stock || stock),
    itemNo: s.itemNo,
    image: s.image,
  }))

  // ══════════════ 段3：标题 / 参考价 / 主图 / 详情图 ══════════════
  log('【段3】标题 / 参考价 / 主图 / 详情图')

  if (title) {
    const ok = await fillTitle(page, title)
    if (ok) filled.push(`标题=${title}`)
    else missed.push('标题')
    log(`  标题 → ${ok ? 'OK' : '失败'}`)
  }

  if (price) {
    const ok = await fillField(page, /商品参考价|参考价|应大于商品最大单买价/, price)
    if (ok) filled.push(`参考价=${price}`)
    else missed.push('参考价')
    log(`  参考价 ${price} → ${ok ? 'OK' : '未找到'}`)
  }

  if (images.length) {
    const r = await uploadImages(page, images, MAIN_IMAGE_INPUT, '主图')
    if (r?.ok) filled.push(`主图（${r.note || images.length + ' 张'}）`)
    else missed.push(`主图（${r?.note || '上传未完成'}）`)
    log(`  主图 → ${r?.note || (r?.ok ? 'OK' : '未完成')}`)
  }

  if (detailImages.length) {
    const r = await uploadDetailImages(page, detailImages)
    if (r?.ok) filled.push(`详情图（${r.note}）`)
    else missed.push(`详情图（${r?.note || '上传未完成'}）`)
    log(`  详情图 → ${r?.note}`)
  }

  // ══════════════ 段4：规格 → 价格库存 → 属性 → 发货 ══════════════
  log('【段4】规格 / 价格库存 / 属性 / 发货')

  // ① 尺码表停用（服装类目才有，其他类目自动 false）
  if (await disableSizeChart(page)) log('  已停用尺码表')

  // ② 规格（★ 2026-10-30：视觉识别优先，失败回退 lib 老逻辑）
  //
  //   为什么视觉优先：拼多多各类目规格区结构完全不同
  //     服装 → 颜色分类（色值卡片，输入后必须失焦才提交）
  //     纸杯 → 容量（纯文本输入 + 回车）
  //     手机壳 → 型号（下拉/输入）
  //     抱枕 → 尺寸（纯文本输入）
  //   写死任何一种都会挂，所以先截图让视觉模型看，按它的 strategy 填。
  if (specs.length) {
    let usedVision = false
    if (opts.useVision !== false) {
      try {
        const { fillDimByVision } = await import('./vision-fill.mjs')
        // ★★ 2026-10-30 用户点醒：「一维输入好，二维才能选」
        //   正确顺序必须是 **每个维度：建行 → 立即填完值 → 再建下一个**。
        //   之前是「建行1 → 建行2 → 填值1 → 填值2」，第二个维度建的时候
        //   第一个维度还没填值，页面没进入「可添加下一维」的状态 → 按钮消失/截图失败。
        for (let di = 0; di < specs.length; di++) {
          const sp = specs[di]
          const vals = (sp.values || []).map(v => (v && typeof v === 'object') ? v : { value: String(v) })
          log(`  填第 ${di + 1}/${specs.length} 维「${sp.name}」（${vals.length} 个值）`)
          const vr = await fillDimByVision(page, sp.name, vals, { log, category })
          if (vr.filled?.length) {
            filled.push(...vr.filled)
            usedVision = true
          }
          if (vr.missed?.length) {
            log(`    ⚠ 本维未完成 ${vr.missed.length} 项`)
          }
          // ★ 填完这一维后，等页面稳定再进下一维（关键！）
          //   ★ 2026-10-31 提速：原先固定 sleep(2500) + 最多 12 次 ×1s 轮询 = 最长 14.5s
          //     实测多数情况按钮 1~2 秒内就出现，改成「250ms 轮询 + 最多 6 秒」
          if (di < specs.length - 1) {
            const t0 = Date.now()
            let btnReady = false
            for (let w = 0; w < 24; w++) {
              await sleep(250)
              // ★ 2026-10-31：放宽判定 —— 除了按钮文字，也接受「规格行数已达预期」
              btnReady = await page.evaluate((expectRows) => {
                // ① 有「添加规格类型」按钮
                const hasBtn = [...document.querySelectorAll('button, div, span, a')].some(e => {
                  const t = (e.innerText || '').trim()
                  const r = e.getBoundingClientRect()
                  return /^添加规格类型|^添加规格/.test(t) && r.width > 20
                })
                if (hasBtn) return true
                // ② 或：规格容器数量已达预期（说明已进入可添加下一维状态）
                const root = document.querySelector('#goods-spec-sku')
                if (root) {
                  const rows = root.querySelectorAll('.property-container-v2, .goods-spec-row').length
                  if (rows >= expectRows) return true
                }
                return false
              }, di + 1).catch(() => false)
              if (btnReady) break
            }
            const waited = Date.now() - t0
            log(`    等页面稳定后建下一维… ${btnReady ? '就绪' : '继续'}（${waited}ms）`)
            await sleep(300)
          }
        }
        if (usedVision) log(`  规格（视觉）→ 已填 ${filled.filter(f => specs.some(s => f.startsWith(s.name + '='))).length} 项`)
      } catch (e) {
        log(`  视觉填规格异常：${e.message.slice(0, 80)}，回退 lib 逻辑`)
      }
    }

    // 兜底：lib 已验证逻辑（视觉没用上时才跑，避免重复填）
    if (!usedVision) {
      const r = await fillSkuSpecMulti(page, specs, skuRows, category)
      filled.push(...(r.filled || []))
      missed.push(...(r.missed || []))
      log(`  规格（lib）→ 已填 ${r.filled?.length || 0} 项，未填 ${r.missed?.length || 0} 项`)
      await sleep(1500)
    }
  } else if (skuRows.length) {
    const r = await fillSkuSpec(page, skuRows, { category })
    filled.push(...(r.filled || []))
    missed.push(...(r.missed || []))
    log(`  单维规格 → 已填 ${r.filled?.length || 0} 项`)
    await sleep(1500)
  }

  // ③ 价格及库存
  // ② 价格库存（★ 2026-10-30：**先填价格，等行数稳定后再填图**）
  //   真机实测：规格填完后 SKU 表只有 2 行，价格库存填完后变成 3 行。
  //   所以必须**先填价格**，等行数到预期后再填预览图。
  {
    const priceRows = specs.length
      ? skuRows.map(r => ({ price: r.price, stock: r.stock, specs: r.specs }))
      : skuRows.map(s => ({ price: s.price, stock: s.stock }))
    const r = await fillPriceTable(page, { price, stock, itemNo, rows: priceRows })
    filled.push(...(r.filled || []))
    missed.push(...(r.missed || []))
    log(`  价格库存 → 已填 ${r.filled?.length || 0} 项，未填 ${r.missed?.length || 0} 项`)
    await sleep(600)   // 2026-10-31 speed: 2000 -> 600（表格重渲染很快）
  }

  // ③ SKU 预览图（★ 在价格库存之后，等行数到预期）
  if (specs.length && skuRows.length) {
    try {
      const { fillSkuThumbs } = await import('./sku-thumb.mjs')
      const r = await fillSkuThumbs(page, product, { log })
      filled.push(...(r.filled || []))
      missed.push(...(r.missed || []))
      log(`  SKU 预览图 → 已填 ${r.filled?.length || 0} 项，未填 ${r.missed?.length || 0} 项`)
    } catch (e) {
      missed.push(`SKU 预览图（异常：${e.message}）`)
      log(`  SKU 预览图异常：${e.message.slice(0, 80)}`)
    }
    await sleep(400)   // 2026-10-31 speed: 1200 -> 400
  }

  // ④ 商品属性
  //   ★ 2026-10-30 用户定：「没给属性才走 AI 一键填充」
  //     · 先采集页面真实字段+候选
  //     · 用户给了的值优先用
  //     · 用户没给的，用 AI 从**真实候选**里选（不留空）
  try {
    const { harvestAttributes, fillAttributesGeneric, pickAttrValuesByAI } = await import('./attr-fill-generic.mjs')

    // ★ 2026-10-30：SKU 预览图上传后页面会重渲染，属性区可能还没完全展开。
    //   先滚到属性区、静置 2 秒，再采集（避免漏字段，实测漏过「适用型号」）。
    await page.evaluate(() => {
      const root = document.querySelector('#property') || document.querySelector('.goods-propertys')
      if (root) root.scrollIntoView({ block: 'start' })
    }).catch(() => {})
    await sleep(2000)

    // ① 采集所有字段 + 真实候选
    //   ★ 2026-10-31 提速：模板已有值的字段**不读候选**（省掉 N 次开下拉）
    const tplAttrNames = (opts.templateAttrs || []).map(a => String(a.name || '').replace(/\s+/g, ''))
    let { fields } = await harvestAttributes(page, { log, skipOptions: tplAttrNames })

    // ★ 兜底：如果必填字段数偏少，再等 3 秒重采一次（取并集）
    const reqCount1 = fields.filter(f => f.required).length
    if (reqCount1 < 3) {
      log(`[attr] 必填字段仅 ${reqCount1} 个，3 秒后重采一次`)
      await sleep(3000)
      const retry = await harvestAttributes(page, { log })
      if (retry.fields.length > fields.length) {
        fields = retry.fields
        log(`[attr] 重采后 ${fields.length} 个字段`)
      }
    }

    // ② 用户值 → Map（字段名归一化用于匹配）
    const userMap = new Map()
    for (const a of attributes) {
      const n = String(a.name || '').replace(/\s+/g, '')
      if (n && a.value) userMap.set(n, String(a.value).trim())
    }

    // ③ 组装最终要填的值：用户值优先，缺失的用 AI 选
    //   ★ 2026-10-30 关键修复：字段名匹配必须**严格**，否则「填充物」会拿到「填充物净重」的值
    //     规则：① 完全相等 ② 用户名字段名是页面字段名的**前缀且长度差<=2**
    //     禁止：任意互相包含（会让 填充物 ⊂ 填充物净重 误匹配）
    const wantValues = {}
    const userHitNames = new Set()
    for (const f of fields) {
      const fn = String(f.name).replace(/\s+/g, '')

      // ① 完全相等
      let uv = userMap.get(fn)

      // ② 页面字段名以用户字段名开头，且用户名足够长（>=2）→ 视为同一字段
      //    例：用户「材质」→ 页面「材质」✅；用户「材质」→ 页面「材质成分」✅
      //    但「填充物」不会匹配「填充物净重」（因为净重更长且是不同字段，交给AI）
      if (!uv) {
        const candidates = []
        for (const [un, v] of userMap) {
          if (!un || un.length < 2) continue
          if (fn === un) { candidates.push({ un, v, exact: true }); continue }
          // 只允许「页面字段名 = 用户字段名 + 后缀」，且后缀是常见修饰（材质/成分/类型 等）
          if (fn.startsWith(un) && fn.length - un.length <= 2) {
            candidates.push({ un, v, exact: false })
          }
        }
        // 优先精确，其次最短后缀
        candidates.sort((a, b) => (b.exact ? 1 : 0) - (a.exact ? 1 : 0))
        if (candidates.length) uv = candidates[0].v
      }

      if (uv) {
        wantValues[f.name] = uv
        userHitNames.add(fn)
        log(`[attr] 「${f.name}」用用户值「${uv}」`)
      }
    }

    // ④ 用户没给的字段 → AI 从真实候选选
    const missing = fields.filter(f => !wantValues[f.name] && f.options?.length)
    if (missing.length) {
      log(`[attr] ${missing.length} 个字段用户未提供，走 AI 从候选里选`)
      const aiPicked = await pickAttrValuesByAI(page, missing, { title, category }, { log })
      Object.assign(wantValues, aiPicked)

      // ★ 2026-10-30 用户要求「重要是必填的」：
      //   AI 没选中的**必填字段**，必须兜底取候选第一个可用值，不能留空。
      const stillMissingRequired = missing.filter(
        f => f.required && !wantValues[f.name] && f.options?.length
      )
      for (const f of stillMissingRequired) {
        // 跳过明显不合适的候选
        const usable = f.options.filter(o => !/^(请选择|其他|其它)$/.test(o))
        const fallback = usable[0] || f.options[0]
        if (fallback) {
          wantValues[f.name] = fallback
          log(`[attr] ★必填「${f.name}」AI 未选中 → 兜底取「${fallback}」`)
        }
      }
    }

    // ★ 补充：即使字段没有 options（输入框型必填），也要记录出来供人工看
    const requiredNoOptions = fields.filter(f => f.required && !f.options?.length)
    if (requiredNoOptions.length) {
      log(`[attr] ★必填但无候选（需人工）：${requiredNoOptions.map(f => f.name).join('、')}`)
    }

    // ⑤ 填（★ 2026-10-30 关键：属性存在**级联依赖** —— 选了「适用品牌」才会出现「适用型号」。
    //   所以必须「填一轮 → 重新采集 → 补齐新出现的字段」，最多 3 轮。）
    const doneFields = new Set()
    for (let round = 0; round < 3; round++) {
      // 每轮都重新采集（可能发现新字段）
      if (round > 0) {
        await sleep(1200)
        const again = await harvestAttributes(page, { log })
        if (again.fields.length > fields.length) {
          log(`[attr] 第 ${round + 1} 轮：属性区从 ${fields.length} 个增加到 ${again.fields.length} 个（级联字段出现）`)
          fields = again.fields
        }
      }

      // 计算本轮要填的：用户值优先，缺失的 AI 选
      const roundValues = {}
      for (const f of fields) {
        if (doneFields.has(f.name)) continue
        const fn = String(f.name).replace(/\s+/g, '')
        let uv = userMap.get(fn)
        if (!uv) {
          for (const [un, v] of userMap) {
            if (fn.startsWith(un) && fn.length - un.length <= 2) { uv = v; break }
          }
        }
        if (uv) roundValues[f.name] = uv
      }

      const roundMissing = fields.filter(f => !doneFields.has(f.name) && !roundValues[f.name] && f.options?.length)
      if (roundMissing.length) {
        const aiPicked = await pickAttrValuesByAI(page, roundMissing, { title, category }, { log })
        Object.assign(roundValues, aiPicked)
        // 必填兜底
        for (const f of roundMissing) {
          if (f.required && !roundValues[f.name] && f.options?.length) {
            const usable = f.options.filter(o => !/^(请选择|其他|其它)$/.test(o))
            const fb = usable[0] || f.options[0]
            if (fb) {
              roundValues[f.name] = fb
              log(`[attr] ★必填「${f.name}」AI 未选中 → 兜底取「${fb}」`)
            }
          }
        }
      }

      if (!Object.keys(roundValues).length) {
        log(`[attr] 第 ${round + 1} 轮：无可填字段，结束`)
        break
      }

      log(`[attr] 第 ${round + 1} 轮：填 ${Object.keys(roundValues).length} 个字段`)
      const r = await fillAttributesGeneric(page, roundValues, { log })
      for (const f of r.filled || []) if (!filled.includes(f)) filled.push(f)
      for (const m of r.missed || []) if (!missed.includes(m)) missed.push(m)
      for (const k of Object.keys(roundValues)) doneFields.add(k)

      // 本轮全失败 → 不再重试
      if (!r.filled?.length) break
    }
    // ★ 去重统计（多轮会重复追加同一字段）
    const finalFilled = [...new Set(filled)]
    log(`  属性 → 已填 ${finalFilled.length} 个字段`)

    // ★ 2026-10-30 用户指出：带「重要」标记的是**必填**，漏了平台会拦。
    //   逐项复核，必填项没值 → 明确报错（不能静默通过）。
    const { checkFieldFilled } = await import('./attr-fill-generic.mjs')
    const reqFields = fields.filter(f => f.required)
    const reqMissing = []
    for (const f of reqFields) {
      const st = await checkFieldFilled(page, f.id)
      if (!st.filled) reqMissing.push(f.name)
    }
    log(`  ★必填项 ${reqFields.length} 个：${reqFields.map(f => f.name).join('、')}`)
    if (reqMissing.length) {
      missed.push(`★必填未填：${reqMissing.join('、')}`)
      log(`  ⚠⚠ 必填未填：${reqMissing.join('、')}`)
    } else {
      log(`  ✅ 所有必填项已填`)
    }

    // ★ 2026-10-30 关键补充：属性级联会导致 SKU 表**新增行**（如抱枕 2→3 行），
    //   而价格库存是在属性之前填的 → 新行没有价格库存 → 提交报「请输入第N行规格的库存」。
    //   所以属性填完后必须**再补一遍价格库存**（只补空行，不覆盖已有值）。
    try {
      const priceRows = specs.length
        ? skuRows.map(r => ({ price: r.price, stock: r.stock, specs: r.specs }))
        : skuRows.map(s => ({ price: s.price, stock: s.stock }))
      const r2 = await fillPriceTable(page, { price, stock, itemNo, rows: priceRows })
      if (r2.filled?.length) {
        log(`  [补] 属性后补价格库存 ${r2.filled.length} 项（新行）`)
        for (const f of r2.filled) if (!filled.includes(f)) filled.push(f)
      }
      if (r2.missed?.length) log(`  [补] 价格库存未填 ${r2.missed.length} 项`)
    } catch (e) {
      log(`  [补] 价格库存异常：${e.message.slice(0, 60)}`)
    }

    // ★ 同上：属性级联新增行也需要预览图，补一遍（已有图的会跳过）
    try {
      const { fillSkuThumbs } = await import('./sku-thumb.mjs')
      const r3 = await fillSkuThumbs(page, product, { log })
      if (r3.filled?.length) {
        log(`  [补] 属性后补预览图 ${r3.filled.length} 项`)
        for (const f of r3.filled) if (!filled.includes(f)) filled.push(f)
      }
      if (r3.missed?.length) log(`  [补] 预览图未填 ${r3.missed.length} 项`)
    } catch (e) {
      log(`  [补] 预览图异常：${e.message.slice(0, 60)}`)
    }
  } catch (e) {
    missed.push(`商品属性（异常：${e.message}）`)
    log(`  属性异常：${e.message.slice(0, 100)}`)
  }

  // ⑤ 发货与售后
  try {
    const r = await fillShippingAndFreight(page, {
      costTemplate: opts.costTemplate,
      deliveryTime: opts.deliveryTime,
      log,
    })
    filled.push(...(r.filled || []))
    missed.push(...(r.missed || []))
    log(`  发货售后 → 已填 ${r.filled?.length || 0} 项，未填 ${r.missed?.length || 0} 项`)
  } catch (e) {
    missed.push(`发货与售后（异常：${e.message}）`)
  }

  return { filled, missed }
}

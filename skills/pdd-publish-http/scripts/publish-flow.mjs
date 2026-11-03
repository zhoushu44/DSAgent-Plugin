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
  // ★ 2026-11-02：把属性阶段扫描到的字段（含完整 options）带到返回值，
  //   供 publish-v2 回写模板（v2 模板要存 options，第二次发布才能零扫描）
  let __attrFieldsForTemplate = []

  const title = String(product.title || '').trim()
  const stock = String(product.stock || '100')   // ★ 2026-10-30 用户定：每个 SKU 默认库存 100

  // ★ 2026-10-31 用户定：**商品参考价默认 = 最大 SKU 拼单价 + 1**
  //   ★ 但平台校验是「参考价应大于商品最大**单买价**」，
  //     而单买价 = 拼单价 + 1.01 → 所以参考价至少要 = max(拼单价) + 1.02
  //     实测：拼单价 29.9 → 单买价 30.91 → 参考价 30.9 被拒，必须 >= 30.91
  //   改成 max(拼单价) + 1.01 + 0.01 = max + 1.02，向上取 2 位小数
  let price = String(product.price || '').trim()
  {
    const allPrices = (product.skus || [])
      .map(s => parseFloat(s?.price))
      .filter(n => Number.isFinite(n) && n > 0)
    if (allPrices.length) {
      const maxPrice = Math.max(...allPrices)
      // 最大单买价 = max(拼单价) + 1.01；参考价需严格大于它
      const maxSingle = Math.round((maxPrice + 1.01) * 100) / 100
      const autoRef = Math.round((maxSingle + 0.01) * 100) / 100
      if (!price) {
        price = String(autoRef)
        log(`  参考价未指定 → 自动取「最大SKU拼单价 ${maxPrice} → 最大单买价 ${maxSingle} → 参考价 ${price}」`)
      } else {
        const given = parseFloat(price)
        if (Number.isFinite(given) && given <= maxSingle) {
          log(`  ⚠ 参考价 ${price} <= 最大单买价 ${maxSingle}，平台会拦；已自动改为 ${autoRef}`)
          price = String(autoRef)
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

    // ★ 2026-11-02 实验结论：模板 dims 直建维度**不可行**
    //   实测抱枕：addSpecDimension 卡 29 秒返回 false，fillSpecValuesRowByRow 报 no #newSpec
    //   原因：模板记录的 type=custom-input 是"上次的页面状态"，但页面每次渲染的实际结构不同，
    //        视觉流程本来就要先探测再操作。已回滚，保留视觉流程。
    if (!usedVision && opts.useVision !== false) {
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

    // ★★ 2026-11-02 重大提速：模板命中时**直接填**，跳过所有扫描
    //   模板里已经存了完整的 name→value 映射，没必要再扫 required / 读候选。
    //   实测：原流程 3 次扫描 ~9 秒 + 逐字段读候选；直填只需 1 次 DOM 索引 ~50ms。
    //   直填失败（字段结构变了 / 填充率 <80%）才回落到通用流程。
    if ((opts.templateAttrs || []).length) {
      try {
        const { fillAttrsFromTemplate } = await import('./attr-template-direct.mjs')
        const t0 = Date.now()
        const direct = await fillAttrsFromTemplate(page, opts.templateAttrs, attributes, { log })
        const cost = Date.now() - t0
        filled.push(...direct.filled)
        missed.push(...direct.missed)
        log(`[attr] 模板直填 ${direct.usedTemplate} 项，耗时 ${cost}ms，必填 ${direct.requiredFilled}/${direct.requiredTotal}`)

        if (!direct.needFallback) {
          log(`[attr] ✅ 模板直填覆盖完整，跳过扫描流程`)
          // 仍需记录到 flowResult，但不进通用流程
          throw { __templateDone: true }
        }
        log(`[attr] ⚠ 模板直填不完整（未找到 ${direct.notFound.length} 个字段，填充率 ${(direct.fillRate * 100).toFixed(0)}%），回落通用流程`)
      } catch (e) {
        if (e && e.__templateDone) return { filled, missed }
        log(`[attr] 模板直填异常：${String(e?.message || e).slice(0, 80)}，回落通用流程`)
      }
    }

    // ★ 2026-10-30：SKU 预览图上传后页面会重渲染，属性区可能还没完全展开。
    //   先滚到属性区、静置 2 秒，再采集（避免漏字段，实测漏过「适用型号」）。
    await page.evaluate(() => {
      const root = document.querySelector('#property') || document.querySelector('.goods-propertys')
      if (root) root.scrollIntoView({ block: 'start' })
    }).catch(() => {})
    await sleep(2000)

    // ① 采集所有字段 + 真实候选
    //   ★ 2026-10-31 提速：模板已有值的字段**不读候选**（省掉 N 次开下拉）
    //   ★ 2026-11-02 关键修复：**必填字段永远不能跳过候选读取**
    //     实测抱枕：模板 15 个字段全被跳过 → 没读候选 → 用户值不在候选里时无法兜底
    //     → 品牌/产品类型/填充物/形状/工艺/安全等级/平方克重 7 个必填留空，填写率仅 43%
    //     修法：先快速扫一遍拿到 required 名单，只对非必填的模板字段跳过
    const tplAttrNames = (opts.templateAttrs || []).map(a => String(a.name || '').replace(/\s+/g, ''))
    let skipForSpeed = tplAttrNames
    try {
      const pre = await harvestAttributes(page, { log, skipOptions: [], fast: true, ultraFast: true })
      const reqNames = new Set(
        (pre.fields || []).filter(f => f.required).map(f => String(f.name || '').replace(/\s+/g, ''))
      )
      if (reqNames.size) {
        skipForSpeed = tplAttrNames.filter(n => !reqNames.has(n))
        log(`[attr] 必填 ${reqNames.size} 个不跳过候选读取；仅跳过 ${skipForSpeed.length} 个非必填模板字段`)
      }
    } catch { /* 扫描失败退回原逻辑 */ }
    let { fields } = await harvestAttributes(page, { log, skipOptions: skipForSpeed })
    // ★ 2026-11-02：记录完整字段（含 options）供模板回写
    if (Array.isArray(fields) && fields.length) {
      __attrFieldsForTemplate = fields.map(f => ({
        name: f.name,
        required: !!f.required,
        kind: f.kind || 'select',
        options: Array.isArray(f.options) ? f.options : [],
        value: '',
      }))
    }

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
    }

    // ★ 2026-10-31 修复：兜底要覆盖**所有必填字段**，不只是 missing 里的
    //   实测收纳盒：用户给了「材质=塑料」，但候选里没有「塑料」→ 既不在 missing 也没兜底 → 必填留空
    const stillMissingRequired = fields.filter(
      f => f.required && f.options?.length && (
        !wantValues[f.name] ||
        // 用户值不在候选里也要兜底
        !f.options.some(o => o === wantValues[f.name] || o.includes(wantValues[f.name]) || wantValues[f.name].includes(o))
      )
    )
    for (const f of stillMissingRequired) {
      // 优先保留用户值（如果是候选的子集关系）
      const uv = wantValues[f.name]
      let fallback = null
      if (uv) {
        fallback = f.options.find(o => o === uv || o.includes(uv) || uv.includes(o)) || null
      }
      if (!fallback) {
        // 跳过明显不合适的候选
        const usable = f.options.filter(o => !/^(请选择|其他|其它)$/.test(o))
        fallback = usable[0] || f.options[0]
      }
      if (fallback) {
        const changed = uv && fallback !== uv
        wantValues[f.name] = fallback
        log(`[attr] ★必填「${f.name}」${changed ? `用户值「${uv}」不在候选 → 兜底取「${fallback}」` : `未选中 → 兜底取「${fallback}」`}`)
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
        // ★ 2026-11-02 提速：重采集用 ultraFast（不做滚动/长等待）
        //   原来走完整 harvestAttributes（滚动 1.8s + 稳定 1.5s + 静置 600ms）
        //   → 第 2 轮光采集就 4 秒，加上 AI 选值和填写共 16 秒
        //   现在只查字段数量和候选，1 秒内完成
        const again = await harvestAttributes(page, { log, ultraFast: true, skipOptions: skipForSpeed })
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
        // ★ 2026-10-31：第2轮起，如果用户值不在候选里，改用 wantValues 里的兜底值
        if (uv && f.options?.length) {
          const inOptions = f.options.some(o => o === uv || o.includes(uv) || uv.includes(o))
          if (!inOptions && wantValues[f.name]) {
            uv = wantValues[f.name]   // 用兜底值
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

      // ★ 2026-11-01：先处理特殊字段（复合/搜索式），普通字段交给通用组件
      //   ① 品牌 = 搜索式下拉（必须键入搜索再点候选，不能直接塞值）
      //   ② 材质成分 = 「添加XX(N/M)」按钮 + 动态行（没有 input）
      const special = {}
      const normal = {}
      for (const [k, v] of Object.entries(roundValues)) {
        const f = fields.find(x => x.name === k)
        if (/^品牌$/.test(k)) special[k] = { type: 'brand', v, id: f?.id || '' }
        else if (/材质成分|成分含量/.test(k)) special[k] = { type: 'composite', v, id: f?.id || '' }
        else normal[k] = v
      }

      if (Object.keys(special).length) {
        const { fillCompositeAttr, fillBrandSearch } = await import('./attr-composite.mjs')
        for (const [k, s] of Object.entries(special)) {
          // 若字段没有 id，按名字现找
          let boxId = s.id
          if (!boxId) {
            boxId = await page.evaluate((name) => {
              for (const box of document.querySelectorAll('[id^="basic.propertys."]')) {
                let lb = box.querySelector('label')
                if (!lb) {
                  let cur = box
                  for (let d = 0; d < 6 && cur; d++) {
                    const l = cur.querySelector('label')
                    if (l && !l.contains(box)) { lb = l; break }
                    cur = cur.parentElement
                  }
                }
                const n = (lb?.innerText || '').replace(/重要|必填|[*＊\s]/g, '').trim()
                if (n === name) return box.id
              }
              return ''
            }, k).catch(() => '')
          }
          if (!boxId) {
            missed.push(`${k}（找不到字段容器）`)
            continue
          }
          try {
            const r = s.type === 'brand'
              ? await fillBrandSearch(page, boxId, s.v, { log })
              : await fillCompositeAttr(page, boxId, k, s.v, { log })
            for (const x of r.filled || []) if (!filled.includes(x)) filled.push(x)
            for (const x of r.missed || []) if (!missed.includes(x)) missed.push(x)
          } catch (e) {
            missed.push(`${k}（特殊字段异常：${e.message.slice(0, 80)}）`)
          }
        }
      }

      if (!Object.keys(normal).length) {
        // 本轮只有特殊字段，直接进下一轮判定
        const okNames2 = new Set((filled || []).map(f => String(f).split('=')[0]))
        for (const k of Object.keys(special)) {
          if (okNames2.has(k)) doneFields.add(k)
        }
        continue
      }

      const r = await fillAttributesGeneric(page, normal, { log })
      for (const f of r.filled || []) if (!filled.includes(f)) filled.push(f)
      for (const m of r.missed || []) if (!missed.includes(m)) missed.push(m)

      // ★ 2026-10-31 修复：只把**成功**的字段加入 doneFields
      //   失败的要留给下一轮重试（实测收纳盒：材质第1轮用「塑料」失败，
      //   因被标记为 done，第2轮没机会用兜底值「皮革」重试）
      //   ★ 2026-11-02 修复：okNames 必须包含 **special 字段**（品牌/材质成分）的成功结果
      //     否则品牌填成功了也报「本轮失败」→ 下一轮重试 → 浪费 10 秒
      const okNames = new Set((r.filled || []).map(f => String(f).split('=')[0]))
      for (const k of Object.keys(special)) {
        if (filled.some(x => String(x).split('=')[0] === k)) okNames.add(k)
      }
      for (const k of Object.keys(roundValues)) {
        if (okNames.has(k)) doneFields.add(k)
        else log(`[attr] 「${k}」本轮失败，下一轮重试`)
      }

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
    // ★ 2026-11-03：字段数为 0 = 类目没选对 / 页面没加载，必须报错
    //   实测手机壳：属性区 0 字段 → 「必填项 0 个」→ 假成功 → 提交被平台拦
    if (!fields.length) {
      const curUrl = await page.evaluate(() => location.href).catch(() => '')
      missed.push('商品属性（属性区 0 字段，类目可能未选对）')
      log(`  ❌ 属性区 0 字段！当前 URL: ${String(curUrl).slice(0, 80)}`)
      log(`     可能原因：① 类目未选对 ② 页面未加载完 ③ 该类目无需属性`)
      // 抛出让上层知道，但不中断整个批次
      throw new Error('属性区 0 字段')
    }
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

  // ⑥ 服务承诺（★ 2026-10-31：某些类目强制要求勾选「7天无理由退货」）
  //   毛巾类目实测：不勾提交报「该类商品，必须支持【7天无理由退换货】服务」
  try {
    const { fillServiceCommitments } = await import('./field-service.mjs')
    const r = await fillServiceCommitments(page, { log })
    filled.push(...(r.filled || []))
    missed.push(...(r.missed || []))
    log(`  服务承诺 → 已勾选 ${r.filled?.length || 0} 项，未勾选 ${r.missed?.length || 0} 项`)
  } catch (e) {
    missed.push(`服务承诺（异常：${e.message}）`)
    log(`  服务承诺异常：${e.message.slice(0, 80)}`)
  }

  return { filled, missed, attrFields: __attrFieldsForTemplate || [] }
}

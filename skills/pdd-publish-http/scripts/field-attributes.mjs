/**
 * 发布组件 · 类目属性（唯一随类目变化的模块）
 *
 * ★ 设计原则：填写逻辑只 re-export lib 里已验证的 fillAttributes。
 * ★ 本文件额外负责**属性别名映射**：把商品数据里的属性名翻译成类目实际要求的属性名。
 *
 *   为什么需要：商品数据（1688/自建）里的属性名和拼多多类目要求的名字对不上，
 *   例如抱枕类目要求「面料材质」，商品数据写的是「材质」→ 不映射就全部留空。
 *
 *   实测案例（抱枕类目）：
 *     类目要求：面料材质 / 填充物净重 / 适用场景 / 图案 / 产地 / 适用性别 / 包装方式
 *     商品给的：材质=棉 / 风格=简约
 *     → 映射后：面料材质=棉（命中）
 */
export {
  fillAttributes as fillAttributesRaw,
} from '../../../lib/pdd-publish.js'

/**
 * 属性名别名映射：商品数据属性名 → 类目可能用的属性名（数组，按优先级）
 *
 * 覆盖思路：同一含义在不同类目/不同数据源里的常见叫法。
 */
export const ATTR_ALIAS = {
  // 材质类
  '材质': ['面料材质', '材质成分', '主面料成分', '面料成分', '材质', '材料', '面料', '面料名称'],
  '面料': ['面料材质', '面料名称', '面料', '材质成分', '主面料成分'],
  '面料成分': ['材质成分', '主面料成分', '面料材质', '面料成分'],
  '主面料成分': ['材质成分', '面料材质', '主面料成分'],
  '材质成分': ['材质成分', '主面料成分', '面料材质'],
  '填充物': ['填充物', '填充物材质', '填充'],
  '填充物材质': ['填充物', '填充物材质'],
  '填充物净重': ['填充物净重', '净重', '克重'],

  // 风格/图案类
  '风格': ['风格', '图案', '风格类型', '款式'],
  '图案': ['图案', '花色', '风格'],
  '花色': ['图案', '花色'],
  '款式': ['款式', '版型', '风格'],

  // 场景/用途
  '适用场景': ['适用场景', '场景', '使用场景'],
  '用途': ['用途', '适用场景'],
  '使用对象': ['使用对象', '适用人群', '适用对象'],

  // 人群
  '适用性别': ['适用性别', '性别'],
  '性别': ['适用性别', '性别'],
  '适用人群': ['适用人群', '使用对象', '适用对象'],
  '适用年龄段': ['适用年龄段', '适合年龄段', '适用年龄'],

  // 产地/品牌
  '产地': ['产地', '生产地', '产地/厂家'],
  '品牌': ['品牌'],

  // 包装
  '包装方式': ['包装方式', '包装', '包装类型'],
  '包装': ['包装方式', '包装'],

  // 季节/厚薄
  '适用季节': ['适用季节', '适合季节', '季节'],
  '上市时节': ['上市年份季节', '上市时节', '上市时间'],
  '厚薄': ['厚薄', '厚度'],

  // 安全/质量
  '安全等级': ['安全等级', '安全类别', '安全技术类别'],
  '安全类别': ['安全等级', '安全类别'],

  // 服装细节
  '领型': ['领型', '领子形状'],
  '袖长': ['袖长', '袖子长度'],
  '衣门襟': ['衣门襟', '门襟'],
  '下装长': ['下装长', '裤长'],

  // 功能
  '功能': ['功能', '功效', '功能特点'],
  '功能特点': ['功能特点', '功能'],

  // 其他常见
  '是否支持定制': ['是否支持定制', '支持定制'],
  '是否接触食品': ['是否接触食品', '接触食品'],
  '货号': ['货号', '商品货号', '商家编码'],
}

/**
 * 把商品属性名展开成「类目可能用的所有名字 → 值」的映射表
 * @param attrs [{ name, value }]
 * @returns Map<标准化名, value>
 */
export function expandAttrAliases(attrs = []) {
  const norm = s => String(s || '').replace(/\s+/g, '')
  const out = new Map()
  for (const a of attrs) {
    const name = norm(a?.name)
    const val = String(a?.value || '').trim()
    if (!name || !val) continue
    // 原名
    if (!out.has(name)) out.set(name, val)
    // 别名
    const aliases = ATTR_ALIAS[name] || []
    for (const alias of aliases) {
      const k = norm(alias)
      if (!out.has(k)) out.set(k, val)
    }
  }
  return out
}

/**
 * 填类目属性（别名展开 + lib 已验证逻辑）
 *
 * @param page
 * @param ctx { title, category, model, values: [{name, value}] }
 * @param opts { log? }
 * @returns { filled: string[], missed: string[] }
 */
export async function fillAttributes(page, ctx = {}, opts = {}) {
  const log = opts.log || (() => {})
  const { fillAttributesRaw } = await import('../../../lib/pdd-publish.js')

  const raw = ctx.values || []
  const expanded = expandAttrAliases(raw)

  // 展开后的属性列表（lib 会用这个去匹配页面候选）
  const values = [...expanded.entries()].map(([name, value]) => ({ name, value }))

  const mapped = values.length - raw.length
  if (mapped > 0) {
    log(`[attr] 别名展开：${raw.length} 条 → ${values.length} 条（+${mapped}）`)
  }

  const r = await fillAttributesRaw(page, { ...ctx, values })
  return { filled: r.filled || [], missed: r.missed || [] }
}

/**
 * 填类目属性（带完整日志与异常暴露）
 *
 * ★ 2026-10-30：之前 lib 的 fillAttributes 抛异常被上层 catch 吞掉，
 *   日志里只剩「别名展开」一行，完全看不到发生了什么。
 *   这里把异常、返回值、属性清单全部打出来。
 */
export async function fillAttributesVerbose(page, ctx = {}, opts = {}) {
  const log = opts.log || (() => {})
  const { fillAttributesRaw } = await import('../../../lib/pdd-publish.js')

  const raw = ctx.values || []
  const expanded = expandAttrAliases(raw)
  const values = [...expanded.entries()].map(([name, value]) => ({ name, value }))

  log(`[attr] 输入 ${raw.length} 条 → 展开 ${values.length} 条`)
  log(`[attr] 属性清单：${values.map(v => v.name + '=' + v.value).join(' / ')}`)

  try {
    const r = await fillAttributesRaw(page, { ...ctx, values })
    const filled = r?.filled || []
    const missed = r?.missed || []
    log(`[attr] 完成：已填 ${filled.length} 项，未填 ${missed.length} 项`)
    if (filled.length) log(`[attr] 已填：${filled.join(' / ')}`)
    if (missed.length) log(`[attr] 未填：${missed.slice(0, 8).join(' / ')}${missed.length > 8 ? ' …' : ''}`)
    return { filled, missed }
  } catch (e) {
    log(`[attr] ❌ 异常：${e.message}`)
    log(`[attr] 堆栈：${String(e.stack || '').split('\n').slice(0, 3).join(' | ')}`)
    return { filled: [], missed: values.map(v => `${v.name}（异常：${e.message.slice(0, 40)}）`) }
  }
}
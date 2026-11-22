/**
 * taobao-publish-guard.mjs —— 淘宝/天猫「发布前合规校验」（基座）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么需要（吸收自 Accio 内容层 + 本仓已有教训）
 * ══════════════════════════════════════════════════════════════════
 *   现有发布链路只校验**技术必填**（标题长度、SKU ≤200、价格 ≤1亿），
 *   完全不校验**平台合规**。而「同模板批量铺货 + 类目错放」这类问题
 *   会导致**已发布的商品被下架**（2026-10-15 闲鱼 8 条全下架即此类）。
 *
 *   淘宝/天猫侧的可执行硬规则（Accio `platform-specs-china.md`
 *   + `pdp-platform-specs.md` 逐字核实）：
 *
 *   ① 一致性契约：图中数量/颜色/规格/销售单位须与标题、属性、SKU、详情页一致
 *   ② 不得生成买家收不到的东西（配件/赠品/道具/认证/奖项/销量/使用效果）
 *   ③ SKU 图对应真实变体（不得高配图配低配 SKU）
 *   ④ 二手/残次必须实拍，禁擦除划痕污渍
 *   ⑤ 受监管类目标签绝不重绘（化妆品/食品/保健/母婴）
 *   ⑥ 无医疗或绝对功效宣称（禁「第一」「最有效」「治疗」）
 *   ⑦ 不侵犯第三方权利（禁未授权品牌/IP/名人肖像/「某品牌同款」）
 *   ⑧ 卖家承担责任（即使图来自平台 AI 工具）
 *
 *   图片规格（淘宝详情页层）：
 *     · 宽度 **≥1440px 推荐**
 *     · 每图 高÷宽 **≤2**
 *     · 总高 **≤100000px**
 *     · **≤20 张**
 *   ★ 注意：这是**详情页层**规格，不是主图层。淘宝**主图无公开数字规格**
 *     （Accio 明确写 "not covered — verify officially"）。
 *     把 1440px 用到拼多多 = 上传被拒，两层不可混用。
 *
 *   淘宝 AI 图片政策：**明确允许**（换背景/扩图/修图/生成模特场景）——最宽松。
 *   但定制/预售效果图**必须标「效果图 / 定制示意」**；
 *   二手/样机/残次**必须用实物照片**。
 *
 * ══════════════════════════════════════════════════════════════════
 * 定位：**校验不拦截**
 * ══════════════════════════════════════════════════════════════════
 *   返回 errors / warnings / infos 三级，由调用方 + 用户决定是否继续。
 *   硬拦（errors）只用于「平台明确会拒」的项（超张数、尺寸越界、极限词）。
 */
import fs from 'node:fs'
import path from 'node:path'

// ── 规则表 ────────────────────────────────────────────────

/** 绝对化/极限用语（广告法 + 平台规则，淘宝抓得最严） */
export const ABSOLUTE_WORDS = [
  '第一', '最好', '最佳', '最优', '最强', '最低', '最高', '最便宜', '最先进',
  '国家级', '顶级', '极品', '绝无仅有', '独一无二', '史无前例', '万能',
  '100%', '百分百', '纯天然', '无任何副作用', '绝对', '唯一', '销量第一',
  '全网最低', '史上最低', '永不', '终身',
]

/** 医疗/功效宣称（禁） */
export const MEDICAL_CLAIMS = [
  '治疗', '治愈', '疗效', '根治', '药效', '医用', '处方', '抗癌', '降血压',
  '降血糖', '消炎', '杀菌治疗', '医美', '祛疤', '生发', '丰胸', '减肥特效',
]

/** 虚假/未授权表述 */
export const FAKE_CLAIMS = [
  '官方直营', '官方授权', '官方正品', '官方渠道', '专供', '特供',
  '同款', '平替', '原单', '尾单', '外贸原单',
]

/** 需要标注「效果图」的场景词 */
export const RENDER_HINTS = ['效果图', '定制示意', '示意图', '渲染图', 'AI生成', 'AI生成图']

/** 受监管类目（标签必须来自实物，不得重绘） */
export const REGULATED_CATEGORY_HINTS = [
  '化妆品', '护肤', '彩妆', '食品', '零食', '保健', '母婴', '奶粉', '辅食', '药品',
]

// ── 图片规格（淘宝详情页层）──────────────────────────────

export const TAOBAO_DETAIL_IMAGE_SPEC = {
  recommendedWidth: 1440,      // ≥1440px 推荐
  maxHeightRatio: 2,           // 每图 高÷宽 ≤2
  maxTotalHeight: 100_000,     // 总高 ≤100000px
  maxCount: 20,                // ≤20 张
  layer: 'detail',             // ★ 详情页层，不是主图层
}

/** 读 PNG/JPEG 宽高（不依赖图像库） */
export function readImageSize(filePath) {
  try {
    const buf = fs.readFileSync(filePath)
    // PNG: 8 字节签名 + IHDR（宽高各 4 字节，大端）
    if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), format: 'png' }
    }
    // JPEG: 找 SOF0/SOF2 段
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue }
        const marker = buf[i + 1]
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const height = buf.readUInt16BE(i + 5)
          const width = buf.readUInt16BE(i + 7)
          return { width, height, format: 'jpeg' }
        }
        const segLen = buf.readUInt16BE(i + 2)
        i += 2 + segLen
      }
    }
    return null
  } catch {
    return null
  }
}

// ── 文案校验 ─────────────────────────────────────────────

function scanWords(text, words) {
  const hits = []
  const s = String(text || '')
  for (const w of words) if (s.includes(w)) hits.push(w)
  return hits
}

/**
 * 校验标题 + 描述文案
 * @returns {{errors:string[], warnings:string[], infos:string[]}}
 */
export function checkCopy({ title = '', description = '', attributes = {} } = {}) {
  const errors = []
  const warnings = []
  const infos = []
  const all = `${title} ${description} ${Object.values(attributes || {}).join(' ')}`

  const abs = scanWords(all, ABSOLUTE_WORDS)
  if (abs.length) {
    errors.push(`含绝对化/极限用语：${abs.join('、')}（广告法+平台规则，淘宝抓得最严）`)
  }

  const med = scanWords(all, MEDICAL_CLAIMS)
  if (med.length) {
    errors.push(`含医疗/功效宣称：${med.join('、')}（禁疾病治疗、医美、保健功能宣称）`)
  }

  const fake = scanWords(all, FAKE_CLAIMS)
  if (fake.length) {
    warnings.push(`含可能违规的授权/来源表述：${fake.join('、')}（无授权证明勿用；「某品牌同款」属混淆）`)
  }

  // 标题长度
  const t = String(title || '')
  if (t.length > 60) errors.push(`标题 ${t.length} 字，超 60 字上限`)
  if (t.length < 5) warnings.push(`标题仅 ${t.length} 字，过短影响搜索`)

  // 定制/预售须标注
  const isCustom = /定制|预售|订货|打样/.test(all)
  if (isCustom && !RENDER_HINTS.some(h => all.includes(h))) {
    warnings.push('含「定制/预售」但未见「效果图 / 定制示意」标注（淘宝要求必须标）')
  }

  return { errors, warnings, infos }
}

/**
 * 校验图片（详情页层规格）
 * @param {string[]} imagePaths 本地图片路径
 * @param {object} [spec] 覆盖规格
 */
export function checkDetailImages(imagePaths = [], spec = {}) {
  const S = { ...TAOBAO_DETAIL_IMAGE_SPEC, ...spec }
  const errors = []
  const warnings = []
  const infos = []
  const list = Array.from(imagePaths)

  if (list.length > S.maxCount) {
    errors.push(`详情图 ${list.length} 张，超上限 ${S.maxCount} 张`)
  }
  if (list.length === 0) {
    infos.push('未传详情图（可选）')
    return { errors, warnings, infos, images: [] }
  }

  let totalHeight = 0
  const images = []
  for (const p of list) {
    if (!fs.existsSync(p)) {
      errors.push(`图片不存在：${path.basename(p)}`)
      continue
    }
    const size = readImageSize(p)
    if (!size) {
      warnings.push(`无法读取尺寸：${path.basename(p)}（非 png/jpeg 或文件损坏）`)
      continue
    }
    const ratio = size.height / size.width
    images.push({ file: path.basename(p), ...size, ratio: +ratio.toFixed(2) })

    if (ratio > S.maxHeightRatio) {
      errors.push(`${path.basename(p)} 高÷宽 = ${ratio.toFixed(2)}，超上限 ${S.maxHeightRatio}（会被拒）`)
    }
    if (size.width < S.recommendedWidth) {
      warnings.push(`${path.basename(p)} 宽 ${size.width}px，低于推荐 ${S.recommendedWidth}px`)
    }
    totalHeight += size.height
  }

  if (totalHeight > S.maxTotalHeight) {
    errors.push(`详情图总高 ${totalHeight}px，超上限 ${S.maxTotalHeight}px`)
  }

  infos.push(`详情页层规格：宽≥${S.recommendedWidth}px 推荐 / 高÷宽≤${S.maxHeightRatio} / 总高≤${S.maxTotalHeight} / ≤${S.maxCount} 张`)
  infos.push('注意：这是**详情页层**规格。淘宝主图无公开数字规格（Accio 明确标注 not covered，需官方核实）。')

  return { errors, warnings, infos, images, totalHeight }
}

/**
 * 校验 SKU 与标题/图的一致性（对应「一致性契约」和「SKU 图对应真实变体」）
 */
export function checkConsistency({ title = '', specs = [], skus = [], imageCount = {} } = {}) {
  const errors = []
  const warnings = []
  const infos = []

  if (!Array.isArray(skus) || skus.length === 0) {
    warnings.push('没有 SKU 行，将按单规格发布')
    return { errors, warnings, infos }
  }

  // 每个 SKU 必须覆盖全部维度
  const dims = (specs || []).map(s => s.name)
  for (let i = 0; i < skus.length; i++) {
    const row = skus[i] || {}
    const v = row.specs || row
    for (const d of dims) {
      if (v[d] === undefined || v[d] === '') {
        errors.push(`SKU 第 ${i + 1} 行缺维度「${d}」`)
      }
    }
  }

  // 价格一致性：SKU 价与标题里出现的价格不对应（弱检查，仅提示）
  const nums = String(title).match(/\d+(?:\.\d+)?\s*元/g)
  if (nums && nums.length) {
    warnings.push(`标题含价格「${nums.join('、')}」——价格应在 SKU/一口价里，标题写价易被判违规`)
  }

  // 规格值数量 vs SKU 行数（矩阵应等于笛卡尔积）
  if (dims.length === 2) {
    const v0 = (specs[0]?.values || []).length
    const v1 = (specs[1]?.values || []).length
    const expect = v0 * v1
    if (expect > 0 && skus.length !== expect) {
      warnings.push(`规格是 ${v0}×${v1}=${expect} 组合，但只给了 ${skus.length} 个 SKU（部分组合缺失）`)
    }
  }

  infos.push('一致性契约：图中数量/颜色/规格须与标题、属性、SKU、详情页、实物一致')
  return { errors, warnings, infos }
}

/**
 * 一站式校验
 * @param {object} product 统一商品数据
 * @param {object} [o]
 * @param {string} [o.category] 类目名（用于受监管判断）
 */
export function validateBeforePublish(product = {}, o = {}) {
  const copy = checkCopy({
    title: product.title || '',
    description: product.description || '',
    attributes: Object.fromEntries((product.attributes || []).map(a => [a.name, a.value])),
  })
  const imgs = checkDetailImages(product.detailImages || [])
  const cons = checkConsistency({
    title: product.title || '',
    specs: product.specs || [],
    skus: product.skus || [],
  })

  const errors = [...copy.errors, ...imgs.errors, ...cons.errors]
  const warnings = [...copy.warnings, ...imgs.warnings, ...cons.warnings]
  const infos = [...copy.infos, ...imgs.infos, ...cons.infos]

  // 受监管类目提示
  const cat = String(o.category || product.category || '')
  if (REGULATED_CATEGORY_HINTS.some(h => cat.includes(h))) {
    warnings.push(`类目「${cat}」属受监管类目：包装/中文标签/成分/净含量/备案信息/警示必须来自实物，绝不重绘；禁编造认证标记`)
  }

  const pass = errors.length === 0
  return {
    pass,
    level: pass ? (warnings.length ? 'warn' : 'ok') : 'block',
    errors, warnings, infos,
    summary: pass
      ? (warnings.length ? `通过但有 ${warnings.length} 条警告` : '全部通过')
      : `有 ${errors.length} 个硬错误，会被平台拒`,
  }
}

export default {
  ABSOLUTE_WORDS, MEDICAL_CLAIMS, FAKE_CLAIMS, TAOBAO_DETAIL_IMAGE_SPEC,
  readImageSize, checkCopy, checkDetailImages, checkConsistency, validateBeforePublish,
}

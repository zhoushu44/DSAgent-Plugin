#!/usr/bin/env python3
"""修正作用域：
  · fillSkuSpecMulti 没有 cfg 参数 → 加 options 参数并透传
  · 颜色值预览图那段在 fillSkuSpecMulti 内，用 cfg?.mode2 是错的 → 改用 multiMode2
"""
from pathlib import Path

P = Path("src/pdd-publish.ts")
src = P.read_text(encoding="utf-8")
orig = len(src)
done = []

# ① fillSkuSpecMulti 加 options 参数
old = """async function fillSkuSpecMulti(
  page: any,
  specs: PddSpecDimension[],
  skuRows: PddSkuRow[],
  category?: string,
): Promise<{ filled: string[]; missed: string[] }> {"""
new = """async function fillSkuSpecMulti(
  page: any,
  specs: PddSpecDimension[],
  skuRows: PddSkuRow[],
  category?: string,
  options?: { mode2?: boolean },
): Promise<{ filled: string[]; missed: string[] }> {"""
if old in src:
    src = src.replace(old, new, 1)
    done.append("① 加 options 参数")
else:
    done.append("① 未找到")

# ② 函数体开头加 multiMode2
old = """  const filled: string[] = []
  const missed: string[] = []
  const dimName = (d?: PddSpecDimension) => String(d?.name || '').trim()
  const valName = (v?: PddSpecValue) => String(v?.value || '').trim()
  const toSkuInputs = (d: PddSpecDimension): PddSkuInput[] =>
    d.values.filter(v => valName(v))
      .map(v => ({ name: valName(v), image: String(v.image || '').trim() || undefined }))
  void skuRows"""
new = """  const filled: string[] = []
  const missed: string[] = []
  /** 模式2：SKU 预览图整体跳过（thumb_url 由改包注入 commitBody.sku） */
  const multiMode2 = !!options?.mode2
  const dimName = (d?: PddSpecDimension) => String(d?.name || '').trim()
  const valName = (v?: PddSpecValue) => String(v?.value || '').trim()
  const toSkuInputs = (d: PddSpecDimension): PddSkuInput[] =>
    d.values.filter(v => valName(v))
      .map(v => ({ name: valName(v), image: String(v.image || '').trim() || undefined }))
  void skuRows"""
if old in src:
    src = src.replace(old, new, 1)
    done.append("② 加 multiMode2")
else:
    done.append("② 未找到")

# ③ 颜色值预览图处改用 multiMode2
old = """      if (cfg?.mode2) { filled.push(`SKU 预览图「${v}」（模式2：thumb_url 注入）`); continue }
    if (!file) { missed.push(`SKU 预览图「${v}」（未提供图片路径）`); continue }"""
new = """      if (multiMode2) { filled.push(`SKU 预览图「${v}」（模式2：thumb_url 注入）`); continue }
      if (!file) { missed.push(`SKU 预览图「${v}」（未提供图片路径）`); continue }"""
if old in src:
    src = src.replace(old, new, 1)
    done.append("③ 颜色值预览图用 multiMode2")
else:
    done.append("③ 未找到")

# ④ 第2维调用改用新参数
old = """    skipImages: true,
    // ★ 模式2：预览图整体跳过（thumb_url 由改包注入），避免死磕 30 行 DOM 上传耗光预算
    mode2: !!opts.mode2,
    category,
  })"""
new = """    skipImages: true,
    // ★ 模式2：预览图整体跳过（thumb_url 由改包注入），避免死磕 30 行 DOM 上传耗光预算
    mode2: multiMode2,
    category,
  })"""
if old in src:
    src = src.replace(old, new, 1)
    done.append("④ 第2维用 multiMode2")
else:
    done.append("④ 未找到")

P.write_text(src, encoding="utf-8")
print(f"原长 {orig} → 新长 {len(src)}")
for d in done:
    print("  " + d)

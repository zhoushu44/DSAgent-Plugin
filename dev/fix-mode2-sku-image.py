#!/usr/bin/env python3
"""模式2 跳过所有 SKU 预览图 DOM 上传（照抄觅千手 thumb_url 注入）。"""
from pathlib import Path

P = Path("src/pdd-publish.ts")
src = P.read_text(encoding="utf-8")
orig = len(src)
done = []

# ── ① cfg 类型加 mode2 字段 ──
old = """      /** 跳过本函数内的预览图投递（多维场景由 `fillSkuSpecMulti` 统一按行投图） */
      skipImages?: boolean"""
new = """      /** 跳过本函数内的预览图投递（多维场景由 `fillSkuSpecMulti` 统一按行投图） */
      skipImages?: boolean
      /** 模式2：跳过所有 SKU 预览图的 DOM 上传（照抄觅千手：thumb_url 由改包注入） */
      mode2?: boolean"""
if old in src:
    src = src.replace(old, new, 1)
    done.append("① cfg 类型加 mode2")
else:
    done.append("① cfg 类型：未找到")

# ── ② 勾「添加图片」也跳过（省时间）──
old = """  if (wantImg && !cfg?.skipImages) {
    const flag = await page.evaluate(() => {"""
new = """  if (wantImg && !cfg?.skipImages && !cfg?.mode2) {
    const flag = await page.evaluate(() => {"""
if old in src:
    src = src.replace(old, new, 1)
    done.append("② 勾「添加图片」跳过")
else:
    done.append("② 勾「添加图片」：未找到")

# ── ③ 颜色值级预览图：模式2 跳过 ──
old = """    if (!file) { missed.push(`SKU 预览图「${v}」（未提供图片路径）`); continue }"""
new = """    if (cfg?.mode2) { filled.push(`SKU 预览图「${v}」（模式2：thumb_url 注入）`); continue }
    if (!file) { missed.push(`SKU 预览图「${v}」（未提供图片路径）`); continue }"""
if old in src:
    src = src.replace(old, new, 1)
    done.append("③ 颜色值预览图跳过")
else:
    done.append("③ 颜色值预览图：未找到")

# ── ④ 行级预览图（fillSkuSpecMulti ⑤）──
old = """  // ── ⑤ 逐行投递「*预览图」（走 fillSkuRowImages：表体行 + rowspan 列映射）──
  if (wantImg && !cfg?.skipImages) {"""
new = """  // ── ⑤ 逐行投递「*预览图」──
  // ★ 模式2 跳过（照抄觅千手：thumb_url 由改包写进 commitBody.sku，不走 DOM）
  if (wantImg && !cfg?.skipImages && !cfg?.mode2) {"""
if old in src:
    src = src.replace(old, new, 1)
    done.append("④ 行级预览图跳过")
else:
    done.append("④ 行级预览图：未找到")

# ── ⑤ fillSkuSpecMulti 调用 fillSkuSpec 时传 mode2 ──
old = """      skipImages: true,
      category,
    })"""
new = """      skipImages: true,
      mode2: !!opts2.mode2,
      category,
    })"""
if old in src:
    src = src.replace(old, new, 1)
    done.append("⑤ 第2维传 mode2")
else:
    done.append("⑤ 第2维传 mode2：未找到")

P.write_text(src, encoding="utf-8")
print(f"原长 {orig} → 新长 {len(src)}")
for d in done:
    print("  " + d)

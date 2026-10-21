#!/usr/bin/env python3
"""补上 ① cfg 加 mode2 字段、⑤ 第2维传 mode2。"""
from pathlib import Path

P = Path("src/pdd-publish.ts")
src = P.read_text(encoding="utf-8")
orig = len(src)
done = []

# ── ① cfg 类型加 mode2 ──
old = """    /** 跳过本函数内的预览图投递（多维场景由 `fillSkuSpecMulti` 统一按行投图） */
    skipImages?: boolean
    /** 类目关键词（SKU 维度缓存键；不传则不查/记缓存，行为与旧版一致） */
    category?: string"""
new = """    /** 跳过本函数内的预览图投递（多维场景由 `fillSkuSpecMulti` 统一按行投图） */
    skipImages?: boolean
    /** 模式2：跳过所有 SKU 预览图的 DOM 上传（照抄觅千手：thumb_url 由改包注入 commitBody.sku） */
    mode2?: boolean
    /** 类目关键词（SKU 维度缓存键；不传则不查/记缓存，行为与旧版一致） */
    category?: string"""
if old in src:
    src = src.replace(old, new, 1)
    done.append("① cfg 类型加 mode2")
else:
    done.append("① 未找到")

# ── ⑤ 第2维调用传 mode2 ──
old = """    // ★ 第 2 维（尺码）由本函数统一按行投图，避免在规格值流程里重复投图
    skipImages: true,
    category,
  })"""
new = """    // ★ 第 2 维（尺码）由本函数统一按行投图，避免在规格值流程里重复投图
    skipImages: true,
    // ★ 模式2：预览图整体跳过（thumb_url 由改包注入），避免死磕 30 行 DOM 上传耗光预算
    mode2: !!opts.mode2,
    category,
  })"""
if old in src:
    src = src.replace(old, new, 1)
    done.append("⑤ 第2维传 mode2")
else:
    done.append("⑤ 未找到")

P.write_text(src, encoding="utf-8")
print(f"原长 {orig} → 新长 {len(src)}")
for d in done:
    print("  " + d)

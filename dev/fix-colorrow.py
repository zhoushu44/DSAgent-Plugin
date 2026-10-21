#!/usr/bin/env python3
"""给 fillSkuSpecColorRow 加 mode2 参数（它在预览图那处需要知道是否模式2）。"""
from pathlib import Path

P = Path("src/pdd-publish.ts")
src = P.read_text(encoding="utf-8")
orig = len(src)
done = []

# ① 签名加参数
old = """async function fillSkuSpecColorRow(
  page: any,
  skus: PddSkuInput[],
): Promise<{ filled: string[]; missed: string[] }> {
  const filled: string[] = []
  const missed: string[] = []
  const wantImg = skus.some(s => String(s.image || '').trim())"""
new = """async function fillSkuSpecColorRow(
  page: any,
  skus: PddSkuInput[],
  options?: { mode2?: boolean },
): Promise<{ filled: string[]; missed: string[] }> {
  const filled: string[] = []
  const missed: string[] = []
  /** 模式2：SKU 预览图跳过（thumb_url 由改包注入） */
  const multiMode2 = !!options?.mode2
  const wantImg = skus.some(s => String(s.image || '').trim())"""
if old in src:
    src = src.replace(old, new, 1)
    done.append("① fillSkuSpecColorRow 加 mode2 参数")
else:
    done.append("① 未找到")

# ② 调用处传参
import re
# 找 fillSkuSpecColorRow(page, ...) 的调用
calls = re.findall(r"fillSkuSpecColorRow\([^)]*\)", src)
done.append(f"② 调用处: {calls}")

old2 = "await fillSkuSpecColorRow(page, toSkuInputs(d1))"
new2 = "await fillSkuSpecColorRow(page, toSkuInputs(d1), { mode2: multiMode2 })"
if old2 in src:
    src = src.replace(old2, new2, 1)
    done.append("② 已传参")
else:
    # 尝试其他形态
    m = re.search(r"fillSkuSpecColorRow\(page,\s*([^)]+)\)", src)
    if m:
        src = src.replace(m.group(0), f"fillSkuSpecColorRow(page, {m.group(1)}, {{ mode2: multiMode2 }})", 1)
        done.append(f"② 已传参（形态2: {m.group(0)}）")
    else:
        done.append("② 未找到调用")

P.write_text(src, encoding="utf-8")
print(f"原长 {orig} → {len(src)}")
for d in done:
    print("  " + d)

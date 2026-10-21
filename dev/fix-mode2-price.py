#!/usr/bin/env python3
"""把「模式2 跳过填价」整块替换成「照抄觅千手：两种模式都填价格表」。

觅千手 startFill 的步骤里，`fillSkuOnPage`（含 fillPriceTable）是**无条件执行**的，
改包只在提交时覆盖。所以模式2 也必须先把价格/库存填进页面，否则：
  · 页面校验「请输入第1行规格的库存」→ 提交按钮 disabled
  · 拦截不到任何提交请求 → 改包根本不会发生
"""
from pathlib import Path

P = Path("src/pdd-publish.ts")
src = P.read_text(encoding="utf-8")

start_mark = "    // 模式2（劫持填价）：跳过 UI 填价，价格列留白，提交时由 pdd-mode2 拦截原生请求改包注入。\n    if (!opts.hijack) {"
i = src.find(start_mark)
if i < 0:
    raise SystemExit("未找到起点标记")

j = src.find("// ── 段 4-b", i)
if j < 0:
    raise SystemExit("未找到段 4-b")

# 回退到该块结束（保留段4-b 前的空行）
# 找 j 之前的最后一个 "    }\n"
k = src.rfind("    }\n", i, j)
if k < 0:
    raise SystemExit("未找到块结尾")

new_block = '''    /**
     * 价格及库存 SKU 表：**两种模式都填**（照抄觅千手 startFill 的 spec 步骤）。
     *
     * 觅千手原文（m_042_8087 startFill）：
     *     await this.withMoveTimerStep(e,"spec",(() => this.fillSkuOnPage(e)))
     * 而 fillSkuOnPage 内部末尾就是 `await this.fillPriceTable(e, s, o)` ——
     * **无论是否走劫持，页面上的价格表都会被填**；劫持只在提交时覆盖一遍。
     *
     * ★★ 为什么必须填（2026-10-20 实测）：
     *   之前模式2 整段跳过填价，结果页面报「错误（1）… 请输入第1行规格的库存」，
     *   提交按钮 disabled → `模式2 提交按钮点击：未点到` → 等 120s 后 PDD_HIJACK_WAIT_TIMEOUT。
     *   改包发生在「提交请求发出之后」，页面不让点提交，改包永远不会触发。
     *
     *   所以正确顺序是：先在页面把价格/库存填好 → 能点提交 → 拦截 → 改包覆盖。
     */
    {
      const priceRows = specs.length
        ? skuRows.map(r => ({ price: r.price, stock: r.stock, specs: r.specs }))
        : skus.map(s => ({ price: s.price, stock: s.stock }))
      const sku = await withStallWatch(
        step2, '第二步-价格及库存', 180_000,
        () => fillPriceTable(step2, {
          price, stock, itemNo,
          // 逐行覆盖：第 i 行对应第 i 个规格值；缺项自动回落到顶层 price / stock
          rows: priceRows,
        }),
      )
      filled.push(...sku.filled)
      missed.push(...sku.missed)
      diag(`价格表填充：已填 ${sku.filled.length} 项；未填 ${sku.missed.length} 项`)
      console.log(`[dsagent-pdd-publish] 通用字段已填：${filled.join('、') || '（无）'}；未命中：${missed.join('、') || '（无）'}`)
      await sleep(1500)
    }
'''

out = src[:i] + new_block + src[k + len("    }\n"):]
P.write_text(out, encoding="utf-8")
print("已替换")
print(f"原块长度: {k + 6 - i}")
print(f"新块长度: {len(new_block)}")

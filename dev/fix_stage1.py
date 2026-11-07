# -*- coding: utf-8 -*-
"""
核心修复：段1 不再点「发布新商品」，直接 goto 类目页 URL

★ 问题
  点「发布新商品」→ 新开标签页 → beforePages 快照/fresh 过滤不可靠
  → selectCategory 拿到的还是商品列表页 → 「无类目搜索框」跳过 → 全盘跑偏
  → 视觉分析反复重试 → 浏览器崩溃 → Protocol error 全批失败

★ 修复
  直接 goto https://mms.pinduoduo.com/goods/category
  这是拼多多的类目选择页，不需要点按钮、不涉及新标签页。
  然后 selectCategory 就能找到搜索框了。

★ 顺带
  ① vision 重试上限 4 次 × 14 个值 = 56 次截图，浏览器会崩
     改为单个值最多 2 次，且同一维度连续 3 个值失败就放弃整维
  ② 每 5 个商品重启一次浏览器（防内存累积）
"""
from pathlib import Path

# ── ① 段1 改 goto ──
f1 = Path(r'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\skills\pdd-publish-http\scripts\batch-publish.mjs')
s1 = f1.read_text(encoding='utf-8')

OLD = '''    await openPublishEntry(page, { log })

    // 只在新出现的页面里找发布页'''

NEW = '''    // ★ 2026-11-03 核心修复：直接 goto 类目页，不点「发布新商品」
    //   点按钮 → 新开标签页 → beforePages/fresh 过滤不可靠 → selectCategory 拿到列表页 → 全盘跑偏
    //   goto 是同步的，不涉及新标签页，100% 稳。
    log('段1：直达类目页（不点发布按钮）')
    await page.goto('https://mms.pinduoduo.com/goods/category', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => log(`  goto 警告：${String(e.message).slice(0, 60)}`))

    // 等类目页就绪（搜索框出现）
    {
      let ok = false
      for (let w = 0; w < 30; w++) {
        await sleep(300)
        ok = await page.evaluate(() => !!document.querySelector('input[placeholder*="搜索分类"]')).catch(() => false)
        if (ok) break
      }
      if (ok) {
        log('  类目页已就绪')
        work = page
      } else {
        log('  ⚠ 类目页 9s 未就绪，回退点按钮方式')
        await openPublishEntry(page, { log })
      }
    }

    // 上面失败才走原来的「等新标签页」'''

if OLD in s1:
    s1 = s1.replace(OLD, NEW, 1)
    print('OK: 段1 改 goto 类目页')
else:
    print('NOT FOUND: 段1')

f1.write_text(s1, encoding='utf-8')

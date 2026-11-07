# -*- coding: utf-8 -*-
"""回滚段1：恢复 catId 直达（睡衣模板有 catId，这是验证过的路径）"""
from pathlib import Path

f = Path(r'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\skills\pdd-publish-http\scripts\batch-publish.mjs')
s = f.read_text(encoding='utf-8')

START = "    // ★ 2026-11-03 核心修复：直接 goto 类目页，不点「发布新商品」"
END = "    // 上面失败才走原来的「等新标签页」"

i = s.find(START)
j = s.find(END)
if i < 0 or j < 0:
    print('NOT FOUND', i, j)
    raise SystemExit(1)

NEW = '''    // ★ 2026-11-03：模板有 catId 时直达表单页（睡衣等老类目，省 6s）
    //   ⚠ 这条是验证过的路径（睡衣 1023974144424 就是这么上架的），
    //     不要改成 goto 类目页 —— 实测 goods/category 是「发布新商品第一步」
    //     （主图+标题），没有类目搜索框。
    const catIdDirect = String(tpl?.catId || '').trim()
    if (!connected && catIdDirect) {
      log(`段1+2：catId=${catIdDirect} 直达表单页`)
      const directUrl = `https://mms.pinduoduo.com/goods/goods_add/index?type=add&from=category&id=${catIdDirect}`
      await page.goto(directUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => log(`  goto 警告：${String(e.message).slice(0, 60)}`))
      let ready = false
      for (let w = 0; w < 40; w++) {
        await sleep(300)
        ready = await page.evaluate(() => {
          const hasProp = document.querySelectorAll('[id^="basic.propertys."]').length > 0
          const hasTitle = !!document.querySelector('input[placeholder*="标题"]')
          return hasProp || (hasTitle && !!document.querySelector('#goods-category'))
        }).catch(() => false)
        if (ready) break
      }
      if (ready) {
        log(`  直达页已就绪（${catIdDirect}）`)
        work = page
      } else {
        log('  ⚠ 直达页未就绪，回退常规流程')
      }
    }

    if (!work) {
      await openPublishEntry(page, { log })
      // 等新出现的发布页（原逻辑）'''

s = s[:i] + NEW + s[j + len(END):]
f.write_text(s, encoding='utf-8')
print('OK: 段1 已回滚为 catId 直达')

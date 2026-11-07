# -*- coding: utf-8 -*-
"""去掉 batch-publish 里重复的 catId 直达（selectCategory 里已有一份，会重复等 129s）"""
from pathlib import Path

f = Path(r'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\skills\pdd-publish-http\scripts\batch-publish.mjs')
s = f.read_text(encoding='utf-8')

START = "    // ★ 2026-11-03：模板有 catId 时直达表单页"
END = "    if (!work) {"

i = s.find(START)
j = s.find(END)
if i < 0 or j < 0:
    print('NOT FOUND', i, j)
    raise SystemExit(1)

NEW = '''    // ★ 2026-11-03：模板有 catId 时直达表单页（省 6s）
    //   ⚠ 只做 goto，不做「等就绪」—— selectCategory 里有完整的直达+等待，
    //     在这里也等一次会重复等 129s（实测睡衣踩过）。
    const catIdDirect = String(tpl?.catId || '').trim()
    if (catIdDirect) {
      log(`段1：catId=${catIdDirect} 直达表单页`)
      const directUrl = `https://mms.pinduoduo.com/goods/goods_add/index?type=add&from=category&id=${catIdDirect}`
      await page.goto(directUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => log(`  goto 警告：${String(e.message).slice(0, 60)}`))
      work = page
    }

'''

s = s[:i] + NEW + s[j:]
f.write_text(s, encoding='utf-8')
print('OK: batch 里只保留 goto，去掉重复等待')

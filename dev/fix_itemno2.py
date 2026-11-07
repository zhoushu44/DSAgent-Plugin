# -*- coding: utf-8 -*-
"""修 SKU 预览图行数不匹配 + 货号格式

① 行数不匹配：平台展开 10 行，数据只有 9 SKU → 第 10 行无图
   修法：按 index 循环分配图片，多余行用最后一张兜底

② 货号格式：SKU 表「规格编码」列填 SKU001 被平台判「格式不正确」
   修法：规格编码改成纯数字（拼多多货号常见纯数字），或留空让平台自动生成
"""
from pathlib import Path

f = Path(r'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\skills\pdd-publish-http\scripts\sku-table.mjs')
s = f.read_text(encoding='utf-8')

OLD = """    const ovItemNo = String(ov.itemNo || '').trim()
    const rowItemNo = ovItemNo || `SKU${String(ri + 1).padStart(3, '0')}`"""

NEW = """    // ★ 2026-11-03：规格编码（货号）改成纯数字
    //   实测睡衣：填 SKU001 → 平台报「商品货号格式不正确」，提交被拦
    //   拼多多货号通常是纯数字，改成 6 位序号
    const ovItemNo = String(ov.itemNo || '').trim()
    const rowItemNo = ovItemNo.replace(/[^0-9]/g, '') || String(100001 + ri)"""

if OLD in s:
    s = s.replace(OLD, NEW, 1)
    print('OK: 规格编码改纯数字')
else:
    print('NOT FOUND: 规格编码')

f.write_text(s, encoding='utf-8')

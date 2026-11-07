# -*- coding: utf-8 -*-
"""
修「商品货号」被填成中文（平台报「商品货号格式不正确」）

实测：basic.propertys.7.value 的值是「MHJ-拼接袖莫代尔套装」——
      这是商品标题/规格描述，被属性填写逻辑错填进货号框。
      拼多多货号只接受字母、数字、- _ 等，中文一律报错。

修法：
  ① attr-fill-generic 里「商品货号」字段，用户没提供就【留空】（不猜不匹配）
  ② product.json 的 itemNo 有值也先清洗成纯 ASCII
  ③ SKU 表规格编码列已经是纯数字，保持不变
"""
from pathlib import Path

f = Path(r'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\skills\pdd-publish-http\scripts\attr-fill-generic.mjs')
s = f.read_text(encoding='utf-8')

# 在用户值映射处加「货号」特例：只接受纯 ASCII，否则跳过
OLD = """    const userMap = new Map()
    for (const a of attributes) {
      const n = String(a.name || '').replace(/\\s+/g, '')
      if (n && a.value) userMap.set(n, String(a.value).trim())
    }"""

NEW = """    const userMap = new Map()
    for (const a of attributes) {
      const n = String(a.name || '').replace(/\\s+/g, '')
      if (n && a.value) userMap.set(n, String(a.value).trim())
    }
    // ★ 2026-11-03：货号字段只接受纯 ASCII（字母数字-_）
    //   实测睡衣：货号被填成「MHJ-拼接袖莫代尔套装」→ 平台报「商品货号格式不正确」
    for (const [k, v] of userMap) {
      if (/货号|编码|货号编码/.test(k)) {
        const ascii = String(v).replace(/[^A-Za-z0-9_\\-]/g, '')
        if (ascii) userMap.set(k, ascii)
        else userMap.delete(k)   // 清洗后为空 → 不填，让平台自动生成
      }
    }"""

if OLD in s:
    s = s.replace(OLD, NEW, 1)
    print('OK: 货号只接受纯 ASCII')
else:
    print('NOT FOUND userMap')

f.write_text(s, encoding='utf-8')

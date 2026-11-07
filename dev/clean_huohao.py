# -*- coding: utf-8 -*-
"""清理模板里的中文货号 + 模板直填也过滤货号"""
import json
import re
from pathlib import Path

TPL = Path(r'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\skills\pdd-publish-http\assets\category-template.json')

data = json.loads(TPL.read_text(encoding='utf-8'))
cleaned = 0

for cat, t in data.items():
    for key in ('attrs', 'requiredAttrs'):
        for a in (t.get(key) or []):
            if not isinstance(a, dict):
                continue
            name = str(a.get('name') or '')
            if re.search(r'货号|商品编码', name):
                v = str(a.get('value') or '')
                ascii_v = re.sub(r'[^A-Za-z0-9_\-]', '', v)
                if ascii_v != v:
                    print(f"  {cat} / {name}: {v!r} -> {ascii_v!r}")
                    a['value'] = ascii_v
                    cleaned += 1
                if not ascii_v:
                    a['value'] = ''
                    a['options'] = []
                    print(f"  {cat} / {name}: 清空（无 ASCII 部分）")

TPL.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
print(f"\n清理 {cleaned} 个中文货号")

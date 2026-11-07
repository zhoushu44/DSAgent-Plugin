# -*- coding: utf-8 -*-
"""修正解析路径：items 在 payload.data.data.OFFER.items"""
from pathlib import Path

f = Path(r'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\dev\real_pick.py')
s = f.read_text(encoding='utf-8')

OLD = """        items = (((res or {}).get('data') or {}).get('data') or {}).get('items') \\
            or ((res or {}).get('data') or {}).get('items') or []
        if not items:
            # 打印结构帮排查
            print(f'  ⚠ 无结果，返回结构：{json.dumps(res, ensure_ascii=False)[:300]}', flush=True)
            fail += 1
            failed.append(kw)
            time.sleep(5)
            continue"""

NEW = """        # ★ 实测路径：payload.data.data.OFFER.items（2026-11-03）
        #   payload.data.data.result 是空的，不能拿它判断
        offer = ((((res or {}).get('payload') or {}).get('data') or {}).get('data') or {}).get('OFFER') or {}
        items = offer.get('items') or []
        if not items:
            # 兜底：再试几条常见路径
            d1 = ((res or {}).get('data') or {}).get('data') or {}
            items = d1.get('items') or (((res or {}).get('data') or {})).get('items') or []
        if not items:
            print(f'  ⚠ 无结果，found={offer.get("found")}，结构：{json.dumps(res, ensure_ascii=False)[:200]}', flush=True)
            fail += 1
            failed.append(kw)
            time.sleep(5)
            continue"""

if OLD in s:
    s = s.replace(OLD, NEW, 1)
    print('OK: 解析路径已修正')
else:
    print('NOT FOUND')

f.write_text(s, encoding='utf-8')

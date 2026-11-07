# -*- coding: utf-8 -*-
"""修正 real_pick.py 的字段提取（真实路径 item.data）"""
from pathlib import Path

f = Path(r'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\dev\real_pick.py')
s = f.read_text(encoding='utf-8')

OLD = """        # ★ 实测路径：payload.data.data.OFFER.items（2026-11-03）
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
            continue

        # 取第 1 款
        it = items[0]
        d = out / f'item-{i + 1:03d}-{kw}'
        d.mkdir(parents=True, exist_ok=True)
        payload = {
            'keyword': kw,
            'picked': it,
            'candidates': items[:5],
            'ts': time.strftime('%Y-%m-%dT%H:%M:%S'),
        }
        (d / 'picked.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
        title = it.get('title') or it.get('subject') or ''
        print(f"  ✅ {title[:40]} | {it.get('currentPrice', '?')}元 | ID={it.get('itemId') or it.get('offerId')}", flush=True)
        ok += 1"""

NEW = """        # ★ 实测路径（2026-11-03）：payload.data.data.OFFER.items[].data
        #   items[] 本身只有 trackInfo/cellType，真实字段在 .data 里
        offer = ((((res or {}).get('payload') or {}).get('data') or {}).get('data') or {}).get('OFFER') or {}
        raw_items = offer.get('items') or []
        if not raw_items:
            print(f'  ⚠ 无结果，found={offer.get("found")}', flush=True)
            fail += 1
            failed.append(kw)
            time.sleep(5)
            continue

        # 提取关键字段
        def extract(raw):
            d = (raw or {}).get('data') or {}
            pi = d.get('priceInfo') or {}
            price = pi.get('price') or ''
            # 标题去掉 <font color=red> 高亮标签
            title = (d.get('title') or '').replace('<font color=red>', '').replace('</font>', '')
            return {
                'offerId': d.get('offerId') or '',
                'title': title,
                'price': price,
                'priceDesc': pi.get('priceDescription') or '',
                'loginId': d.get('loginId') or '',
                'province': d.get('province') or '',
                'city': d.get('city') or '',
                'bizType': d.get('bizType') or '',
                'bookedCount': d.get('bookedCount') or 0,
                'offerPicUrl': d.get('offerPicUrl') or '',
                'linkUrl': d.get('linkUrl') or '',
                'repurchaseRate': d.get('offerRepurchaseRate') or '',
                'factoryInspection': d.get('factoryInspection') or False,
                'superFactory': d.get('superFactory') or False,
                'quantityPrices': ((d.get('shopAddition') or {}).get('quantityPrices')),
            }

        items = [extract(r) for r in raw_items]
        items = [x for x in items if x['offerId'] and x['title']]
        if not items:
            print('  ⚠ 提取后无有效商品', flush=True)
            fail += 1
            failed.append(kw)
            time.sleep(5)
            continue

        # 取第 1 款
        it = items[0]
        d = out / f'item-{i + 1:03d}-{kw}'
        d.mkdir(parents=True, exist_ok=True)
        payload = {
            'keyword': kw,
            'picked': it,
            'candidates': items[:5],
            'found': offer.get('found'),
            'ts': time.strftime('%Y-%m-%dT%H:%M:%S'),
        }
        (d / 'picked.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f"  ✅ {it['title'][:36]} | {it['price']}元 | {it['province']}{it['city']} | ID={it['offerId']}", flush=True)
        ok += 1"""

if OLD in s:
    s = s.replace(OLD, NEW, 1)
    print('OK: 字段提取已修正')
else:
    print('NOT FOUND')

f.write_text(s, encoding='utf-8')

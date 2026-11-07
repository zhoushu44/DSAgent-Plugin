#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
真实选品：调 1688 网关搜索 + 抓详情页素材包

用法：
  python dev/real_pick.py --keywords "保温杯,抱枕" --count 20 --out <dir>
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent / 'skills' / 'alibaba-product-find' / 'scripts'
sys.path.insert(0, str(BASE))

from _1688_gateway import search_products  # noqa

# 20 个不同类目关键词（避免同款重复）
KEYWORDS = [
    '保温杯', '抱枕靠垫', '纯棉毛巾', '收纳箱', '手机壳',
    '厨房湿巾', '洗衣袋', '拖鞋', '隔热垫', '牙刷架',
    '垃圾桶', '衣架', '脏衣篮', '纸巾盒', '洗碗巾',
    '保温袋', '数据线', '收纳盒', '浴巾', '睡衣家居服',
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--keywords', default='')
    ap.add_argument('--count', type=int, default=20)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()

    kws = [k.strip() for k in args.keywords.split(',') if k.strip()] if args.keywords else KEYWORDS
    kws = kws[:args.count]

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    ok, fail = 0, 0
    failed = []

    for i, kw in enumerate(kws):
        print(f'\n[{i + 1}/{len(kws)}] 搜索：{kw}', flush=True)
        try:
            res = search_products(query=kw, page_size=10, score_level='high')
        except Exception as e:
            print(f'  ❌ 搜索失败：{str(e)[:120]}', flush=True)
            fail += 1
            failed.append(kw)
            time.sleep(5)
            continue

        # ★ 实测路径（2026-11-03）：payload.data.data.OFFER.items[].data
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
        ok += 1

        if i < len(kws) - 1:
            time.sleep(5)   # 风控间隔

    print(f'\n=== 选品完成：成功 {ok}/{len(kws)} ===', flush=True)
    if failed:
        print(f'失败：{", ".join(failed)}', flush=True)


if __name__ == '__main__':
    main()

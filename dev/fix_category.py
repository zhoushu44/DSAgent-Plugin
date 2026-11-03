# -*- coding: utf-8 -*-
"""给 real20 商品补拼多多类目（按关键词映射到已验证的类目）"""
import json
from pathlib import Path

ROOT = Path(r'E:\360MoveData\Users\Administrator\Desktop\童装\artifacts\real20')

# 拼多多类目映射（这些类目都跑通过、有模板）
CAT_MAP = {
    '保温杯': '水杯',
    '抱枕靠垫': '抱枕',
    '纯棉毛巾': '毛巾',
    '收纳箱': '收纳盒',
    '手机壳': '手机壳',
    '厨房湿巾': '纸杯',      # 清洁用品，用纸杯类目跑通过
    '洗衣袋': '收纳盒',
    '拖鞋': '毛巾',          # 无鞋类模板，先用毛巾
    '隔热垫': '纸杯',
    '牙刷架': '收纳盒',
    '垃圾桶': '收纳盒',
    '衣架': '收纳盒',
    '脏衣篮': '收纳盒',
    '纸巾盒': '收纳盒',
    '洗碗巾': '毛巾',
    '保温袋': '纸杯',
    '数据线': '手机壳',
    '收纳盒': '收纳盒',
    '浴巾': '毛巾',
    '睡衣家居服': '儿童睡衣',   # 睡衣类目跑通过
}

fixed = 0
for d in sorted(ROOT.iterdir()):
    if not d.is_dir():
        continue
    pj = d / 'product.json'
    if not pj.exists():
        continue
    p = json.loads(pj.read_text(encoding='utf-8'))
    if p.get('category'):
        continue

    # 从目录名取关键词
    name = d.name
    key = name.split('-', 1)[1] if '-' in name else name

    cat = CAT_MAP.get(key, '')
    if not cat:
        # 模糊匹配
        for k, v in CAT_MAP.items():
            if k in key or key in k:
                cat = v
                break

    if cat:
        p['category'] = cat
        pj.write_text(json.dumps(p, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'  ✅ {name} → category={cat}')
        fixed += 1
    else:
        print(f'  ⚠ {name} → 无匹配类目')

print(f'\n补类目完成：{fixed} 个')

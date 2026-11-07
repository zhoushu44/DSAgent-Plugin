# -*- coding: utf-8 -*-
"""修睡衣商品数据：① 图片路径 ② SKU 预览图 ③ itemNo"""
import json
import re
from pathlib import Path

ROOT = Path(r'E:\360MoveData\Users\Administrator\Desktop\童装\artifacts\pajama_run')

fixed = 0
for d in sorted(ROOT.iterdir()):
    if not d.is_dir():
        continue
    pj = d / 'product.json'
    if not pj.exists():
        continue
    p = json.loads(pj.read_text(encoding='utf-8'))
    changed = []

    # ① 收集本地存在的图片（img/ 目录 + product.images）
    img_dir = d / 'img'
    avail = []
    if img_dir.exists():
        avail = [str(x) for x in sorted(img_dir.iterdir()) if x.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp')]
    # images 里已是本地且存在的
    for im in (p.get('images') or []):
        if not str(im).startswith('http') and Path(im).exists() and str(im) not in avail:
            avail.append(str(im))

    if avail:
        p['images'] = avail[:5]
        p['detailImages'] = avail[5:20]
        changed.append(f'图 {len(avail)}')

    # ② SKU 预览图：按 index 分配，坏路径一律替换
    for i, sk in enumerate(p.get('skus') or []):
        iu = sk.get('imageUrl') or sk.get('image') or ''
        if (not iu) or str(iu).startswith('http') or not Path(str(iu)).exists():
            if avail:
                sk['imageUrl'] = avail[i % len(avail)]
        else:
            sk['imageUrl'] = str(iu)
        # ③ itemNo 清掉非法字符（只留字母数字-_）
        iNo = sk.get('itemNo') or ''
        iNo = re.sub(r'[^A-Za-z0-9_\-]', '', str(iNo))
        sk['itemNo'] = iNo or f'SKU{i + 1:03d}'
        sk['stock'] = '100'

    # 顶层 itemNo 也清
    if p.get('itemNo'):
        p['itemNo'] = re.sub(r'[^A-Za-z0-9_\-]', '', str(p['itemNo']))

    pj.write_text(json.dumps(p, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"  OK {d.name}: {', '.join(changed)} | SKU {len(p.get('skus') or [])}")
    fixed += 1

print(f'\n修复 {fixed} 个商品')

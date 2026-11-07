# -*- coding: utf-8 -*-
"""检查 real20 商品的图片是本地文件还是 URL"""
import json
from pathlib import Path

root = Path(r'E:\360MoveData\Users\Administrator\Desktop\童装\artifacts\real20')
urls, locals_ = 0, 0
for d in sorted(root.iterdir()):
    if not d.is_dir():
        continue
    pj = d / 'product.json'
    if not pj.exists():
        continue
    p = json.loads(pj.read_text(encoding='utf-8'))
    for img in (p.get('images') or [])[:1]:
        if img.startswith('http'):
            urls += 1
        else:
            locals_ += 1
        break

print(f'URL 图片: {urls} 个商品')
print(f'本地图片: {locals_} 个商品')
print()
p = json.loads((root / 'item-001-保温杯' / 'product.json').read_text(encoding='utf-8'))
print('示例 images[0..2]:')
for i in p['images'][:3]:
    print(' ', i)
print('detailImages[0..1]:')
for i in p['detailImages'][:2]:
    print(' ', i)

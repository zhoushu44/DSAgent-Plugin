# -*- coding: utf-8 -*-
"""换全新标题（避开平台防重复铺货），只改 title，其他不动"""
import json
from pathlib import Path

ROOT = Path(r'E:\360MoveData\Users\Administrator\Desktop\童装\artifacts\pajama_run')

# 全新标题（跟店里已有的都不同）
NEW_TITLES = {
    'item-001-pajama': '儿童莫代尔睡衣套装春秋季男女童圆领长袖长裤家居服两件套',
    'item-004-pajama': '女童珊瑚绒睡衣秋冬加厚法兰绒套装女孩家居服可外穿',
    'item-005-pajama': '儿童无骨秋衣秋裤套装纯棉A类磨毛保暖内衣男女童睡衣',
    'item-006-pajama': '宝宝秋衣秋裤秋冬保暖内衣套装儿童家居服长袖睡衣',
}

for name, title in NEW_TITLES.items():
    pj = ROOT / name / 'product.json'
    if not pj.exists():
        print(f'  跳过 {name}')
        continue
    p = json.loads(pj.read_text(encoding='utf-8'))
    old = p.get('title') or ''
    p['title'] = title
    pj.write_text(json.dumps(p, ensure_ascii=False, indent=2), encoding='utf-8')
    hanzi = sum(1 for c in title if '\u4e00' <= c <= '\u9fa5')
    print(f'  {name}:')
    print(f'    旧: {old[:40]}')
    print(f'    新: {title}（{hanzi} 汉字）')

print('\n标题已更新')

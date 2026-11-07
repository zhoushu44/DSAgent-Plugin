# -*- coding: utf-8 -*-
"""准备 5 个睡衣商品用于批量上架"""
import json
import shutil
from pathlib import Path

BASE = Path(r'E:\360MoveData\Users\Administrator\Desktop\童装\artifacts\pajama\out')
DST = Path(r'E:\360MoveData\Users\Administrator\Desktop\童装\artifacts\pajama_run')

SRCS = [
    'chain/chain-01',
    'chain/chain-01/pick/packs/1084259271627',
    'chain/chain-01/pick/packs/892895885121',
    'wf/1/ai',
    'wf/2/ai',
    'wf/3/ai',
]

if DST.exists():
    shutil.rmtree(DST, ignore_errors=True)
DST.mkdir(parents=True, exist_ok=True)

n = 0
for s in SRCS:
    src = BASE / s
    pj = src / 'product.json'
    if not pj.exists():
        print(f'  跳过 {s}')
        continue
    try:
        p = json.loads(pj.read_text(encoding='utf-8'))
        n += 1
        name = f'item-{n:03d}-pajama'
        dst = DST / name
        shutil.copytree(src, dst, dirs_exist_ok=True)
        p['category'] = '儿童睡衣'
        (dst / 'product.json').write_text(json.dumps(p, ensure_ascii=False, indent=2), encoding='utf-8')
        imgs = p.get('images') or []
        local = sum(1 for i in imgs if not str(i).startswith('http') and Path(i).exists())
        print(f'  OK {name} <- {s}')
        print(f'     {(p.get("title") or "")[:32]} | SKU {len(p.get("skus") or [])} | 属性 {len(p.get("attributes") or [])} | 图 {len(imgs)} (本地 {local})')
    except Exception as e:
        print(f'  ERR {s}: {str(e)[:100]}')

print(f'\n共 {n} 个睡衣商品 -> {DST}')

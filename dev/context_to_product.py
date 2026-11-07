# -*- coding: utf-8 -*-
"""
把 scrape_offer.mjs 产出的 context.json 转成 PDD 商品 JSON（修正版）

context.json 真实结构（2026-11-03 实测）：
  result.data.<模块>.fields
    · productTitle.fields.title            标题
    · gallery.fields.offerImgList[37]      图片
    · gallery.fields.mainImage[5]
    · sku.fields / skuInfo                  SKU
    · attributes / props                   属性

用法：python dev/context_to_product.py <目录>...
"""
import json
import re
import sys
from pathlib import Path


def collect_fields(node, out=None, depth=0, path=''):
    """递归收集所有 *.fields 的内容，按模块名索引"""
    if out is None:
        out = {}
    if depth > 6 or not isinstance(node, dict):
        return out
    for k, v in node.items():
        p = f'{path}.{k}' if path else k
        if k == 'fields' and isinstance(v, dict):
            # 记录父模块名
            mod = path.split('.')[-1] if path else 'root'
            out.setdefault(mod, []).append(v)
        if isinstance(v, dict):
            collect_fields(v, out, depth + 1, p)
        elif isinstance(v, list):
            for i, item in enumerate(v[:5]):
                if isinstance(item, dict):
                    collect_fields(item, out, depth + 1, f'{p}[{i}]')
    return out


def get_title(mods):
    for name in ('productTitle', 'offerTitle', 'title'):
        for f in mods.get(name, []):
            t = f.get('title') or f.get('subject') or f.get('offerTitle')
            if t:
                return re.sub(r'\s*-\s*阿里巴巴\s*$', '', str(t)).strip()
    return ''


def get_images(mods):
    urls = []
    for f in mods.get('gallery', []):
        for key in ('offerImgList', 'mainImage', 'images', 'imageList'):
            for im in (f.get(key) or []):
                if isinstance(im, str):
                    u = im
                elif isinstance(im, dict):
                    u = im.get('originalImageURL') or im.get('imageURL') or im.get('url') or im.get('src')
                else:
                    u = ''
                if u:
                    if u.startswith('//'):
                        u = 'https:' + u
                    if u.startswith('http') and u not in urls:
                        urls.append(u)
    return urls


def get_dims_and_skus(mods):
    """SKU 维度 + SKU 行"""
    dims = []
    skus = []

    # 维度候选
    dim_sources = []
    for name in ('sku', 'skuInfo', 'skuModule', 'priceModule'):
        dim_sources.extend(mods.get(name, []))
    for f in dim_sources:
        # 结构 1：{ skuProps: [{prop, values:[{name}]}] }
        for sp in (f.get('skuProps') or []):
            if not isinstance(sp, dict):
                continue
            pname = sp.get('prop') or sp.get('propName') or sp.get('name')
            vals = []
            for v in (sp.get('values') or sp.get('value') or []):
                vn = v if isinstance(v, str) else (v.get('name') or v.get('text') or v.get('value'))
                if vn:
                    vals.append({'value': str(vn)})
            if pname and vals:
                dims.append({'name': pname, 'values': vals})
        # 结构 2：{ skuInfos: [{specs, price}] }
        for si in (f.get('skuInfos') or f.get('skuList') or []):
            if not isinstance(si, dict):
                continue
            spec = {}
            for s in (si.get('specs') or si.get('specValues') or []):
                sn = s.get('specName') or s.get('name') or s.get('propName')
                sv = s.get('specValue') or s.get('value') or s.get('name')
                if sn and sv:
                    spec[sn] = str(sv)
            price = si.get('price') or si.get('salePrice') or si.get('discountPrice') or ''
            if isinstance(price, dict):
                price = price.get('amount') or price.get('value') or ''
            price = re.sub(r'[^\d.]', '', str(price))
            if spec:
                skus.append({'specs': spec, 'price': price, 'stock': '100'})
        # 结构 3：直接就是 SKU 表 { skus: [...] }
        for s in (f.get('skus') or []):
            if not isinstance(s, dict):
                continue
            spec = s.get('specs') or s.get('spec') or {}
            if not isinstance(spec, dict):
                spec = {}
            price = s.get('price') or s.get('salePrice') or ''
            if isinstance(price, dict):
                price = price.get('amount') or price.get('value') or ''
            price = re.sub(r'[^\d.]', '', str(price))
            if spec:
                skus.append({'specs': {str(k): str(v) for k, v in spec.items()}, 'price': price, 'stock': '100'})

    # 从 productPackInfo 兜底（件重尺里有 sku1/sku2）
    if not dims:
        for f in mods.get('productPackInfo', []):
            s1, s2 = set(), set()
            for pw in (f.get('pieceWeightScale', {}) or {}).get('pieceWeightScaleInfo', []) or []:
                if pw.get('sku1'):
                    s1.add(str(pw['sku1']))
                if pw.get('sku2'):
                    s2.add(str(pw['sku2']))
            if s1:
                dims.append({'name': '颜色', 'values': [{'value': v} for v in sorted(s1)]})
            if s2:
                dims.append({'name': '规格', 'values': [{'value': v} for v in sorted(s2)]})

    # SKU 从件重尺兜底
    if not skus and dims:
        for f in mods.get('productPackInfo', []):
            seen = set()
            for pw in (f.get('pieceWeightScale', {}) or {}).get('pieceWeightScaleInfo', []) or []:
                spec = {}
                if pw.get('sku1'):
                    spec[dims[0]['name']] = str(pw['sku1'])
                if pw.get('sku2') and len(dims) > 1:
                    spec[dims[1]['name']] = str(pw['sku2'])
                if spec and tuple(sorted(spec.items())) not in seen:
                    seen.add(tuple(sorted(spec.items())))
                    skus.append({'specs': spec, 'price': '', 'stock': '100'})

    # 维度名去重
    uniq = []
    names = set()
    for d in dims:
        if d['name'] not in names:
            names.add(d['name'])
            uniq.append(d)
    return uniq[:2], skus[:30]


def get_attrs(mods):
    attrs = []
    seen = set()
    for name in ('attributes', 'props', 'offerProps', 'productAttributes', 'baseInfo'):
        for f in mods.get(name, []):
            items = f.get('attributes') or f.get('props') or f.get('items') or []
            if isinstance(items, dict):
                items = [{'name': k, 'value': v} for k, v in items.items()]
            for a in items:
                if not isinstance(a, dict):
                    continue
                n = a.get('name') or a.get('propName') or a.get('attrName')
                v = a.get('value') or a.get('attrValue') or a.get('propValue')
                if n and v and n not in seen:
                    seen.add(n)
                    attrs.append({'name': str(n), 'value': str(v).strip()})
    return attrs[:40]


def get_price(mods):
    for name in ('price', 'priceInfo', 'priceModule', 'trade'):
        for f in mods.get(name, []):
            for k in ('price', 'salePrice', 'startPrice', 'minPrice'):
                v = f.get(k)
                if isinstance(v, dict):
                    v = v.get('amount') or v.get('value')
                if v:
                    return re.sub(r'[^\d.]', '', str(v))
    # 从 SKU 价格兜底
    return ''


def extract(ctx):
    r = ctx.get('result') or {}
    mods = collect_fields(r)
    dims, skus = get_dims_and_skus(mods)
    images = get_images(mods)
    return {
        'title': get_title(mods),
        'images': images[:5],
        'detailImages': images[5:20],
        'specs': dims,
        'skus': skus,
        'attributes': get_attrs(mods),
        'price': get_price(mods),
        'stock': '100',
    }


def main():
    args = sys.argv[1:]
    # 支持 @file 读取目录列表（避免命令行长度/中文问题）
    if len(args) == 1 and args[0].startswith('@'):
        list_file = Path(args[0][1:])
        if list_file.exists():
            args = [l.strip() for l in list_file.read_text(encoding='utf-8').splitlines() if l.strip()]
    if not args:
        print('用法: context_to_product.py <目录>... 或 @<列表文件>')
        return 1
    ok = 0
    for d in sys.argv[1:]:
        cf = Path(d) / 'context.json'
        if not cf.exists():
            print(f'  [WARN] {Path(d).name}: 无 context.json')
            continue
        try:
            ctx = json.loads(cf.read_text(encoding='utf-8'))
            p = extract(ctx)
            if not p['title']:
                print(f'  [WARN] {Path(d).name}: 标题为空')
                continue
            (Path(d) / 'product.json').write_text(
                json.dumps(p, ensure_ascii=False, indent=2), encoding='utf-8')
            print(f"  [OK] {Path(d).name}: {p['title'][:30]} | 图 {len(p['images'])}+{len(p['detailImages'])} "
                  f"| 维度 {len(p['specs'])} | SKU {len(p['skus'])} | 属性 {len(p['attributes'])}")
            ok += 1
        except Exception as e:
            print(f'  [ERR] {Path(d).name}: {str(e)[:120]}')
    print(f'\n转换完成：{ok} 个')
    return 0


if __name__ == '__main__':
    sys.exit(main())

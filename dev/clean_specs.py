# -*- coding: utf-8 -*-
"""
清洗 1688 抓来的规格值，让拼多多能接受

问题：
  1688 厂家的规格命名很长很具体，如「橡胶漆-大红+手提小口瓶」
  拼多多类目的规格输入框（如「颜色」）不接受这种值 → 找不到输入框

清洗规则：
  ① 去掉前缀（橡胶漆-、喷漆+ 等材质/工艺前缀）
  ② 去掉后缀（小口瓶、大口瓶、手提等形态描述）
  ③ 截断超长值（>10 字）
  ④ SKU 数限制（颜色 × 规格 ≤ 30，超出则取前 N 个）

用法：python dev/clean_specs.py [目录]
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else r'E:\360MoveData\Users\Administrator\Desktop\童装\artifacts\real20')

# 要去掉的后缀（形态/包装描述）
SUFFIX_NOISE = [
    '小口瓶', '大口瓶', '广口瓶', '手提', '杯', '瓶', '壶', '桶', '盒', '袋', '套装',
    '便携', '户外', '车载', '运动', '健身', '旅行', '款',
]
# 要去掉的前缀（材质/工艺）
PREFIX_NOISE = [
    '橡胶漆-', '橡胶漆+', '喷漆-', '喷漆+', '不锈钢-', '不锈钢+',
    '塑料-', '塑料+', '玻璃-', '玻璃+', '陶瓷-', '陶瓷+',
    '硅胶-', '硅胶+', 'abs-', 'abs+', 'pp-', 'pp+', 'pc-', 'pc+',
    '电镀-', '电镀+', '拉丝-', '拉丝+', '磨砂-', '磨砂+',
]

# 常用颜色映射（把厂家描述映射到标准色）
COLOR_MAP = {
    '大红': '红色', '正红': '红色', '酒红': '红色', '枣红': '红色', '粉红': '粉色',
    '宝蓝': '蓝色', '藏蓝': '蓝色', '深蓝': '蓝色', '天蓝': '蓝色', '湖蓝': '蓝色',
    '柠黄': '黄色', '柠檬黄': '黄色', '姜黄': '黄色', '橘黄': '橙色',
    '活力橙': '橙色', '橘橙': '橙色', '珊瑚橙': '橙色',
    '墨绿': '绿色', '草绿': '绿色', '翠绿': '绿色', '森林绿': '绿色',
    '紫罗兰': '紫色', '深紫': '紫色', '浅紫': '紫色',
    '哑黑': '黑色', '亮黑': '黑色', '炭黑': '黑色',
    '珍珠白': '白色', '乳白': '白色', '米白': '白色',
    '香槟': '金色', '香槟金': '金色', '土豪金': '金色',
    '玫瑰金': '粉色', '樱花粉': '粉色', ' Candy粉': '粉色',
    '青': '青色', '青色': '青色', '湖青': '青色',
    '咖': '咖啡色', '咖啡': '咖啡色', '棕色': '咖啡色', '褐色': '咖啡色',
    '灰': '灰色', '银灰': '灰色', '深灰': '灰色', '浅灰': '灰色',
    '本色': '银色', '不锈钢本色': '银色',
    '透明': '透明色', '渐变': '渐变色', '冰晶': '渐变色',
}


def clean_value(v, is_color=False):
    """清洗单个规格值"""
    if not v:
        return v
    s = str(v).strip()

    # ① 去前缀
    low = s.lower()
    for p in PREFIX_NOISE:
        if low.startswith(p.lower()):
            s = s[len(p):]
            break

    # ② 去后缀
    for suf in SUFFIX_NOISE:
        if s.endswith(suf) and len(s) > len(suf):
            s = s[:-len(suf)]
            break

    # ③ 颜色映射（只对颜色维度）
    if is_color and s in COLOR_MAP:
        s = COLOR_MAP[s]
    else:
        # 包含映射词也换（如「橡胶漆-大红」清前缀后变「大红」）
        for k, v2 in COLOR_MAP.items():
            if k in s:
                s = v2
                break

    # ④ 去掉「【...」营销/说明文字（右括号可能缺失）
    s = re.sub(r'[【\[][^】\]]*[】\]]?', '', s)
    s = re.sub(r'[（(][^）)]{0,12}[）)]?\s*$', '', s)     # 末尾的括号说明

    # ⑤ 去掉残留的连接符
    s = s.strip('+-_/ ，,、').strip()

    # ⑥ 截断超长
    if len(s) > 10:
        s = s[:10]

    return s or '默认'


def clean_product(pj):
    p = json.loads(pj.read_text(encoding='utf-8'))
    specs = p.get('specs') or []
    if not specs:
        return 0

    total_before = sum(len(s.get('values') or []) for s in specs)

    # 逐维度清洗
    for i, s in enumerate(specs):
        is_color = bool(re.search(r'颜色|色彩|色', s.get('name', '')))
        seen = set()
        new_vals = []
        for v in (s.get('values') or []):
            vv = clean_value(v.get('value', '') if isinstance(v, dict) else v, is_color)
            if vv and vv not in seen:
                seen.add(vv)
                new_vals.append({'value': vv})
        s['values'] = new_vals

    # SKU 数限制：颜色 × 规格 ≤ 30
    # ★ 2026-11-03 修正：优先保【第二维】完整，截断第一维
    #   实测保温杯：20 色 × 4 规格，按 30//20=1 截第二维 → 规格只剩 1 个，SKU 变单规格
    #   正确做法：第二维保留全部，第一维按预算截断
    dim_sizes = [len(s.get('values') or []) for s in specs]
    if len(specs) >= 2 and dim_sizes[0] * dim_sizes[1] > 30:
        budget0 = max(1, 30 // max(1, dim_sizes[1]))
        if budget0 < dim_sizes[0]:
            specs[0]['values'] = specs[0]['values'][:budget0]
            print(f'    第一维从 {dim_sizes[0]} 截断到 {budget0}（保留第二维 {dim_sizes[1]} 个）')

    # 单个维度也限制（最多 20 个，避免输入框爆炸）
    for s in specs:
        if len(s.get('values') or []) > 20:
            s['values'] = s['values'][:20]
            print(f'    单维从 {len(s.get("values") or [])} 截断到 20')

    # 重建 SKU 行
    skus = p.get('skus') or []
    if skus and len(specs) >= 1:
        # 用清洗后的维度值重新生成 SKU（笛卡尔积，限量）
        import itertools
        val_lists = [[v['value'] for v in s.get('values') or []] for s in specs]
        combos = list(itertools.product(*val_lists))[:30]
        old_price = ''
        for sk in skus:
            if sk.get('price'):
                old_price = sk['price']
                break
        new_skus = []
        for combo in combos:
            spec = {}
            for i, s in enumerate(specs):
                spec[s['name']] = combo[i]
            new_skus.append({'specs': spec, 'price': old_price, 'stock': '100'})
        p['skus'] = new_skus

    total_after = sum(len(s.get('values') or []) for s in specs)
    pj.write_text(json.dumps(p, ensure_ascii=False, indent=2), encoding='utf-8')
    return total_before, total_after


def main():
    if not ROOT.exists():
        print(f'目录不存在: {ROOT}')
        return 1
    fixed = 0
    for d in sorted(ROOT.iterdir()):
        if not d.is_dir():
            continue
        pj = d / 'product.json'
        if not pj.exists():
            continue
        try:
            r = clean_product(pj)
            if r == 0:
                continue
            before, after = r
            print(f'  {d.name}: 规格值 {before} → {after}，SKU {len(json.loads(pj.read_text(encoding="utf-8")).get("skus") or [])} 行')
            fixed += 1
        except Exception as e:
            print(f'  ❌ {d.name}: {str(e)[:100]}')
    print(f'\n清洗完成：{fixed} 个商品')
    return 0


if __name__ == '__main__':
    sys.exit(main())

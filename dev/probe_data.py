import sys, json
sys.path.insert(0, 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/alibaba-product-find/scripts')
from _1688_gateway import search_products

res = search_products(query='保温杯', page_size=3, score_level='high')
offer = res['payload']['data']['data']['OFFER']
it = offer['items'][0]
d = it.get('data') or {}
print('=== data 字段 ===')
print(list(d.keys()))
print()
for k, v in d.items():
    if isinstance(v, (str, int, float, bool)) and v not in ('', None):
        print(f'  {k} = {str(v)[:70]}')
    elif isinstance(v, dict):
        print(f'  {k} = <dict {list(v.keys())[:8]}>')

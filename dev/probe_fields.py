import sys, json
sys.path.insert(0, 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/alibaba-product-find/scripts')
from _1688_gateway import search_products

res = search_products(query='保温杯', page_size=3, score_level='high')
offer = res['payload']['data']['data']['OFFER']
items = offer['items']
print('items 数:', len(items))
print('\n=== 第 1 个 item 的字段 ===')
it = items[0]
print(list(it.keys()))
print('\n=== 关键字段值 ===')
for k, v in it.items():
    if isinstance(v, (str, int, float, bool)) and v not in ('', None):
        print(f'  {k} = {str(v)[:70]}')

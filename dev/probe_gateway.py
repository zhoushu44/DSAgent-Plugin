import sys, json
sys.path.insert(0, 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/alibaba-product-find/scripts')
from _1688_gateway import search_products

res = search_products(query='保温杯', page_size=5, score_level='high')
print(json.dumps(res, ensure_ascii=False)[:3000])

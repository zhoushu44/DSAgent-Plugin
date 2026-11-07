import json,sys
sys.path.insert(0,r"E:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\skills\alibaba-product-find\scripts")
from _1688_gateway import search_products
r=search_products(query="一次性咖啡纸杯 16oz 双层", page_size=10)
open(r"E:\360MoveData\Users\Administrator\Desktop\童装\_1688_test.json","w",encoding="utf-8").write(json.dumps(r,ensure_ascii=False,indent=1))
print("OK", str(r)[:800])

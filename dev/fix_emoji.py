# -*- coding: utf-8 -*-
"""去掉 context_to_product.py 里的 emoji（Windows GBK 无法编码）"""
from pathlib import Path
import re

f = Path(r'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\dev\context_to_product.py')
s = f.read_text(encoding='utf-8')

# 替换 emoji 为 ASCII
s = s.replace('\u2705', '[OK]')
s = s.replace('\u274c', '[ERR]')
s = s.replace('\u26a0', '[WARN]')

f.write_text(s, encoding='utf-8')
print('OK: emoji 已替换为 ASCII')

# -*- coding: utf-8 -*-
"""修正 SKILL.md 章节编号重复"""
from pathlib import Path

f = Path(r'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\skills\pdd-publish-http\SKILL.md')
s = f.read_text(encoding='utf-8')

# 从后往前改，避免编号冲突
fixes = [
    ('## 十二、组件化铁律', '## 十四、组件化铁律'),
    ('## 十三、性能基线（2026-11-03 最终）', '## 十三、性能基线（2026-11-03 最终）'),  # 已是十三
    ('## 十二、本轮实战修复清单（2026-11-02 ~ 11-03）', '## 十二、本轮实战修复清单（2026-11-02 ~ 11-03）'),  # 已是十二
    ('## 十一、200 批量实测（2026-11-03 完成）', '## 十一、200 批量实测（2026-11-03 完成）'),  # 已是十一
    # 原「十一、组件清单」改成「十点五」
    ('## 十一、组件清单', '## 十点五、组件清单'),
]

for old, new in fixes:
    if old == new:
        continue
    n = s.count(old)
    if n:
        s = s.replace(old, new)
        print(f'OK: {old} -> {new}（{n} 处）')

f.write_text(s, encoding='utf-8')
print('done')

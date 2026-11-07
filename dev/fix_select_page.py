# -*- coding: utf-8 -*-
"""
修 selectCategory 的核心 bug：检测的是当前 page，不是新开的类目页

现象：
  段1 打开商品列表
  段2 选类目: 水杯
    无类目搜索框（可能已在表单页）   ← 5 秒就跳过
  然后 Protocol error: Connection closed（20 个全失败）

根因：
  openPublishEntry 点「发布新商品」后会【新开标签页】到类目页。
  但 selectCategory 检测的是【当前 page】——它还是商品列表页，
  当然找不到「搜索分类」输入框 → 直接 return page → 后续操作全在错的页面上跑。

修复：
  selectCategory 第一件事：如果 browser 里有匹配 goods/category 或 goods_add 的标签页，
  优先切到那个页面再检测。
"""
from pathlib import Path

f = Path(r'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\skills\pdd-publish-http\scripts\stage-nav.mjs')
s = f.read_text(encoding='utf-8')

# 找 selectCategory 函数开头
OLD = '''export async function selectCategory(page, kw, opts = {}) {
  const log = opts.log || (() => {})
  const catId = opts.catId || \'\''''

NEW = '''export async function selectCategory(page, kw, opts = {}) {
  const log = opts.log || (() => {})
  const catId = opts.catId || \'\'

  // ★ 2026-11-03 关键修复：先切到真正的类目页/表单页
  //   openPublishEntry 点「发布新商品」是【新开标签页】，
  //   传进来的 page 往往还是商品列表 → 检测不到搜索框 → 整个流程跑偏。
  //   所以第一步：在 browser 所有标签页里找发布页，找到了就切过去。
  try {
    const browser = page.browser()
    const pages = await browser.pages()
    const target = pages.find(p => /goods\\/(category|goods_add)/.test(String(p.url() || \'\')))
    if (target && target !== page) {
      log(`  切换到发布页：${String(target.url()).slice(0, 70)}`)
      await target.bringToFront()
      await new Promise(r => setTimeout(r, 1200))
      page = target
    }
  } catch { /* 忽略，继续用原 page */ }'''

if OLD in s:
    s = s.replace(OLD, NEW, 1)
    print('OK: selectCategory 开头加切页逻辑')
else:
    print('NOT FOUND')
    i = s.find('export async function selectCategory')
    print(repr(s[i:i+250]) if i > 0 else 'function not found')

f.write_text(s, encoding='utf-8')

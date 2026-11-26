/**
 * step12x-excel.mjs — 价格/库存/规格编码：走页面官方「Excel批量编辑规格」
 *
 * 为什么要走这条路（2026-11-26 实测）：
 *   价格库存表一次只在页面里画 ~18 行，任何滚动/聚焦都会让它重渲染收缩回去，
 *   所以按「页面上第几行」逐格填 30 行的款必然丢值（实测 11/30 行回读不一致）。
 *   而页面自带「Excel批量编辑规格」= 导出全部行 → 本地改 → 导入，完全不受渲染行数影响。
 *
 * 导出文件结构（实测，类目 15021）：
 *   第1~4行 说明，第5行表头：颜色分类 | 参考分类 | 库存 | 拼单价(元) | 单买价(元) | 规格编码 | 启用状态
 *   第6行起 = SKU 行，规格列只供对照不可改
 *
 * 对外只导出 fillSkuByExcel(page, { skus, log })
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'

const sleep = ms => new Promise(r => setTimeout(r, ms))

const PY_CANDIDATES = [
  process.env.DSH_PYTHON,
  path.join(os.homedir(), '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python', 'python.exe'),
  'python',
].filter(Boolean)

const PY_EDIT = String.raw`
import json, sys, openpyxl
src, dst, plan_path = sys.argv[1], sys.argv[2], sys.argv[3]
plan = json.load(open(plan_path, encoding='utf-8'))     # {header:[...], rows:[{key:[...], set:{列名:值}}]}
wb = openpyxl.load_workbook(src)
ws = wb.worksheets[0]
# 找表头行：第一列文字为「颜色」或含「分类」，且该行有任何列名含「库存」
head_row = None
for r in range(1, min(ws.max_row, 20) + 1):
    vals = [str(ws.cell(r, c).value or '').strip() for c in range(1, ws.max_column + 1)]
    ne = [v for v in vals if v]
    # 表头行特征：有「库存」列，且非空单元格 ≥3、每个都不长（排除第2行那种整段说明文字）
    if any('库存' in v for v in ne) and any('分类' in v or '规格' in v for v in ne) and len(ne) >= 3 and all(len(v) <= 12 for v in ne):
        head_row = r
        break
if not head_row:
    print(json.dumps({'ok': False, 'error': '导出文件里找不到表头行'}, ensure_ascii=False)); sys.exit(0)
heads = [str(ws.cell(head_row, c).value or '').strip() for c in range(1, ws.max_column + 1)]
spec_cols = []
stock_col = next((i for i, h in enumerate(heads) if '库存' in h), None)
if stock_col is None:
    print(json.dumps({'ok': False, 'error': '表头里没有「库存」列', 'heads': heads}, ensure_ascii=False)); sys.exit(0)
spec_cols = list(range(stock_col))                       # 库存前面都是规格列
def key_of(r):
    return tuple(str(ws.cell(r, c + 1).value or '').strip() for c in spec_cols)
# 列名 → 列号（模糊：去括号、去空格）
def find_col(*kws):
    for i, h in enumerate(heads):
        hh = h.replace('（', '(').replace('）', ')').replace(' ', '')
        if all(k in hh for k in kws):
            return i
    return None
col_stock = stock_col
col_multi = find_col('拼单价')
col_price = find_col('单买价')
col_code = find_col('规格编码') if find_col('规格编码') is not None else find_col('编码')
col_enable = find_col('启用')
# 现有行索引
index = {}
for r in range(head_row + 1, ws.max_row + 1):
    k = key_of(r)
    if any(k):
        index[k] = r
filled, missing = 0, []
for item in plan['rows']:
    k = tuple(item['key'])
    r = index.get(k)
    if not r:
        missing.append(list(k)); continue
    for name, val in item['set'].items():
        c = {'库存': col_stock, '拼单价': col_multi, '单买价': col_price, '规格编码': col_code, '启用状态': col_enable}.get(name)
        if c is None:
            continue
        if val is None or val == '':
            continue
        ws.cell(r, c + 1).value = str(val)
    filled += 1
wb.save(dst)
print(json.dumps({'ok': True, 'headerRow': head_row, 'heads': heads, 'filled': filled, 'missing': missing,
                  'cols': {'库存': col_stock, '拼单价': col_multi, '单买价': col_price, '规格编码': col_code}}, ensure_ascii=False))
`

function runPython(script, args) {
  const tmp = path.join(os.tmpdir(), `pdd-sku-excel-${Date.now()}.py`)
  fs.writeFileSync(tmp, script, 'utf8')
  let last = null
  for (const py of PY_CANDIDATES) {
    const r = spawnSync(py, [tmp, ...args], { encoding: 'utf8', maxBuffer: 8 << 20 })
    if (r.error) { last = String(r.error.message); continue }
    const out = (r.stdout || '').trim().split('\n').filter(Boolean).pop() || ''
    try { return { ...JSON.parse(out), stderr: (r.stderr || '').slice(0, 200) } } catch { last = (r.stdout || r.stderr || '').slice(0, 200) }
  }
  return { ok: false, error: '调用 Python/openpyxl 失败: ' + last }
}

/** 打开「Excel批量编辑规格」弹窗 */
async function openDialog(page) {
  await page.evaluate(() => {
    const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim()
    const btn = [...document.querySelectorAll('button, [role="button"], a, span, div')]
      .filter(e => norm(e.innerText) === 'Excel批量编辑规格' && e.getBoundingClientRect().width > 0)
    btn[0]?.click()
  }).catch(() => { })
  await sleep(2000)
  return page.evaluate(() => {
    const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim()
    return [...document.querySelectorAll('button')].some(b => /导出当前规格数据/.test(norm(b.innerText)))
  }).catch(() => false)
}

async function closeDialog(page) {
  await page.keyboard.press('Escape').catch(() => { })
  await sleep(800)
  // 有些弹窗 Escape 关不掉，再点右上角关闭
  await page.evaluate(() => {
    const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim()
    const dlg = [...document.querySelectorAll('[class*="modal"], [role="dialog"]')].find(d => d.getBoundingClientRect().width > 300 && /Excel批量编辑/.test(norm(d.innerText)))
    const x = dlg?.querySelector('[class*="close"], [aria-label*="关闭"]')
    if (x) x.click()
  }).catch(() => { })
  await sleep(500)
}

/** 点导出，等文件落盘 */
async function exportFile(page, dir) {
  fs.mkdirSync(dir, { recursive: true })
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true, recursive: true })
  const cdp = await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir.replace(/\//g, '\\') }).catch(() => { })
  const clicked = await page.evaluate(() => {
    const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim()
    const b = [...document.querySelectorAll('button')].find(x => /导出当前规格数据/.test(norm(x.innerText)))
    if (!b) return false
    b.click()
    return true
  }).catch(() => false)
  if (!clicked) return { ok: false, error: '找不到「导出当前规格数据」按钮' }
  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    const f = fs.readdirSync(dir).find(x => /\.(xlsx|xls)$/i.test(x) && !x.endsWith('.crdownload'))
    if (f && fs.statSync(path.join(dir, f)).size > 1000) return { ok: true, file: path.join(dir, f) }
  }
  return { ok: false, error: '导出文件 30 秒内没出现' }
}

/** 点「导入规格数据」并把文件塞进弹窗里的 file input，然后必须点「确认编辑」才真正写入 */
async function importFile(page, file, log = () => { }) {
  const el = await page.evaluateHandle(() => {
    const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim()
    const dlg = [...document.querySelectorAll('[class*="modal"], [role="dialog"]')]
      .find(d => d.getBoundingClientRect().width > 300 && /导入规格数据|确认编辑项/.test(norm(d.innerText)))
    const box = dlg || document
    return box.querySelector('input[type="file"]') || null
  }).then(h => h.asElement()).catch(() => null)
  if (!el) return { ok: false, error: '弹窗里没有文件输入口' }
  await el.uploadFile(file).catch(() => { })

  // ★ 2026-11-26 实测：选完文件后页面弹出「确认编辑项」，必须再点「确认编辑」才写进去；
  //   不点这一步什么都不会发生（页面上也不会报错），之前两次导入就是卡在这里。
  const clickConfirm = () => page.evaluate(() => {
    const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim()
    const b = [...document.querySelectorAll('button')]
      .find(x => norm(x.innerText) === '确认编辑' && x.getBoundingClientRect().width > 0)
    if (!b) return false
    b.click()
    return true
  }).catch(() => false)

  let confirmed = false
  for (let i = 0; i < 25; i++) {
    await sleep(1000)
    const st = await page.evaluate(() => {
      const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim()
      const dlg = [...document.querySelectorAll('[class*="modal"], [role="dialog"]')]
        .find(d => d.getBoundingClientRect().width > 300 && /确认编辑项/.test(norm(d.innerText)))
      const btn = [...document.querySelectorAll('button')].some(b => norm(b.innerText) === '确认编辑')
      return { 有待确认: !!dlg && btn, 说明: dlg ? norm(dlg.innerText).slice(0, 60) : '' }
    }).catch(() => ({}))
    if (st.有待确认) { confirmed = await clickConfirm(); break }
    if (i > 5 && !st.有待确认) break
  }
  if (!confirmed) return { ok: false, error: '没等到「确认编辑项」弹窗（文件可能没被接受）' }
  log(`   已点「确认编辑」`)

  for (let i = 0; i < 25; i++) {
    await sleep(1000)
    const st = await page.evaluate(() => {
      const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim()
      const t = norm(document.body.innerText)
      return {
        成功: /导入成功|已回填到规格表格/.test(t), 失败: /导入失败|格式错误|解析失败/.test(t),
        待确认还在: [...document.querySelectorAll('button')].some(b => norm(b.innerText) === '确认编辑'),
      }
    }).catch(() => ({}))
    if (st.失败) return { ok: false, error: '页面提示导入失败' }
    if (st.成功 || (!st.待确认还在 && i > 3)) return { ok: true }
  }
  return { ok: false, error: '点确认后 25 秒没有成功提示' }
}

/**
 * 用「Excel批量编辑规格」填价格/库存/规格编码
 * @param {object} page
 * @param {object} opts
 * @param {Array} opts.skus  商品数据的 skus：[{ specs:{颜色分类:'银河蓝',参考分类:'110'}, stock, multiPrice, price, itemNo }]
 * @param {string[]} [opts.dimOrder] 规格维度名顺序（默认取第一个 sku 的 specs 键顺序）
 * @returns {Promise<{ok:boolean, filled?:number, missing?:any[], error?:string, verify?:any}>}
 */
export async function fillSkuByExcel(page, opts = {}) {
  const log = opts.log || (() => { })
  const skus = Array.isArray(opts.skus) ? opts.skus : []
  if (!skus.length) return { ok: false, error: 'skus 为空' }
  const dimOrder = opts.dimOrder || Object.keys(skus[0].specs || {})

  const dir = opts.dir || path.join(os.tmpdir(), 'pdd-sku-excel')
  const exported = path.join(dir, 'export.xlsx')
  const filledFile = path.join(dir, 'filled.xlsx')

  if (!await openDialog(page)) return { ok: false, error: '打不开「Excel批量编辑规格」弹窗' }
  const ex = await exportFile(page, dir)
  if (!ex.ok) { await closeDialog(page); return { ok: false, error: ex.error } }
  log(`   已导出规格文件：${path.basename(ex.file)}（${Math.round(fs.statSync(ex.file).size / 1024)} KB）`)

  // 组装修改计划：按规格值匹配
  const plan = {
    rows: skus.map(s => ({
      key: dimOrder.map(d => String(s.specs?.[d] ?? '')),
      set: {
        库存: s.stock ?? s.quantity,
        拼单价: s.multiPrice,
        单买价: s.price,
        规格编码: s.itemNo || s.skuSn,
      },
    })),
  }
  const planPath = path.join(dir, 'plan.json')
  fs.writeFileSync(planPath, JSON.stringify(plan), 'utf8')
  const edit = runPython(PY_EDIT, [ex.file, filledFile, planPath])
  if (!edit.ok) { await closeDialog(page); return { ok: false, error: edit.error || '改表格失败', raw: edit } }
  log(`   表格已改：匹配 ${edit.filled} 行${edit.missing?.length ? `，未匹配 ${edit.missing.length} 行 ${JSON.stringify(edit.missing.slice(0, 3))}` : ''}`)
  if (edit.missing?.length) { await closeDialog(page); return { ok: false, error: `导出文件里找不到这 ${edit.missing.length} 行的规格`, missing: edit.missing } }

  const im = await importFile(page, filledFile, log)
  if (!im.ok) { await closeDialog(page); return { ok: false, error: im.error } }
  log('   已导入修改后的规格文件')
  await closeDialog(page)
  await sleep(1500)

  // 回读校验：再导出一次，逐行比对
  let verify = { checked: 0, mismatch: [] }
  if (await openDialog(page)) {
    const ex2 = await exportFile(page, path.join(dir, 'verify'))
    if (ex2.ok) {
      const cmp = runPython(String.raw`
import json, sys, openpyxl
src, plan_path = sys.argv[1], sys.argv[2]
plan = json.load(open(plan_path, encoding='utf-8'))
wb = openpyxl.load_workbook(src); ws = wb.worksheets[0]
head_row = None
for r in range(1, min(ws.max_row, 20) + 1):
    vals = [str(ws.cell(r, c).value or '').strip() for c in range(1, ws.max_column + 1)]
    ne = [v for v in vals if v]
    if any('库存' in v for v in ne) and any('分类' in v or '规格' in v for v in ne) and len(ne) >= 3 and all(len(v) <= 12 for v in ne):
        head_row = r; break
heads = [str(ws.cell(head_row, c).value or '').strip() for c in range(1, ws.max_column + 1)]
stock_col = next(i for i, h in enumerate(heads) if '库存' in h)
def find_col(*kws):
    for i, h in enumerate(heads):
        hh = h.replace('（','(').replace('）',')').replace(' ','')
        if all(k in hh for k in kws): return i
col = {'库存': stock_col, '拼单价': find_col('拼单价'), '单买价': find_col('单买价'), '规格编码': find_col('规格编码')}
spec_cols = list(range(stock_col))
index = {}
for r in range(head_row + 1, ws.max_row + 1):
    k = tuple(str(ws.cell(r, c + 1).value or '').strip() for c in spec_cols)
    if any(k): index[k] = r
bad = []
for item in plan['rows']:
    r = index.get(tuple(item['key']))
    if not r: bad.append({'key': item['key'], 'why': '导出的文件里没有这一行'}); continue
    for name, val in item['set'].items():
        if val is None or val == '' or col.get(name) is None: continue
        got = str(ws.cell(r, col[name] + 1).value or '').strip()
        if got != str(val).strip():
            bad.append({'key': item['key'], '列': name, '期望': str(val), '实际': got})
print(json.dumps({'ok': True, 'checked': len(plan['rows']), 'bad': bad}, ensure_ascii=False))
`, [ex2.file, planPath])
      verify = { checked: cmp.checked || 0, mismatch: cmp.bad || [], error: cmp.error }
      await closeDialog(page)
    }
  }

  if (verify.mismatch?.length) return { ok: false, error: `回读不一致 ${verify.mismatch.length} 处`, verify, filled: edit.filled }
  return { ok: true, filled: edit.filled, verify }
}

export default fillSkuByExcel

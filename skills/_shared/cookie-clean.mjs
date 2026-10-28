/**
 * PDD Cookie 域污染清理
 *
 * ── 问题 ──────────────────────────────────────────────────────────────
 * 拼多多 Cookie 会同时存在于三个域：
 *   .pinduoduo.com          ← 父域（正常登录写入，secure=1，最新）
 *   mms.pinduoduo.com       ← 子域（旧值残留）
 *   yingxiao.pinduoduo.com  ← 子域（旧值残留）
 *
 * 浏览器对**同名 Cookie 优先发更具体的域**，于是推广域（yingxiao）拿到的是
 * 子域里的旧 SUB_PASS_ID，而不是父域的新值。
 *
 * 表现：推广域反复掉登录、mms 主域却正常；重新扫码也治不好
 *      （新 Cookie 进父域，被子域旧值继续挡住）。
 *
 * ── 解法 ──────────────────────────────────────────────────────────────
 * 删掉子域上与父域重名的项，让浏览器回落到父域新值。幂等，可每次运行前调用。
 *
 * ── 依赖 ──────────────────────────────────────────────────────────────
 * 只用系统 Python 的 sqlite3 标准库（Node 侧无 sqlite 驱动）。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'

const PARENT_DOMAIN = '.pinduoduo.com'
const CHILD_DOMAINS = ['mms.pinduoduo.com', 'yingxiao.pinduoduo.com']

const PY_SCRIPT = `
import sqlite3, os, sys, shutil, tempfile, json

cookie_file = sys.argv[1]
dry = sys.argv[2] == '1'
parent = '.pinduoduo.com'
children = ['mms.pinduoduo.com', 'yingxiao.pinduoduo.com']

if not os.path.exists(cookie_file):
    print(json.dumps({'ok': True, 'deleted': 0, 'kept': 0, 'skipped': 'no-file'}))
    sys.exit(0)

tmp = os.path.join(tempfile.gettempdir(), 'pdd-ck-%d.db' % os.getpid())
try:
    shutil.copy2(cookie_file, tmp)
except Exception as e:
    print(json.dumps({'ok': False, 'deleted': 0, 'kept': 0, 'skipped': 'copy-fail: %s' % e}))
    sys.exit(0)

try:
    con = sqlite3.connect(tmp)
    cur = con.cursor()

    cur.execute("SELECT DISTINCT name FROM cookies WHERE host_key = ?", (parent,))
    parent_names = set(r[0] for r in cur.fetchall())

    ph = ','.join('?' * len(children))
    cur.execute("SELECT host_key, name FROM cookies WHERE host_key IN (%s)" % ph, children)
    all_children = cur.fetchall()
    dup = [(h, n) for h, n in all_children if n in parent_names]
    keep = [(h, n) for h, n in all_children if n not in parent_names]

    if dry:
        print(json.dumps({'ok': True, 'deleted': 0, 'kept': len(keep), 'skipped': 'dry-run',
                          'detail': ['%s %s' % (h, n) for h, n in dup]}, ensure_ascii=False))
        con.close(); os.remove(tmp); sys.exit(0)

    deleted = 0
    for h, n in dup:
        cur.execute("DELETE FROM cookies WHERE host_key = ? AND name = ?", (h, n))
        deleted += cur.rowcount
    con.commit(); con.close()

    shutil.copy2(tmp, cookie_file)
    os.remove(tmp)
    print(json.dumps({'ok': True, 'deleted': deleted, 'kept': len(keep)}, ensure_ascii=False))
except Exception as e:
    try: os.remove(tmp)
    except: pass
    print(json.dumps({'ok': False, 'deleted': 0, 'kept': 0, 'skipped': str(e)}, ensure_ascii=False))
`

function findPython() {
  for (const cmd of ['python', 'python3', 'py']) {
    try {
      execFileSync(cmd, ['-c', 'import sqlite3'], { stdio: 'ignore', timeout: 5000 })
      return cmd
    } catch { /* next */ }
  }
  return null
}

/**
 * 同步版：清理 Cookie 域污染
 * @param {string} profileDir Chrome profile 目录
 * @param {{dryRun?: boolean}} [opts]
 * @returns {number} 删除条数（出错返回 0）
 */
export function cleanCookiePollutionSync(profileDir, opts = {}) {
  const cookieFile = path.join(profileDir, 'Default', 'Network', 'Cookies')
  if (!fs.existsSync(cookieFile)) return 0
  const py = findPython()
  if (!py) return 0
  try {
    const out = execFileSync(py, ['-c', PY_SCRIPT, cookieFile, opts.dryRun ? '1' : '0'], {
      encoding: 'utf8', timeout: 30000, windowsHide: true,
    })
    const r = JSON.parse(out.trim().split('\n').pop())
    return r.ok ? (r.deleted || 0) : 0
  } catch {
    return 0
  }
}

/** 异步版（供 await 场景） */
export async function cleanCookiePollution(profileDir, opts = {}) {
  const { dryRun = false, log = () => {} } = opts
  const cookieFile = path.join(profileDir, 'Default', 'Network', 'Cookies')

  if (!fs.existsSync(cookieFile)) {
    return { ok: true, deleted: 0, kept: 0, skipped: 'Cookies 文件不存在' }
  }
  const py = findPython()
  if (!py) {
    return { ok: false, deleted: 0, kept: 0, skipped: '未找到 Python（需要 python3 带 sqlite3）' }
  }
  try {
    const out = execFileSync(py, ['-c', PY_SCRIPT, cookieFile, dryRun ? '1' : '0'], {
      encoding: 'utf8', timeout: 30000, windowsHide: true,
    })
    const r = JSON.parse(out.trim().split('\n').pop())
    if (r.deleted > 0) log(`已清理 ${r.deleted} 条域污染 Cookie`)
    return r
  } catch (e) {
    return { ok: false, deleted: 0, kept: 0, skipped: String(e.message).slice(0, 120) }
  }
}

/** 检测是否有污染（不修改） */
export async function detectCookiePollution(profileDir) {
  const r = await cleanCookiePollution(profileDir, { dryRun: true })
  return { polluted: (r.detail?.length ?? 0) > 0, count: r.detail?.length ?? 0, detail: r.detail ?? [] }
}

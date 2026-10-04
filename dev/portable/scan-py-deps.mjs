/**
 * 扫描 skills/ 下所有 .py，提取第三方 import，映射为 pip 包名。
 * 用途：生成绿色包的 Python 依赖清单（dev/portable/py-requirements.txt）。
 *
 * 用法：node dev/portable/scan-py-deps.mjs
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const skillsDir = join(root, 'skills')

/** Python 3 标准库 + 技能内部模块，都不需要 pip 安装。 */
const STDLIB = new Set([
  '__future__','abc','argparse','array','ast','asyncio','atexit','base64','binascii','bisect','builtins','bz2',
  'calendar','codecs','collections','concurrent','configparser','contextlib','copy','csv','ctypes','dataclasses',
  'datetime','decimal','difflib','dis','email','enum','errno','fcntl','fnmatch','fractions','ftplib','functools',
  'gc','getpass','gettext','glob','gzip','hashlib','heapq','hmac','html','http','imaplib','importlib','inspect',
  'io','ipaddress','itertools','json','keyword','linecache','locale','logging','lzma','mailbox','math','mimetypes',
  'mmap','multiprocessing','netrc','numbers','operator','os','pathlib','pickle','pkgutil','platform','plistlib',
  'poplib','pprint','pty','queue','quopri','random','re','readline','secrets','select','selectors','shelve','shlex',
  'shutil','signal','site','smtplib','socket','socketserver','sqlite3','ssl','stat','statistics','string','struct',
  'subprocess','sys','sysconfig','tarfile','tempfile','textwrap','threading','time','timeit','token','tokenize',
  'traceback','tracemalloc','types','typing','unicodedata','unittest','urllib','uuid','venv','warnings','wave',
  'weakref','webbrowser','winreg','winsound','wsgiref','xml','xmlrpc','zipapp','zipfile','zlib','zoneinfo','_thread',
])

/** 技能内部模块（同目录 / .dsagent runtime），不算第三方。 */
const INTERNAL = /^(skill_bootstrap|dsagent_runtime|runtime|runtime_http|platform_client|http_retry|output|_api_client|_dsagent_gate|helpers|utils?|paths?|adapters|office|browser_check|xhs_sign|xlsx_reader|minutes_list_parse|attendance_report_common|extract_form_field_info|cache_\w+|apis?)$/

/** import 名 → PyPI 包名（不一致的少数几个）。 */
const PACKAGE_ALIAS = {
  PIL: 'Pillow',
  cv2: 'opencv-python',
  yaml: 'PyYAML',
  bs4: 'beautifulsoup4',
  docx: 'python-docx',
  pptx: 'python-pptx',
  fitz: 'PyMuPDF',
  OpenSSL: 'pyOpenSSL',
  dateutil: 'python-dateutil',
  dotenv: 'python-dotenv',
  serial: 'pyserial',
  jwt: 'PyJWT',
  Crypto: 'pycryptodome',
  skimage: 'scikit-image',
  sklearn: 'scikit-learn',
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__pycache__') continue
      walk(p, out)
    } else if (e.name.endsWith('.py')) {
      out.push(p)
    }
  }
  return out
}

const files = walk(skillsDir)
console.log('扫描 .py 文件:', files.length)

const found = new Map() // pkg -> count
for (const f of files) {
  let src
  try { src = readFileSync(f, 'utf8') } catch { continue }
  for (const m of src.matchAll(/^[ \t]*(?:from[ \t]+([A-Za-z_][\w.]*)|import[ \t]+([A-Za-z_][\w.]*(?:[ \t]*,[ \t]*[A-Za-z_][\w.]*)*))/gm)) {
    const mods = m[1] ? [m[1]] : m[2].split(',').map((s) => s.trim())
    for (const raw of mods) {
      const top = raw.split('.')[0]
      if (!top || STDLIB.has(top) || INTERNAL.test(top)) continue
      const pkg = PACKAGE_ALIAS[top] ?? top
      found.set(pkg, (found.get(pkg) ?? 0) + 1)
    }
  }
}

const sorted = [...found.entries()].sort((a, b) => b[1] - a[1])
console.log('静态扫描出的第三方依赖（出现次数）:')
for (const [pkg, n] of sorted) console.log(`  ${String(n).padStart(4)}  ${pkg}`)

/**
 * 权威清单：抽自 src/services/skill-service.ts 的 SKILL_DEPS。
 * 插件用它给每个候选解释器打分并挑选（命中越多越优先），
 * 因此包内 Python 必须尽量把这一组全部装齐，才能被自动选中。
 * 静态扫描可能漏掉「运行时才 import」或「被 try 包裹」的模块，故以此表为准做并集。
 */
const SKILL_DEPS = [
  'httpx', 'requests', 'bs4', 'jieba', 'lxml', 'markdown', 'numpy', 'openpyxl',
  'pandas', 'PIL', 'docx', 'pptx', 'yaml', 'matplotlib',
  'pdfplumber', 'pypdf', 'pdf2image', 'defusedxml', 'pywencai', 'akshare',
]
const DEPS_ALIAS = { PIL: 'Pillow', yaml: 'PyYAML', bs4: 'beautifulsoup4', docx: 'python-docx', pptx: 'python-pptx' }

const all = new Set(sorted.map(([p]) => p))
for (const d of SKILL_DEPS) all.add(DEPS_ALIAS[d] ?? d)
// matplotlib 依赖链较重的可选件、pdf2image 需 poppler：仍装上，避免「探测分数低导致不被选中」
const finalList = [...all].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))

console.log('\n最终依赖清单（静态扫描 ∪ SKILL_DEPS）:')
for (const p of finalList) console.log('  ' + p)

const header = `# 绿色包 Python 依赖清单 —— 由 dev/portable/scan-py-deps.mjs 自动生成
#
# 组成：skills/ 下 315 个 .py 的静态 import  ∪  src/services/skill-service.ts 的 SKILL_DEPS
# 原因：插件 resolvePython() 会按「能 import 多少个 SKILL_DEPS」给候选解释器打分，
#       包内 Python 必须命中数最高才会被自动选中，否则技能仍会 ModuleNotFoundError。
#
# 安装：dev/portable/prepare-pydeps.ps1 （装进包内 Python，不污染系统）
`
const body = finalList.join('\n') + '\n'
writeFileSync(join(root, 'dev/portable/py-requirements.txt'), header + body, 'utf8')
console.log('\n已写入 dev/portable/py-requirements.txt')

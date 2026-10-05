/**
 * 审计绿色包里「装了很多、但技能从不 import」的依赖，输出可安全删除的清单。
 *
 * 为什么需要：SKILL_DEPS 白名单里有几个包（pywencai/akshare/matplotlib）是
 * 从别处机械照搬进来的，实际没有任何技能 import。它们会拖入极长的依赖链：
 *   pywencai  → py_mini_racer(38MB) + debugpy(31MB) + jedi(14MB) + IPython/Jupyter…
 *   matplotlib→ 31MB + fontTools(11MB)
 *   akshare   → 9MB + curl_cffi 等
 * 合计 200 MB+ 纯属白背。
 *
 * 判据（三重，避免误删）：
 *   A. AST：全仓库所有 .py 的真实 import（用 python 的 ast 模块解析，
 *      不会把注释里的 "matplotlib" 误判成依赖）
 *   B. 文本：SKILL.md 是否把它声明为依赖
 *   C. 反查：site-packages 里是否有别的包 import 它（间接依赖）
 * 三项全不命中才算「可删」。
 *
 * 注意：SKILL_DEPS 白名单**不**作为判据 —— 它正是被质疑的对象。
 * 但删掉后包内解释器的命中分会下降，所以必须配合
 * src/services/skill-service.ts 里「DSAGENT_PYTHON 绝对优先」的改动，
 * 否则可能被系统里某个装了更多无关包的 Python 抢走。
 *
 * 用法：
 *   node dev/portable/audit-blank-deps.mjs            # 只报告
 *   node dev/portable/audit-blank-deps.mjs --write    # 写入 blank-deps.json（供打包脚本裁剪）
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const writing = process.argv.includes('--write')

/** 已确认「技能真实使用」的包，永不裁剪（有 AST 或 SKILL.md 证据）。 */
const KEEP_ALWAYS = new Set([
  'httpx', 'requests', 'bs4', 'jieba', 'lxml', 'markdown', 'numpy', 'openpyxl',
  'pandas', 'PIL', 'Pillow', 'docx', 'python-docx', 'pptx', 'python-pptx',
  'yaml', 'PyYAML', 'pdfplumber', 'pypdf', 'pdf2image', 'defusedxml', 'validators',
  'xlrd', 'XlsxWriter', 'et_xmlfile', 'soupsieve', 'charset-normalizer', 'urllib3',
  'certifi', 'idna', 'httpcore', 'h11', 'anyio', 'sniffio', 'six', 'python-dateutil',
  'pytz', 'tzdata', 'packaging', 'decorator', 'tqdm', 'tabulate', 'jsonpath',
  'html5lib', 'webencodings', 'pdfminer.six', 'pdfminer', 'cryptography', 'cffi',
  'pycparser', 'pyparsing', 'fontTools', 'contourpy', 'cycler', 'kiwisolver',
  'pypdfium2', 'colorama', 'typing-extensions', 'pip', 'setuptools', 'pkg_resources',
])

/** 候选裁剪包（体积大、疑似白背）。脚本会逐项验证后才决定。 */
const CANDIDATES = [
  { pip: 'pywencai', mod: 'pywencai', why: 'SKILL.md 自称无第三方依赖；无 import' },
  { pip: 'akshare', mod: 'akshare', why: '无 import；SKILL_DEPS 照搬' },
  { pip: 'matplotlib', mod: 'matplotlib', why: '无 import；仅注释提及' },
  { pip: 'curl_cffi', mod: 'curl_cffi', why: '仅被 akshare 使用' },
  { pip: 'py_mini_racer', mod: 'py_mini_racer', why: '仅被 pywencai 使用' },
  { pip: 'debugpy', mod: 'debugpy', why: '仅被 ipykernel(pywencai 依赖) 使用' },
  { pip: 'jedi', mod: 'jedi', why: '仅被 IPython(pywencai 依赖) 使用' },
  { pip: 'IPython', mod: 'IPython', why: 'pywencai -> ipykernel -> IPython' },
  { pip: 'ipykernel', mod: 'ipykernel', why: 'pywencai 依赖' },
  { pip: 'jupyter_client', mod: 'jupyter_client', why: 'ipykernel 依赖' },
  { pip: 'jupyter_core', mod: 'jupyter_core', why: 'ipykernel 依赖' },
  { pip: 'prompt_toolkit', mod: 'prompt_toolkit', why: 'IPython 依赖' },
  { pip: 'pygments', mod: 'pygments', why: 'IPython 依赖' },
  { pip: 'stack_data', mod: 'stack_data', why: 'IPython 依赖' },
  { pip: 'asttokens', mod: 'asttokens', why: 'stack_data 依赖' },
  { pip: 'executing', mod: 'executing', why: 'stack_data 依赖' },
  { pip: 'pure_eval', mod: 'pure_eval', why: 'stack_data 依赖' },
  { pip: 'parso', mod: 'parso', why: 'jedi 依赖' },
  { pip: 'pexpect', mod: 'pexpect', why: 'IPython 依赖' },
  { pip: 'ptyprocess', mod: 'ptyprocess', why: 'pexpect 依赖' },
  { pip: 'matplotlib_inline', mod: 'matplotlib_inline', why: 'ipykernel 依赖' },
  { pip: 'nest_asyncio2', mod: 'nest_asyncio2', why: 'ipykernel 依赖' },
  { pip: 'traitlets', mod: 'traitlets', why: 'IPython/jupyter 依赖' },
  { pip: 'platformdirs', mod: 'platformdirs', why: 'jupyter_core 依赖' },
  { pip: 'psutil', mod: 'psutil', why: 'ipykernel 依赖' },
  { pip: 'comm', mod: 'comm', why: 'ipykernel 依赖' },
  { pip: 'tornado', mod: 'tornado', why: 'ipykernel 依赖' },
  { pip: 'zmq', mod: 'zmq', why: 'ipykernel 依赖' },
  { pip: 'fake_useragent', mod: 'fake_useragent', why: 'pywencai 依赖' },
  { pip: 'pydash', mod: 'pydash', why: 'pywencai 依赖' },
  { pip: 'PyExecJS', mod: 'PyExecJS', why: 'pywencai 依赖' },
]

const EXCLUDE_RE = /node_modules|\\\.git\\|\.tmp-accio|_accio_probe|accio_extracted|accio-app|\\dist\\|dev\\portable/

function walkPy(dir, out = [], depth = 0) {
  if (depth > 8) return out
  let ents
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents) {
    const p = join(dir, e.name)
    if (EXCLUDE_RE.test(p)) continue
    if (e.isDirectory()) {
      if (e.name === '__pycache__') continue
      walkPy(p, out, depth + 1)
    } else if (e.name.endsWith('.py')) out.push(p)
  }
  return out
}

// A. 全仓库 AST（用包内 python 解析，最可靠）
function realImports() {
  const py = pickPython()
  if (!py) return null
  const script = `
import ast, os, json
root = r"${root.replace(/\\/g, '\\\\')}"
skip = ('node_modules','.git','__pycache__','.tmp-accio','_accio_probe','accio_extracted','accio-app','dist')
mods = set()
for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if d not in skip]
    for fn in filenames:
        if not fn.endswith('.py'): continue
        try:
            tree = ast.parse(open(os.path.join(dirpath, fn), encoding='utf-8', errors='ignore').read())
        except Exception:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for a in node.names: mods.add(a.name.split('.')[0])
            elif isinstance(node, ast.ImportFrom):
                if node.module and node.level == 0: mods.add(node.module.split('.')[0])
print('|'.join(sorted(mods)))
`
  try {
    const out = execFileSync(py, ['-'], { input: script, encoding: 'utf8', timeout: 300000 })
    return new Set(out.trim().split('\n').pop().split('|'))
  } catch (e) {
    console.warn('AST 解析失败，回退到正则:', e.message)
    return null
  }
}

function pickPython() {
  const cands = [
    join(process.env.USERPROFILE, 'DSAgent-Portable-build', 'DSAgent-Portable', 'python', 'python.exe'),
    join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Python311', 'python.exe'),
    join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Python312', 'python.exe'),
  ]
  return cands.find((p) => existsSync(p)) ?? null
}

/** B. SKILL.md 是否声明该依赖。 */
function declaredInSkillMd(pipName, modName) {
  const hits = []
  const walk = (dir, depth = 0) => {
    if (depth > 6) return
    let ents
    try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = join(dir, e.name)
      if (EXCLUDE_RE.test(p)) continue
      if (e.isDirectory()) { walk(p, depth + 1); continue }
      if (!/^SKILL\.md$/i.test(e.name)) continue
      try {
        const c = readFileSync(p, 'utf8')
        if (c.includes(pipName) || c.includes(modName)) {
          // 排除技能自己名字里的巧合（如 pywencai-stock 的 name 字段）
          const lines = c.split('\n').filter((l) => l.includes(pipName) || l.includes(modName))
          const meaningful = lines.filter((l) => /依赖|require|install|import|bins/i.test(l))
          if (meaningful.length) hits.push({ file: p.replace(root, ''), line: meaningful[0].trim().slice(0, 100) })
        }
      } catch {}
    }
  }
  walk(root)
  return hits
}

const ast = realImports()
console.log('=== 审计可安全裁剪的依赖 ===')
console.log('AST 解析:', ast ? `成功（${ast.size} 个模块）` : '失败（回退正则）')
console.log('')

const blank = []
for (const c of CANDIDATES) {
  if (KEEP_ALWAYS.has(c.pip)) { console.log(`  KEEP   ${c.pip.padEnd(18)} 在白名单中`); continue }
  const astHit = ast ? ast.has(c.mod) : false
  const md = declaredInSkillMd(c.pip, c.mod)
  if (astHit || md.length > 0) {
    console.log(`  KEEP   ${c.pip.padEnd(18)} ${astHit ? 'AST 命中' : ''}${md.length ? ' SKILL.md 声明: ' + md[0].line : ''}`)
  } else {
    blank.push(c.pip)
    console.log(`  BLANK  ${c.pip.padEnd(18)} 无 import、无声明 → ${c.why}`)
  }
}

console.log(`\n可裁剪 ${blank.length} 个: ${blank.join(', ')}`)

if (writing) {
  const outFile = join(root, 'dev', 'portable', 'blank-deps.json')
  writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), blank }, null, 2), 'utf8')
  console.log('已写入', outFile)
}

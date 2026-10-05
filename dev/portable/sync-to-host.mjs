/**
 * 把最新的客户端构建成果同步到「宿真正在监视的插件目录」。
 *
 * ── 为什么需要这个脚本 ────────────────────────────────────────────────
 * DSH Desktop 有一套「profile 迁移」机制：它会把 profile 里的本地插件
 * （`link:<工作区>`）staging 成一份**快照副本**放在
 *   <harness>/profiles/.generations/live/<id>/
 * 并把 profile 的 junction 改指到那份快照（同时在 profile 的 package.json
 * 里写死 pnpm.overrides）。迁移成功后，宿主加载与监视的都是**快照内的文件**，
 * 而不再是你的工作区。
 *
 * 后果：`npm run build` 把产物写进工作区 lib/，宿主根本看不到 ——
 * 表现为「代码改了、也构建了，但页面上插件 UI 不更新 / 不显示」。
 * 2026-10-04 就是这样踩了一次，排查了很久。
 *
 * ── 本脚本做什么 ──────────────────────────────────────────────────────
 *   1. 解析 profile 里 @dsagent/dsagent-plugin 的 junction 实际指向
 *   2. 若指向工作区 → 什么都不用做（正常情况）
 *   3. 若指向快照   → 把工作区的 lib/ 与 package.json 覆盖过去
 *      覆盖后文件 mtime 变化，dsh-client-hmr（500ms 轮询）会立即
 *      重新读取字节并通知页面热重载，**不需要重启应用**。
 *
 * 幂等，可反复执行。
 *
 * 用法：
 *   node dev/portable/sync-to-host.mjs           # 同步（找不到宿主则静默跳过）
 *   node dev/portable/sync-to-host.mjs --verbose # 打印细节
 *   node dev/portable/sync-to-host.mjs --strict  # 找不到宿主时报错退出
 */
import { cpSync, existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const verbose = process.argv.includes('--verbose')
const strict = process.argv.includes('--strict')

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..', '..')

const log = (...a) => { if (verbose) console.log(...a) }

/** 计算与 dsh-client-modules 一致的文件版本号（用于判断宿主是否已拾取）。 */
function artifactRevision(p) {
  const s = statSync(p)
  const h = createHash('sha1').update('plugin-artifact').update('\0')
  for (const part of [String(s.mtimeMs), String(s.ctimeMs), String(s.size)]) {
    h.update(`${Buffer.byteLength(part)}:`).update(part)
  }
  return h.digest('hex').slice(0, 12)
}

/** 找出 Desktop 版 DSH 的 harness 目录（可能不存在，说明没装 Desktop）。 */
function findHarnessDirs() {
  const dirs = []
  const appData = process.env.APPDATA
  if (!appData) return dirs
  // Desktop 版：%APPDATA%\dsh-desktop\harness
  const desktopHarness = join(appData, 'dsh-desktop', 'harness')
  if (existsSync(desktopHarness)) dirs.push(desktopHarness)
  return dirs
}

/** 从 harness 目录里找出所有 profile 下指向本插件的 junction。 */
function findPluginLinks(harnessDir) {
  const found = []
  const profilesDir = join(harnessDir, 'profiles')
  if (!existsSync(profilesDir)) return found

  for (const profileName of ['web', 'desktop', 'tui']) {
    const link = join(profilesDir, profileName, 'node_modules', '@dsagent', 'dsagent-plugin')
    if (!existsSync(link)) continue
    let target = null
    try {
      // realpath 会把 junction 解到最终真实路径（快照或工作区）
      target = realpathSync(link)
    } catch (e) {
      log(`  realpath 失败 ${link}: ${e.message}`)
      continue
    }
    found.push({ profileName, link, target })
  }
  return found
}

const sourceLib = join(repoRoot, 'lib')
const sourceClient = join(sourceLib, 'client.js')
const sourcePkg = join(repoRoot, 'package.json')

if (!existsSync(sourceClient)) {
  console.error('[sync-to-host] 找不到 lib/client.js，请先构建：npm run build')
  process.exit(1)
}

// 产物自检：防止把 tsc 的裸源码当成 bundle 同步过去
const clientText = readFileSync(sourceClient, 'utf8')
if (!clientText.startsWith('window.__ModuleLoader__.load(') || !clientText.includes('id: "@dsagent/dsagent-plugin"')) {
  console.error('[sync-to-host] lib/client.js 不是合格的 ModuleLoader bundle（疑似被 tsc 覆盖），已中止。')
  console.error('                 请重新构建：npm run build')
  process.exit(1)
}

const harnessDirs = findHarnessDirs()
if (harnessDirs.length === 0) {
  if (strict) {
    console.error('[sync-to-host] 未找到 DSH Desktop 的 harness 目录（%APPDATA%\\dsh-desktop\\harness）')
    process.exit(1)
  }
  log('[sync-to-host] 未找到 DSH Desktop harness，跳过同步（不影响构建产物）')
  process.exit(0)
}

let synced = 0
let alreadyOk = 0

for (const harnessDir of harnessDirs) {
  log(`\n[sync-to-host] harness: ${harnessDir}`)
  for (const { profileName, link, target } of findPluginLinks(harnessDir)) {
    log(`  profile ${profileName}`)
    log(`    junction -> ${target}`)

    const targetIsWorkspace = resolve(target).toLowerCase() === resolve(repoRoot).toLowerCase()
    if (targetIsWorkspace) {
      log('    指向工作区，无需同步')
      alreadyOk++
      continue
    }

    // 目标应是快照内的插件目录（含 package.json 与 lib/）
    const targetClient = join(target, 'lib', 'client.js')
    if (!existsSync(join(target, 'package.json'))) {
      console.warn(`[sync-to-host] 跳过：目标不像插件目录（无 package.json）: ${target}`)
      continue
    }
    if (!existsSync(join(target, 'lib'))) {
      console.warn(`[sync-to-host] 跳过：目标缺少 lib/ 目录: ${target}`)
      continue
    }

    const beforeSize = existsSync(targetClient) ? statSync(targetClient).size : 0

    // 覆盖 lib/（host 半区 index.js + browser 半区 client.js 一并更新）
    cpSync(sourceLib, join(target, 'lib'), { recursive: true, force: true })
    // package.json 也同步（exports / dsh.client 声明可能变更）
    cpSync(sourcePkg, join(target, 'package.json'), { force: true })

    const afterRev = artifactRevision(join(target, 'lib', 'client.js'))
    console.log(
      `[sync-to-host] 已同步到快照（profile ${profileName}）` +
      ` client.js ${beforeSize} → ${statSync(join(target, 'lib', 'client.js')).size} bytes, rev ${afterRev}`,
    )
    synced++
  }
}

if (synced === 0 && alreadyOk > 0) {
  log('\n[sync-to-host] 宿主直接读工作区，无需同步')
} else if (synced > 0) {
  console.log('[sync-to-host] 完成。dsh-client-hmr 会自动热重载页面（约 0.5 秒），无需重启应用。')
  console.log('              若页面仍未更新，手动刷新一次浏览器即可。')
}

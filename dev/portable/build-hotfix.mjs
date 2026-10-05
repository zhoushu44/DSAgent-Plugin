/**
 * 生成「脚本热修包」—— 只含 4 个启动/更新脚本（约 30 KB）。
 *
 * 用途：已经解压过绿色包的用户，如果遇到双击报错
 *   '...' is not recognized as an internal or external command
 * 只需把这个小包解压覆盖到绿色包目录即可，不必重新下载 342 MB。
 *
 * 覆盖的文件：
 *   启动 DSAgent.cmd   （修正为纯 ASCII + CRLF）
 *   更新.cmd           （同上）
 *   launch.ps1         （修正为 UTF-8 with BOM）
 *   update.ps1         （同上）
 */
import { mkdirSync, copyFileSync, rmSync, existsSync, writeFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repo = resolve(scriptDir, '..', '..')
const outRoot = join(process.env.USERPROFILE, 'DSAgent-Portable-build')
const stage = join(process.env.TEMP, 'dsagent-hotfix-stage')
const zipPath = join(outRoot, 'DSAgent-Hotfix-scripts.zip')

rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })

// 源文件 → 包内目标名
const files = [
  ['dev/portable/launch.ps1', 'launch.ps1'],
  ['dev/portable/launch.cmd', '启动 DSAgent.cmd'],
  ['dev/portable/update.ps1', 'update.ps1'],
  ['dev/portable/update.cmd', '更新.cmd'],
]

console.log('=== 收集热修文件 ===')
for (const [src, dst] of files) {
  const s = join(repo, src)
  if (!existsSync(s)) { console.log(`  缺失: ${src}`); continue }
  copyFileSync(s, join(stage, dst))
  console.log(`  ${dst}`)
}

// 附一份说明
writeFileSync(join(stage, '怎么用.txt'), [
  'DSAgent 启动脚本 热修包',
  '',
  '如果双击「启动 DSAgent.cmd」出现类似下面的报错：',
  "    '...' is not recognized as an internal or external command",
  '说明你手上的版本脚本编码有问题，用本包修复即可，无需重新下载整个绿色包。',
  '',
  '用法：',
  '  1. 关闭正在运行的 DSAgent',
  '  2. 把本压缩包里的 4 个文件解压，覆盖到绿色包目录',
  '     （即包含 app / python / plugin 的那个目录）',
  '  3. 提示替换时选「全部替换」',
  '  4. 重新双击「启动 DSAgent.cmd」',
  '',
  '你的 data 目录（账号、会话）不受影响。',
  '',
].join('\r\n'), 'utf8')

// 压缩
// ★ 用 '<stage>\*' 而不是 '<stage>'：后者会把 stage 目录本身也打进 zip，
//   用户解压后得到一层 dsagent-hotfix-stage\ 目录，找不到启动文件。
//   这里要的是「解压出来就是那 5 个文件」，方便直接覆盖到绿色包目录。
if (existsSync(zipPath)) rmSync(zipPath, { force: true })
console.log('\n=== 压缩 ===')
execFileSync('pwsh', ['-NoProfile', '-Command',
  `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zipPath}' -CompressionLevel Optimal`],
  { stdio: 'inherit' })

const { statSync } = await import('node:fs')
console.log(`\n✅ 热修包: ${zipPath}  (${(statSync(zipPath).size / 1024).toFixed(1)} KB)`)
console.log('   含:', readdirSync(stage).join(', '))

rmSync(stage, { recursive: true, force: true })

/**
 * 修正分发包脚本的编码与换行 —— 这是「双击后报 ERROR」的根因修复。
 *
 * 两类文件、两种要求：
 *
 *  1. .cmd → **纯 ASCII + CRLF**
 *     cmd.exe 按系统 ANSI 代码页（中文 Windows = GBK）解析 .cmd 文件，
 *     与文件自身编码无关。UTF-8 的中文注释会被读成乱码，接着被当成命令执行：
 *       '文件所在目录（保证相对路径正确）' is not recognized as an internal or external command
 *     实测复现过。因此 .cmd 里不放任何非 ASCII 字符，中文提示全部交给 .ps1 输出。
 *     换行也必须是 CRLF（Windows 批处理要求）。
 *
 *  2. .ps1 → **UTF-8 with BOM**
 *     Windows PowerShell 5.1 读取无 BOM 的 .ps1 时按 ANSI 解释，
 *     其中的中文会乱码。加 BOM 后 5.1 与 7 都能正确识别 UTF-8。
 *
 * 用法：node dev/portable/fix-script-encoding.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))

const CMD_FILES = ['launch.cmd', 'update.cmd']
const PS1_FILES = ['launch.ps1', 'update.ps1']

let problems = 0

console.log('=== 1. .cmd 文件：纯 ASCII + CRLF ===\n')
for (const name of CMD_FILES) {
  const p = join(scriptDir, name)
  if (!existsSync(p)) { console.log(`  跳过（不存在）: ${name}`); continue }

  let text = readFileSync(p, 'utf8')
  // 统一到 LF，再整体转 CRLF，避免混用
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n')
  text = text.replace(/^\uFEFF/, '')

  const gbkBytes = Buffer.from(text, 'utf8')
  const nonAscii = [...text].filter((c) => c.codePointAt(0) > 0x7f)
  if (nonAscii.length > 0) {
    // 找出非 ASCII 所在行，便于人工处理
    const lines = text.split('\r\n')
    const bad = lines.map((l, i) => ({ i: i + 1, l })).filter((x) => [...x.l].some((c) => c.codePointAt(0) > 0x7f))
    console.log(`  ! ${name} 含 ${nonAscii.length} 个非 ASCII 字符，位于:`)
    for (const b of bad.slice(0, 5)) console.log(`      line ${b.i}: ${b.l.trim().slice(0, 60)}`)
    problems++
  }

  // 写回：纯 ASCII 内容，CRLF 换行，无 BOM
  writeFileSync(p, Buffer.from(text, 'ascii'))

  const after = readFileSync(p)
  const crlf = (after.toString('latin1').match(/\r\n/g) ?? []).length
  const loneLf = (after.toString('latin1').match(/(?<!\r)\n/g) ?? []).length
  const stillNonAscii = after.filter((b) => b > 0x7f).length
  console.log(`  ${name}`)
  console.log(`    CRLF=${crlf} 裸LF=${loneLf} 非ASCII字节=${stillNonAscii} 大小=${after.length}`)
  console.log(`    ${loneLf === 0 && stillNonAscii === 0 ? 'OK' : '仍有问题'}\n`)
}

console.log('=== 2. .ps1 文件：UTF-8 with BOM ===\n')
for (const name of PS1_FILES) {
  const p = join(scriptDir, name)
  if (!existsSync(p)) { console.log(`  跳过（不存在）: ${name}`); continue }

  let text = readFileSync(p, 'utf8')
  const hadBom = text.charCodeAt(0) === 0xfeff
  text = text.replace(/^\uFEFF/, '')

  // 写回 UTF-8 BOM
  writeFileSync(p, '\uFEFF' + text, 'utf8')

  const after = readFileSync(p)
  const hasBom = after[0] === 0xef && after[1] === 0xbb && after[2] === 0xbf
  const validUtf8 = (() => {
    try { new TextDecoder('utf-8', { fatal: true }).decode(after); return true } catch { return false }
  })()
  console.log(`  ${name}`)
  console.log(`    原有BOM=${hadBom} 现有BOM=${hasBom} 合法UTF8=${validUtf8} 大小=${after.length}`)
  console.log(`    ${hasBom && validUtf8 ? 'OK' : '仍有问题'}\n`)
}

console.log('=== 结论 ===')
console.log(problems > 0
  ? `⚠️ 有 ${problems} 个 .cmd 仍含非 ASCII 字符，需要手工改成英文`
  : '✅ 全部修正完成：.cmd 纯 ASCII+CRLF，.ps1 UTF-8+BOM')

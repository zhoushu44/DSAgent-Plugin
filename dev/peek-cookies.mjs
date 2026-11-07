import * as fs from 'node:fs'
import * as path from 'node:path'

const SRC = 'C:/Users/Administrator/.dsh/browser-profiles/accounts/pdd_mms_2384db98bbcb596936cded12513defe7'

console.log('=== 源 Profile 里的 Cookie 相关文件 ===')
for (const rel of ['Default/Cookies', 'Default/Cookies-journal', 'Default/Network/Cookies', 'Default/Local State', 'Default/Secure Preferences', 'Local State']) {
  const p = path.join(SRC, rel)
  if (fs.existsSync(p)) {
    const sz = fs.statSync(p).size
    console.log(`  ${rel.padEnd(28)} ${(sz / 1024).toFixed(1)} KB`)
  } else {
    console.log(`  ${rel.padEnd(28)} 不存在`)
  }
}

console.log('\n=== Default 目录顶层 ===')
try {
  const items = fs.readdirSync(path.join(SRC, 'Default'), { withFileTypes: true })
  const cookieish = items.filter(i => /cookie|login|session|storage/i.test(i.name))
  console.log('  Cookie/登录相关:', cookieish.map(i => `${i.name}${i.isDirectory() ? '/' : ''}`).join(', ') || '无')
  console.log(`  顶层条目总数: ${items.length}`)
} catch (e) {
  console.log('  读失败:', e.message)
}

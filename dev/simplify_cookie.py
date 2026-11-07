# -*- coding: utf-8 -*-
"""简化 batch-publish.mjs 的 Cookie 共享逻辑"""
from pathlib import Path

f = Path(r'e:\360MoveData\Users\Administrator\Desktop\DSAgent-Plugin\skills\pdd-publish-http\scripts\batch-publish.mjs')
s = f.read_text(encoding='utf-8')

OLD_START = "// Cookie 共享：从已登录的源 Profile 导入"
OLD_END = "// ★ 2026-11-01 提速：整个批次只启动一次浏览器"

i = s.find(OLD_START)
j = s.find(OLD_END)
if i < 0 or j < 0 or j < i:
    print('NOT FOUND')
    raise SystemExit(1)

NEW = '''// ★ 2026-11-03 Cookie 共享：从已登录的源 Profile 读 Cookie（明文，可跨 Profile 迁移）
//   原理：Chrome 的 Cookie 加密密钥绑定 Profile 路径，所以复制目录会让 Cookie 解不开。
//        但 page.cookies() 返回的是【解密后的明文】，可注入到任意 Profile。
//   用法：--share-cookie <srcShopKey>
if (shareCookie) {
  const srcDir = path.join(BASE, shareCookie)
  if (!fs.existsSync(srcDir)) {
    log(`❌ 源 Profile 不存在: ${srcDir}`)
    process.exit(1)
  }
  log(`Cookie 共享：从 ${shareCookie} 读登录态…`)
  try {
    // 锁文件会让 Chrome 启动失败，先清
    for (const f of ['SingletonLock','SingletonSocket','SingletonCookie','DevToolsActivePort','lockfile']) {
      try { fs.unlinkSync(path.join(srcDir, f)) } catch {}
    }
    const srcB = await puppeteer.launch({
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: false, userDataDir: srcDir, defaultViewport: null,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
      ignoreDefaultArgs: ['--enable-automation'], protocolTimeout: 600000,
    })
    const sp = await srcB.newPage()
    await sp.goto('https://mms.pinduoduo.com/goods/goods_list', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await new Promise(r => setTimeout(r, 8000))
    const isLogin = await sp.evaluate(() => /\\/login\\//.test(location.href))
    if (isLogin) {
      await srcB.close()
      log(`❌ 源账号 ${shareCookie} 未登录，请先在账号连接器扫码`)
      process.exit(1)
    }
    const cookies = await sp.cookies()
    await srcB.close()
    if (!cookies.length) {
      log('❌ 源 Profile 没导出到 Cookie')
      process.exit(1)
    }
    cookieFileToInject = path.join(os.tmpdir(), `pdd-cookies-${Date.now()}.json`)
    fs.writeFileSync(cookieFileToInject, JSON.stringify(cookies), 'utf8')
    const keyNames = [...new Set(cookies.map(c => c.name))].filter(n => /PASS_ID|JSESSIONID/i.test(n))
    log(`  ✅ 导出 ${cookies.length} 个 Cookie${keyNames.length ? '（含 ' + keyNames.join(', ') + '）' : ''}`)
  } catch (e) {
    log(`  ❌ 读 Cookie 失败: ${String(e.message).slice(0, 100)}`)
    process.exit(1)
  }
}

'''

s = s[:i] + NEW + s[j:]
f.write_text(s, encoding='utf-8')
print('OK: Cookie 共享逻辑已简化')

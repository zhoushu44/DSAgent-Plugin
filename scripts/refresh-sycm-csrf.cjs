/**
 * 用淘宝 SSO Cookie 访问 sycm.taobao.com，获取 _csrf / alimama_csrf_id 等额外 cookie。
 * 运行后自动回写凭证库。
 *
 * 用法：node scripts/refresh-sycm-csrf.cjs
 */
const puppeteer = require('puppeteer-core')
const fs = require('fs')
const path = require('path')
const os = require('os')

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const ACCOUNTS_FILE = path.join(os.homedir(), '.dsh', 'dsagent-accounts.json')

async function main() {
  const data = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'))
  const taobao = Object.values(data.accounts).find(a => a.platform === 'taobao')
  if (!taobao) {
    console.error('未找到淘宝账号')
    process.exit(1)
  }
  console.log(`[INFO] 淘宝账号: ${taobao.shop_key}, cookies: ${Object.keys(taobao.cookies).length}`)

  const profileDir = path.join(os.homedir(), '.dsh', 'browser-profiles', 'sycm-refresh')
  fs.mkdirSync(profileDir, { recursive: true })

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: CHROME_PATH,
    userDataDir: profileDir,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  })

  try {
    const page = await browser.newPage()
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    )

    // 1. 先访问 taobao.com 设置淘宝域 Cookie
    console.log('[STEP] 访问 taobao.com 设置淘宝 SSO Cookie...')
    await page.goto('https://www.taobao.com/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await new Promise(r => setTimeout(r, 2000))

    // 设置淘宝 Cookie
    const tbCookieStr = taobao.cookie_str
    const cookies = tbCookieStr.split(';').map(c => {
      const idx = c.indexOf('=')
      const name = c.slice(0, idx).trim()
      const value = c.slice(idx + 1).trim()
      return { name, value, domain: '.taobao.com' }
    }).filter(c => c.name)

    for (const c of cookies) {
      await page.setCookie({ ...c, path: '/' })
    }
    console.log(`[STEP] 已设置 ${cookies.length} 个淘宝 Cookie`)

    // 2. 依次访问 sycm / 万相台 / 达摩盘，触发 SSO 并收集各域 Cookie
    //    _csrf / alimama_csrf_id / alimama_login_point_id 由万相台（one.alimama.com）下发
    const visits = [
      { url: 'https://sycm.taobao.com/', label: 'sycm.taobao.com' },
      { url: 'https://one.alimama.com/', label: 'one.alimama.com' },
      { url: 'https://dmp.taobao.com/', label: 'dmp.taobao.com' },
    ]
    const merged = {}
    for (const v of visits) {
      console.log(`[STEP] 访问 ${v.label} 触发 SSO...`)
      try {
        await page.goto(v.url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await new Promise(r => setTimeout(r, 5000))
        console.log(`[STEP] ${v.label} 当前 URL: ${page.url()}`)
        const got = await page.cookies('https://.taobao.com', 'https://.alimama.com', 'https://.mmstat.com')
        console.log(`[STEP] ${v.label} 获取到 ${got.length} 个 Cookie`)
        for (const c of got) if (c.value) merged[c.name] = c.value
      } catch (e) {
        console.log(`[WARN] 访问 ${v.label} 失败: ${e.message}`)
      }
    }

    const sycmCookies = Object.entries(merged).map(([name, value]) => ({ name, value }))
    console.log(`[STEP] 合并后共 ${sycmCookies.length} 个 Cookie`)

    // 检查关键 cookie
    const csrf = sycmCookies.find(c => c.name === '_csrf')
    const alimamaCsrf = sycmCookies.find(c => c.name === 'alimama_csrf_id')
    const loginPointId = sycmCookies.find(c => c.name === 'alimama_login_point_id')
    const cookie2 = sycmCookies.find(c => c.name === 'cookie2')
    const tbToken = sycmCookies.find(c => c.name === '_tb_token_')

    console.log(`[RESULT] _csrf: ${csrf ? csrf.value.slice(0, 10) + '...' : 'NOT FOUND'}`)
    console.log(`[RESULT] alimama_csrf_id: ${alimamaCsrf ? alimamaCsrf.value.slice(0, 10) + '...' : 'NOT FOUND'}`)
    console.log(`[RESULT] alimama_login_point_id: ${loginPointId ? loginPointId.value.slice(0, 10) + '...' : 'NOT FOUND'}`)
    console.log(`[RESULT] cookie2: ${cookie2 ? 'FOUND' : 'NOT FOUND'}`)
    console.log(`[RESULT] _tb_token_: ${tbToken ? 'FOUND' : 'NOT FOUND'}`)

    // 4. 合并 Cookie 回写凭证库
    const sycmAccount = Object.values(data.accounts).find(a => a.platform === 'sycm')
    if (sycmAccount) {
      // 合并新 cookie 到 sycm 账号
      const newCookies = {}
      for (const c of sycmCookies) {
        if (c.value) newCookies[c.name] = c.value
      }
      // 合并：旧 cookie + 新 cookie（新 cookie 优先）
      sycmAccount.cookies = { ...sycmAccount.cookies, ...newCookies }
      // 重建 cookie_str
      sycmAccount.cookie_str = Object.entries(sycmAccount.cookies)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')

      // 更新 csrf_id
      if (csrf) sycmAccount.csrf_id = csrf.value
      else if (alimamaCsrf) sycmAccount.csrf_id = alimamaCsrf.value

      // 更新 login_point_id
      if (loginPointId) {
        sycmAccount.login_point_id = loginPointId.value
      } else if (!sycmAccount.login_point_id) {
        sycmAccount.login_point_id = ''
      }

      // 更新 tb_token
      if (tbToken) sycmAccount.tb_token = tbToken.value

      sycmAccount.status = 'valid'
      sycmAccount.session_hint = 'ok'
      sycmAccount.last_checked_at = new Date().toISOString()

      console.log(`[WRITE] sycm 更新后: cookies=${Object.keys(sycmAccount.cookies).length}, csrf_id=${sycmAccount.csrf_id ? sycmAccount.csrf_id.slice(0, 10) + '...' : 'EMPTY'}, login_point_id=${sycmAccount.login_point_id || 'EMPTY'}`)
    } else {
      console.log('[WARN] 未找到 sycm 账号，跳过回写')
    }

    // 原子写入
    const tmpPath = ACCOUNTS_FILE + '.tmp'
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
    fs.renameSync(tmpPath, ACCOUNTS_FILE)
    console.log('[DONE] 凭证库已更新')
  } finally {
    await browser.close()
  }
}

main().catch(err => {
  console.error('ERROR:', err)
  process.exit(1)
})

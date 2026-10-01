/**
 * 从浏览器 Profile 恢复 cookie，重建 dsagent-accounts.json
 * 使用 puppeteer-core 以 headless 模式打开浏览器 Profile，
 * 提取明文 cookie，然后生成 cookie_str。
 */
const puppeteer = require('puppeteer-core')
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')

// 与 credential-store.ts::SHOP_KEY_RE 保持严格一致，禁止放宽
const SHOP_KEY_RE = /^[a-z_]+_[A-Za-z0-9_-]+$/

const PROFILES_DIR = path.join(os.homedir(), '.dsh', 'browser-profiles')
const ACCOUNTS_FILE = path.join(os.homedir(), '.dsh', 'dsagent-accounts.json')

// 平台 -> 登录域名映射（与 credential-store.ts 的 getAllDomainCookies 一致）
const DOMAIN_MAP = {
  taobao: ['https://.taobao.com', 'https://.tmall.com'],
  tmall: ['https://.taobao.com', 'https://.tmall.com'],
  xianyu: ['https://.taobao.com', 'https://.goofish.com'],
  sycm: ['https://.taobao.com'],
  alimama: ['https://.taobao.com'],
  dmp: ['https://.taobao.com'],
  sycm_insight: ['https://.taobao.com'],
  xiaohongshu: [],
  zhihu: [],
  douyin: [],
  bilibili: [],
  kuaishou: [],
}

// 平台 -> 关键 cookie（用于判断登录态）
const KEY_COOKIES = {
  taobao: ['unb'],
  tmall: ['unb'],
  xianyu: ['unb'],
  sycm: ['cookie2', '_tb_token_'],
  alimama: ['cookie2', '_tb_token_'],
  dmp: ['cookie2', '_tb_token_'],
  sycm_insight: ['cookie2'],
  xiaohongshu: ['web_session'],
  zhihu: ['z_c0'],
  douyin: ['sessionid'],
  bilibili: ['SESSDATA'],
  kuaishou: ['did'],
}

// 平台 -> account_id 来源 cookie
const ACCOUNT_ID_FROM = {
  taobao: 'unb',
  tmall: 'unb',
  xianyu: 'unb',
  sycm: 'cookie2',
  alimama: 'cookie2',
  dmp: 'cookie2',
  sycm_insight: 'cookie2',
  xiaohongshu: 'web_session',
  zhihu: 'z_c0',
  douyin: 'sessionid',
  bilibili: 'SESSDATA',
  kuaishou: 'did',
}

// 平台 -> 昵称 cookie
const NICK_COOKIES = ['_nk_', 'tracknick', 'lgc', 'dnk', 'lid', 'nick', 'nickname', 'display_name', 'uname', 'uid_tt', 'sid_tt', 'nickname_tt']

function toCookieStr(jar) {
  return Object.entries(jar)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

// 平台 -> 真实用户 ID cookie（优先于 ACCOUNT_ID_FROM，避免截断长会话票据）
const ACCOUNT_ID_UID = {
  bilibili: 'DedeUserID',
}

function makeShopKey(platform, accountId) {
  if (!accountId) return ''
  const key = `${platform}_${accountId}`
  if (!SHOP_KEY_RE.test(key)) return ''
  return key
}

function deriveAccountId(platform, jar) {
  // 优先用真实用户 ID cookie（与 credential-store.ts::deriveAccountId 对齐）
  const uidSource = ACCOUNT_ID_UID[platform] || ''
  if (uidSource && jar[uidSource]) {
    const uid = String(jar[uidSource]).trim()
    if (uid && SHOP_KEY_RE.test(`${platform}_${uid}`)) return uid
  }
  const source = ACCOUNT_ID_FROM[platform] || ''
  let raw = ''
  if (source && jar[source]) {
    raw = String(jar[source])
  } else {
    const keys = KEY_COOKIES[platform] || []
    for (const name of keys) {
      if (jar[name]) {
        raw = String(jar[name])
        break
      }
    }
  }
  if (!raw) return ''
  // 与 credential-store.ts::deriveAccountId 对齐：含非法字符时改用整个值的 MD5 前 32 位，
  // 否则会写入违反 SHOP_KEY_RE 的 key（如知乎 z_c0 的 | :、B站 SESSDATA 的 % , *）
  if (!SHOP_KEY_RE.test(`${platform}_${raw}`)) {
    return crypto.createHash('md5').update(raw).digest('hex').slice(0, 32)
  }
  return raw.slice(0, 64)
}

// 昵称前缀表：与 credential-store.ts::PLATFORM_PREFIX 保持严格一致
const PLATFORM_PREFIX = {
  taobao: 'tb', tmall: 'tb', xianyu: 'xy',
  jd: 'jd', pdd: 'pdd', douyin: 'dy',
  xhs: 'xhs', xiaohongshu: 'xhs',
  bilibili: 'bili', kuaishou: 'ks',
  wechat_mp: 'wx', wechat_store: 'wx',
  zhihu: 'zh',
}

// 与 credential-store.ts::isPseudoNick 保持严格一致：
// 等于 accountId / 等于「前缀 + accountId」/ 含 Cookie 原始值残留字符 → 均非真实昵称
function isPseudoNick(label, platform, accountId) {
  const v = String(label == null ? '' : label).trim()
  if (!v) return true
  if (accountId && v === accountId) return true
  const prefix = PLATFORM_PREFIX[platform] || platform
  if (accountId && v === `${prefix}${accountId}`) return true
  return /[|%:*=,]/.test(v)
}

function resolveNick(platform, label, cookies, accountId) {
  // 优先从 cookie 取真实昵称（与 credential-store.ts::resolveDisplayNick 对齐：需排除伪昵称）
  for (const name of NICK_COOKIES) {
    const v = String(cookies[name] || '').trim()
    if (v && v !== accountId && !isPseudoNick(v, platform, accountId)) {
      return v
    }
  }
  // 回退：已存的 display_label 且非伪昵称
  if (label && !isPseudoNick(label, platform, accountId)) {
    return label
  }
  // 最后回退：平台前缀 + account_id
  const prefix = PLATFORM_PREFIX[platform] || platform
  return `${prefix}${accountId}`
}

async function extractCookies(browser, platform) {
  const domains = DOMAIN_MAP[platform] || []
  const page = await browser.newPage()

  // 导航到对应域名以加载 cookie
  const navUrls = {
    taobao: 'https://www.taobao.com',
    tmall: 'https://www.tmall.com',
    xianyu: 'https://www.goofish.com',
    sycm: 'https://sycm.taobao.com',
    alimama: 'https://www.alimama.com',
    dmp: 'https://dmp.taobao.com',
    sycm_insight: 'https://sycm.taobao.com',
    xiaohongshu: 'https://www.xiaohongshu.com',
    zhihu: 'https://www.zhihu.com',
    douyin: 'https://www.douyin.com',
    bilibili: 'https://www.bilibili.com',
    kuaishou: 'https://www.kuaishou.com',
  }
  const url = navUrls[platform] || 'https://www.baidu.com'

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })
  } catch (e) {
    console.error(`  [${platform}] 导航失败（继续提取 cookie）: ${e.message}`)
  }

  await new Promise(r => setTimeout(r, 2000))

  let cookieList
  if (domains.length > 0) {
    cookieList = await page.cookies(...domains)
  } else {
    cookieList = await page.cookies()
  }

  await page.close()

  return cookieList
}

async function main() {
  const platforms = fs.readdirSync(PROFILES_DIR).filter(f => {
    const p = path.join(PROFILES_DIR, f)
    return fs.statSync(p).isDirectory() && !f.includes('refresh')
  })

  console.error(`发现 ${platforms.length} 个浏览器 Profile: ${platforms.join(', ')}`)

  const accounts = {}

  for (const platform of platforms) {
    const userDataDir = path.join(PROFILES_DIR, platform)
    console.error(`\n处理 ${platform} ...`)

    let browser
    try {
      browser = await puppeteer.launch({
        headless: 'new',
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        userDataDir,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
    } catch (e) {
      console.error(`  启动浏览器失败: ${e.message}`)
      continue
    }

    try {
      const cookieList = await extractCookies(browser, platform)

      // 转为 jar
      const jar = {}
      for (const c of cookieList) {
        // 跳过属性 cookie
        const lower = (c.name || '').toLowerCase()
        if (['path', 'domain', 'expires', 'max-age', 'samesite', 'secure', 'httponly'].includes(lower)) continue
        if (c.name && c.value) {
          jar[c.name] = c.value
        }
      }

      const cookieCount = Object.keys(jar).length
      console.error(`  提取到 ${cookieCount} 个 cookie`)

      if (cookieCount === 0) {
        console.error(`  跳过：无 cookie`)
        await browser.close()
        continue
      }

      // 检查关键 cookie
      const keys = KEY_COOKIES[platform] || []
      const hasKey = keys.length > 0 ? keys.every(k => jar[k]) : cookieCount > 10

      if (!hasKey) {
        console.error(`  关键 cookie 缺失: ${keys.filter(k => !jar[k]).join(', ')}`)
        // 仍然保存，但标记为 expired
      }

      const accountId = deriveAccountId(platform, jar)
      if (!accountId) {
        console.error(`  无法推导 account_id，跳过`)
        await browser.close()
        continue
      }

      const shopKey = makeShopKey(platform, accountId)
      if (!shopKey) {
        console.error(`  shop_key 不合法，跳过`)
        await browser.close()
        continue
      }

      const tbToken = jar['_tb_token_'] || ''
      const csrf = jar['_csrf'] || jar['alimama_csrf_id'] || ''
      const cookieStr = toCookieStr(jar)
      // 第 2 参数是「已存 display_label」，重建场景无旧值，传 undefined
      const nick = resolveNick(platform, undefined, jar, accountId)
      const now = new Date().toISOString()

      accounts[shopKey] = {
        shop_key: shopKey,
        platform: platform,
        credential_platform: platform,
        account_id: accountId,
        display_label: nick,
        cookies: { ...jar },
        cookie_str: cookieStr,
        tb_token: tbToken,
        csrf_id: csrf,
        status: hasKey ? 'valid' : 'expired',
        session_hint: hasKey ? 'ok' : 'expired',
        bound_agent_ids: ['default'],
        account_meta: { display_nick: nick },
        created_at: now,
        last_checked_at: now,
      }

      console.error(`  保存: ${shopKey} (cookies=${cookieCount}, status=${accounts[shopKey].status})`)
    } catch (e) {
      console.error(`  错误: ${e.message}`)
    } finally {
      await browser.close()
    }
  }

  // 写入
  const data = { accounts }
  const tmpPath = ACCOUNTS_FILE + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')

  // 备份旧文件
  if (fs.existsSync(ACCOUNTS_FILE)) {
    const bakPath = ACCOUNTS_FILE.replace('.json', '.corrupt.json')
    fs.copyFileSync(ACCOUNTS_FILE, bakPath)
    console.error(`\n备份损坏文件: ${bakPath}`)
  }

  fs.renameSync(tmpPath, ACCOUNTS_FILE)
  console.error(`\n恢复完成: ${Object.keys(accounts).length} 个账号`)
  console.error(`写入: ${ACCOUNTS_FILE}`)
}

main().catch(e => {
  console.error('致命错误:', e)
  process.exit(1)
})

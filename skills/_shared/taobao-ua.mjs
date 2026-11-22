/**
 * taobao-ua.mjs —— 出站 UA 同源（基座）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么不能用写死的 Chrome 版本（吸收自 gateway-proxy，官方注释原文）
 * ══════════════════════════════════════════════════════════════════
 *   「浏览器路径（puppeteer 启本机 Chrome）已不再覆盖 UA，发的是本机 Chrome
 *     的真实版本；若这里继续写死老的 Chrome/120，同一账号在平台侧就会呈现
 *     『浏览器自称 Chrome 1xx、接口自称 Chrome 120』的**双重人格**，
 *     且 Node 请求本就不带 sec-ch-ua，反而更可疑。」
 *
 * 所以基座直接从本机 Chrome 安装目录读版本号，让两条路径同源。
 * 探测失败回退到固定值，不会比原来更差。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME_MAJOR_FALLBACK = 120
const CHROME_FULL_FALLBACK = '120.0.0.0'

let cachedFull
let cachedMajor

/** 常见 Chrome 安装位置（Windows / macOS / Linux） */
function candidateDirs() {
  const home = os.homedir()
  const list = []
  if (process.platform === 'win32') {
    const bases = [
      process.env['PROGRAMFILES'],
      process.env['PROGRAMFILES(X86)'],
      process.env['LOCALAPPDATA'],
      path.join(home, 'AppData', 'Local'),
    ].filter(Boolean)
    for (const b of bases) {
      list.push(path.join(b, 'Google', 'Chrome', 'Application'))
      list.push(path.join(b, 'Microsoft', 'Edge', 'Application'))
    }
  } else if (process.platform === 'darwin') {
    list.push('/Applications/Google Chrome.app/Contents/MacOS')
    list.push('/Applications/Microsoft Edge.app/Contents/MacOS')
  } else {
    list.push('/usr/bin')
    list.push('/opt/google/chrome')
  }
  return list
}

function detectChromeFull() {
  if (cachedFull !== undefined) return cachedFull
  for (const dir of candidateDirs()) {
    try {
      const versions = fs.readdirSync(dir).filter(d => /^\d+\.\d+\.\d+\.\d+$/.test(d))
      if (versions.length) {
        versions.sort((a, b) => Number(b.split('.')[0]) - Number(a.split('.')[0]))
        cachedFull = versions[0]
        return cachedFull
      }
    } catch { /* 目录不存在继续 */ }
  }
  cachedFull = CHROME_FULL_FALLBACK
  return cachedFull
}

function detectChromeMajor() {
  if (cachedMajor !== undefined) return cachedMajor
  cachedMajor = Number(String(detectChromeFull()).split('.')[0]) || CHROME_MAJOR_FALLBACK
  return cachedMajor
}

/** OS 适配 */
function uaPlatform() {
  if (process.platform === 'darwin') return 'Macintosh; Intel Mac OS X 10_15_7'
  if (process.platform === 'linux') return 'X11; Linux x86_64'
  return 'Windows NT 10.0; Win64; x64'
}

/** 完整 UA（主版本号与本机 Chrome 一致） */
export function desktopUserAgent() {
  return `Mozilla/5.0 (${uaPlatform()}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${detectChromeMajor()}.0.0.0 Safari/537.36`
}

/** 与 UA 配套的 sec-ch-ua 头（真实浏览器都会带，Node 裸请求不带才可疑） */
export function clientHintsHeaders() {
  const major = detectChromeMajor()
  const platform = process.platform === 'darwin' ? '"macOS"' : (process.platform === 'linux' ? '"Linux"' : '"Windows"')
  return {
    'sec-ch-ua': `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not?A_Brand";v="99"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': platform,
  }
}

/** 探到的版本信息（排障 / 自检用） */
export function uaInfo() {
  return {
    userAgent: desktopUserAgent(),
    chromeFull: detectChromeFull(),
    chromeMajor: detectChromeMajor(),
    platform: process.platform,
  }
}

export default { desktopUserAgent, clientHintsHeaders, uaInfo }

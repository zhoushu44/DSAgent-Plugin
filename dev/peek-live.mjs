import puppeteer from 'puppeteer-core'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, readFileSync } from 'node:fs'

const SHOP = 'pdd_mms_df3bfba02288e758351f2dc7a815c843'
const portFile = join(homedir(), '.dsh', 'browser-profiles', 'accounts', SHOP, 'DevToolsActivePort')
if (!existsSync(portFile)) { console.log('no DevToolsActivePort'); process.exit(1) }
const port = readFileSync(portFile, 'utf8').split('\n')[0].trim()
console.log('CDP port:', port)

let b
try {
  b = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null })
} catch (e) {
  console.log('连接失败:', e.message); process.exit(1)
}

const pages = await b.pages()
for (const p of pages) {
  const u = p.url()
  if (!/goods_add/.test(u)) continue
  console.log('\n页面:', u.slice(0, 110))
  const st = await p.evaluate(() => {
    const tables = [...document.querySelectorAll('table')].map(t => ({
      rows: t.querySelectorAll('tr').length,
      heads: [...t.querySelectorAll('th')].map(x => (x.innerText || '').trim()).filter(Boolean),
    }))
    const body = (document.body?.innerText || '').replace(/\s+/g, ' ')
    const err = (body.match(/错误（\d+）[\s\S]{0,200}/) || [''])[0]
    const spec = (body.match(/规格与库存[\s\S]{0,350}/) || [''])[0]
    // 颜色分类区的输入框
    const colorInputs = [...document.querySelectorAll('input')]
      .filter(i => i.offsetParent !== null && /主色|颜色/.test(i.placeholder || ''))
      .map(i => ({ ph: i.placeholder, val: i.value }))
    return { tables, err: err.slice(0, 200), spec: spec.slice(0, 350), colorInputs }
  })
  console.log('表格:', JSON.stringify(st.tables))
  console.log('错误:', st.err || '(无)')
  console.log('规格区:', st.spec || '(无)')
  console.log('颜色输入框:', JSON.stringify(st.colorInputs))
}
await b.disconnect()

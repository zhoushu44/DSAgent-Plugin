import * as fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')

const PROFILE = 'C:/Users/Administrator/.dsh/browser-profiles/accounts/pdd_mms_d3a914fe3bef95f065d9cfd33c23994d'
const portFile = `${PROFILE}/DevToolsActivePort`
if (!fs.existsSync(portFile)) { console.log('浏览器已关'); process.exit(0) }
const port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim()
const b = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null })
const pages = await b.pages()
const p = pages.find(x => x.url().includes('goods_add')) || pages[pages.length - 1]
console.log('URL:', p.url())

const info = await p.evaluate(() => {
  const out = []
  // 找所有 label 含「货号」的字段
  for (const el of document.querySelectorAll('label, [class*="label"], [class*="form-item"]')) {
    const t = (el.innerText || '').trim()
    if (/货号/.test(t) && t.length < 40) {
      // 找关联的 input
      let container = el.closest('[class*="form-item"], [class*="item"]') || el.parentElement
      const inp = container?.querySelector('input')
      if (inp) {
        const r = inp.getBoundingClientRect()
        out.push({
          label: t,
          value: inp.value || '',
          ph: inp.placeholder || '',
          id: inp.id || '',
          w: Math.round(r.width),
        })
      }
    }
  }
  return out
})
console.log(JSON.stringify(info, null, 2))
process.exit(0)

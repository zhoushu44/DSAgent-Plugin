import * as fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')

const PROFILE = 'C:/Users/Administrator/.dsh/browser-profiles/accounts/pdd_mms_d3a914fe3bef95f065d9cfd33c23994d'
const port = fs.readFileSync(`${PROFILE}/DevToolsActivePort`, 'utf8').split('\n')[0].trim()
const b = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null })
const p = (await b.pages()).find(x => x.url().includes('goods_add')) || (await b.pages()).pop()

const info = await p.evaluate(() => {
  // 全文找「货号」出现的所有位置
  const hits = []
  const walk = (node, depth) => {
    if (depth > 8 || !node) return
    for (const el of node.children || []) {
      if (el.children?.length === 0) {
        const t = (el.innerText || '').trim()
        if (/货号/.test(t) && t.length < 60) {
          hits.push({ tag: el.tagName, text: t, cls: String(el.className || '').slice(0, 40) })
        }
      } else {
        walk(el, depth + 1)
      }
    }
  }
  walk(document.body, 0)

  // 属性区里含货号的 box
  const boxes = []
  for (const box of document.querySelectorAll('[id^="basic.propertys."]')) {
    const t = (box.innerText || '')
    if (/货号/.test(t)) {
      boxes.push({
        id: box.id,
        text: t.replace(/\n+/g, ' | ').slice(0, 120),
        inputs: [...box.querySelectorAll('input')].map(i => ({ ph: i.placeholder || '', val: i.value || '', w: Math.round(i.getBoundingClientRect().width) })),
      })
    }
  }
  return { hits: hits.slice(0, 8), boxes }
})
console.log(JSON.stringify(info, null, 2))
process.exit(0)

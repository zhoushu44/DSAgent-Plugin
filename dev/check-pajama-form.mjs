import * as fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/package.json')
const puppeteer = require('puppeteer-core')

const PROFILE = 'C:/Users/Administrator/.dsh/browser-profiles/accounts/pdd_mms_d3a914fe3bef95f065d9cfd33c23994d'
for (const f of ['SingletonLock','SingletonSocket','SingletonCookie','DevToolsActivePort','lockfile']) {
  try { fs.unlinkSync(`${PROFILE}/${f}`) } catch {}
}

const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false, userDataDir: PROFILE, defaultViewport: null,
  args: ['--no-sandbox','--disable-blink-features=AutomationControlled','--start-maximized'],
  ignoreDefaultArgs: ['--enable-automation'], protocolTimeout: 600000,
})
const p = await b.newPage()

console.log('直达睡衣表单页 catId=205133764345')
await p.goto('https://mms.pinduoduo.com/goods/goods_add/index?type=add&from=category&id=205133764345',
  { waitUntil: 'domcontentloaded', timeout: 60000 })

// 分阶段检查
for (const wait of [3000, 5000, 8000]) {
  await new Promise(r => setTimeout(r, wait))
  const st = await p.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')]
    return {
      url: location.href.slice(0, 80),
      fileInputs: inputs.filter(i => i.type === 'file').length,
      carousel: !!document.querySelector('input[data-tracking-click-viewid="carousel_img_localfile_upload"]'),
      detail: !!document.querySelector('input[data-tracking-click-viewid="detail_img_localfile_upload"]'),
      propBoxes: document.querySelectorAll('[id^="basic.propertys."]').length,
      titleInput: !!document.querySelector('input[placeholder*="标题"]'),
      bodyLen: (document.body.innerText || '').length,
    }
  })
  console.log(`+${wait}ms:`, JSON.stringify(st))
  if (st.carousel || st.propBoxes > 0) { console.log('  ✅ 已就绪'); break }
}

await p.screenshot({ path: 'E:/360MoveData/Users/Administrator/Desktop/童装/artifacts/pajama_form.png' })
console.log('截图: pajama_form.png')
await new Promise(r => setTimeout(r, 30000))
process.exit(0)

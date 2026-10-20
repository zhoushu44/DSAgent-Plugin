// 用 pdd_mms Profile 起浏览器，导出 pinduoduo 域完整 Cookie 字符串（用于回写凭证库）
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const PROFILE = 'C:\\Users\\Administrator\\.dsh\\browser-profiles\\pdd_mms';

function findChrome() {
  const cands = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error('no chrome/edge found');
}

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: findChrome(),
    userDataDir: PROFILE,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage();
  const client = await page.target().createCDPSession();
  await page.goto('https://mms.pinduoduo.com/home/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));
  const all = await client.send('Network.getAllCookies').catch(() => ({ cookies: [] }));
  const pdd = (all.cookies || []).filter(c => /pinduoduo|yangkeduo/.test(c.domain));
  // 拼 cookieStr：name=value; name=value
  const cookieStr = pdd.map(c => `${c.name}=${c.value}`).join('; ');
  const out = { url: page.url(), count: pdd.length, names: pdd.map(c => c.name), cookieStr };
  fs.writeFileSync('e:\\360MoveData\\Users\\Administrator\\Desktop\\DSAgent-Plugin\\dev\\tmp-pdd-cookies.json', JSON.stringify(out, null, 2), 'utf8');
  console.log('URL=' + out.url);
  console.log('COUNT=' + out.count);
  console.log('PASS_ID=' + (pdd.find(c => c.name === 'PASS_ID') || {}).value);
  console.log('saved to tmp-pdd-cookies.json');
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });

// 独立探测：用 pdd_mms Profile 起浏览器访问后台，验证存量登录态是否还活着（不扫码）
// 不经过宿主、不占操作锁——临时起一次性浏览器，读完即关
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

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
    headless: false,
    executablePath: findChrome(),
    userDataDir: PROFILE,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--window-size=1200,800'],
  });
  const page = await browser.newPage();
  // 先读当前登录态 Cookie
  const client = await page.target().createCDPSession();
  await page.goto('https://mms.pinduoduo.com/home/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => console.log('goto err:', e.message));
  await new Promise(r => setTimeout(r, 4000));
  const finalUrl = page.url();
  const cookies = await client.send('Network.getAllCookies').catch(() => ({ cookies: [] }));
  const names = (cookies.cookies || []).filter(c => /pinduoduo|yangkeduo/.test(c.domain)).map(c => c.name);
  const hasPassId = names.includes('PASS_ID');
  console.log('FINAL_URL=' + finalUrl);
  console.log('PDD_COOKIES=' + names.join(','));
  console.log('HAS_PASS_ID=' + hasPassId);
  console.log('ON_LOGIN_PAGE=' + /\/login/.test(finalUrl));
  console.log('VERDICT=' + ((hasPassId && !/\/login/.test(finalUrl)) ? 'ALIVE（登录态活着，不用扫码）' : 'DEAD（需扫码）'));
  await new Promise(r => setTimeout(r, 1500));
  await browser.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });

# 首次登录拼多多商家后台：弹可见浏览器扫码，登录态存本机凭证库
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
& node -e "
const { getBrowser, sleep } = require('$here\engine\lib.cjs');
(async () => {
  const b = await getBrowser({ profileDir: process.env.USERPROFILE + '\.dsh\browser-profiles\accounts\pdd_default', headless: false });
  const page = await b.newPage();
  await page.goto('https://mms.pinduoduo.com/login', { waitUntil: 'domcontentloaded' });
  console.log('请在弹出的窗口里用拼多多商家 App 扫码登录。登录成功（进入商家后台）后按回车关闭。');
  for (;;) { await sleep(3000); const ok = await page.evaluate(() => !/login/.test(location.href)).catch(() => false); if (ok) { console.log('登录态已保存 ✓'); break; } }
  await page.close(); b.disconnect();
})();
"
pause

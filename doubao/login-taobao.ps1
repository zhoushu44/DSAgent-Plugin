# 首次登录淘宝：弹可见浏览器扫码，登录态存本机 profile
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
& node -e "
const { getBrowser, sleep } = require('$here\engine\lib.cjs');
(async () => {
  const b = await getBrowser({ profileDir: '$env:USERPROFILE\.dsh\browser-profiles\accounts\taobao_default', headless: false });
  const page = await b.newPage();
  await page.goto('https://login.taobao.com/member/login.jhtml', { waitUntil: 'domcontentloaded' });
  console.log('请在弹出的窗口里扫码登录淘宝。登录成功（跳到淘宝首页）后按回车关闭。');
  for (;;) { await sleep(3000); const ok = await page.evaluate(() => !/login/.test(location.hostname + location.pathname)).catch(() => false); if (ok) { console.log('登录态已保存 ✓'); break; } }
  await page.close(); b.disconnect();
})();
"
pause

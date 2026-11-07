import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const PLUGIN='E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin';
const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href);
const PROFILE=path.join(os.homedir(),'.dsh','browser-profiles','accounts','pdd_mms_4420074eaa258a49b1fedbf198b7b5f9');
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,userDataDir:PROFILE,defaultViewport:null,args:['--no-sandbox','--start-maximized','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding'],ignoreDefaultArgs:['--enable-automation'],protocolTimeout:300000});
const p=(await b.pages())[0]||await b.newPage();
await p.goto('https://mms.pinduoduo.com/',{waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});
await new Promise(r=>setTimeout(r,7000));
// 取 cookie
const cks=await p.cookies('https://mms.pinduoduo.com');
const cookieStr=cks.map(c=>`${c.name}=${c.value}`).join('; ');
console.log('cookie数:',cks.length,'长度:',cookieStr.length);

// ★ Node 直接 fetch（不走页面）
const t0=Date.now();
try{
  const resp=await fetch('https://mms.pinduoduo.com/glide/v2/mms/query/spec/name/list',{
    method:'POST',
    headers:{'content-type':'application/json','cookie':cookieStr,'origin':'https://mms.pinduoduo.com','referer':'https://mms.pinduoduo.com/goods/goods_list','user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'},
    body:JSON.stringify({cat_id:16675}),
    signal: AbortSignal.timeout(30000),
  });
  const j=await resp.json();
  console.log(`✅ Node fetch 成功! 耗时 ${Date.now()-t0}ms | status=${resp.status}`);
  console.log('结果:', j.success ? `spec数=${(j.result||[]).length}` : j.error_msg);
}catch(e){
  console.log('❌ Node fetch 失败:', e.message.slice(0,100));
}
await new Promise(r=>setTimeout(r,2000));
await b.close().catch(()=>{});

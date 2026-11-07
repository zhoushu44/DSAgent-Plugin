import path from 'node:path'; import os from 'node:os';
import { pathToFileURL } from 'node:url';
const PLUGIN='E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin';
const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href);
for(const key of ['pdd_mms_2b1bca962e5fba5172e3edc19a09e406','pdd_mms_c63ee85714b0427055d390e4559b4c57']){
  const PROFILE=path.join(os.homedir(),'.dsh','browser-profiles','accounts',key);
  let b=null;
  try{
    b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',userDataDir:PROFILE,args:['--no-sandbox'],ignoreDefaultArgs:['--enable-automation'],protocolTimeout:60000});
    const p=(await b.pages())[0]||await b.newPage();
    await p.goto('https://mms.pinduoduo.com/goods/goods_list',{waitUntil:'domcontentloaded',timeout:45000}).catch(()=>{});
    await new Promise(r=>setTimeout(r,9000));
    const ok=!/login/.test(p.url());
    const cks=await p.cookies('https://mms.pinduoduo.com').catch(()=>[]);
    console.log(`${key.slice(8,16)} → ${ok?'✅ 有效':'❌ 登录页'} | cookie ${cks.length}个 | ${p.url().slice(0,60)}`);
  }catch(e){ console.log(`${key.slice(8,16)} → ERR ${e.message.slice(0,50)}`); }
  finally{ if(b) await b.close().catch(()=>{}); }
  await new Promise(r=>setTimeout(r,3000));
}

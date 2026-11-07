import path from 'node:path'; import os from 'node:os';
import { pathToFileURL } from 'node:url';
const PLUGIN='E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin';
const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href);
const PROFILE=path.join(os.homedir(),'.dsh','browser-profiles','accounts','pdd_mms_4420074eaa258a49b1fedbf198b7b5f9');
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,userDataDir:PROFILE,defaultViewport:null,args:['--no-sandbox','--start-maximized'],ignoreDefaultArgs:['--enable-automation'],protocolTimeout:300000});
const p=(await b.pages())[0]||await b.newPage();
await p.goto('https://mms.pinduoduo.com/goods/goods_list',{waitUntil:'domcontentloaded',timeout:90000}).catch(()=>{});
await new Promise(r=>setTimeout(r,15000));
console.log('URL:',p.url());
const cks=await p.cookies('https://mms.pinduoduo.com');
const ckStr=cks.map(c=>`${c.name}=${c.value}`).join('; ');
// 用 Node 查这些 goods_id 是否存在
const ids=['1025450780832','1025462371503','1025846514486','1026312995086','1026321720727','1026511479126','1026569086908','1026569940637','1026574634568'];
for(const gid of ids){
  try{
    const resp=await fetch('https://mms.pinduoduo.com/glide/v2/mms/query/commit/on_shop/detail',{
      method:'POST',headers:{'content-type':'application/json','cookie':ckStr,'origin':'https://mms.pinduoduo.com','referer':'https://mms.pinduoduo.com/goods/goods_list'},
      body:JSON.stringify({goods_id:Number(gid)}),signal:AbortSignal.timeout(20000)});
    const j=await resp.json();
    if(j.success){
      const d=j.result;
      console.log(`${gid} | ✅ 存在 | ${(d.goods_name||'').slice(0,24)} | is_onsale=${d.is_onsale} | status=${d.status||'?'}`);
    } else {
      console.log(`${gid} | ❌ ${j.error_msg}`);
    }
  }catch(e){ console.log(`${gid} | ERR ${e.message.slice(0,40)}`); }
  await new Promise(r=>setTimeout(r,2500));
}
await new Promise(r=>setTimeout(r,2000));
await b.close().catch(()=>{});

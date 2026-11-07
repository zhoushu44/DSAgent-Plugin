import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const PLUGIN='E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin';
const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href);
const PROFILE=path.join(os.homedir(),'.dsh','browser-profiles','accounts','pdd_mms_4420074eaa258a49b1fedbf198b7b5f9');
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,userDataDir:PROFILE,defaultViewport:null,args:['--no-sandbox','--start-maximized'],ignoreDefaultArgs:['--enable-automation'],protocolTimeout:300000});
const p=(await b.pages())[0]||await b.newPage();

// 监听所有请求，看哪个卡住
const pending=new Set();
p.on('request',r=>{ pending.add(r.url()); });
p.on('requestfinished',r=>{ pending.delete(r.url()); });
p.on('requestfailed',r=>{ pending.delete(r.url()); });

// 打开草稿页（用上一步 action/edit 成功但未提交的草稿）
const t0=Date.now();
await p.goto('https://mms.pinduoduo.com/goods/goods_add/index?id=205624876942&goods_id=1026511479126',{waitUntil:'domcontentloaded',timeout:90000}).catch(e=>console.log('goto err:',e.message.slice(0,50)));

for(let i=0;i<20;i++){
  await new Promise(r=>setTimeout(r,5000));
  const st=await p.evaluate(()=>{
    const t=document.body.innerText||'';
    return {
      len:t.length,
      loading:/加载中/.test(t),
      hasSave:!![...document.querySelectorAll('button')].find(e=>/保存草稿/.test(e.innerText||'')),
      btns:[...document.querySelectorAll('button')].map(e=>(e.innerText||'').replace(/\s+/g,'').trim()).filter(Boolean).slice(0,10),
    };
  }).catch(e=>({err:e.message.slice(0,40)}));
  console.log(`[${(Date.now()-t0)/1000|0}s] len=${st.len} loading=${st.loading} save=${st.hasSave} btns=${JSON.stringify(st.btns)}`);
  if(st.hasSave && !st.loading) { console.log('★ 按钮出现了'); break; }
}
console.log('未完成请求数:', pending.size);
console.log('未完成的前10个:');
[...pending].slice(0,10).forEach(u=>console.log('  ',u.split('?')[0]));
await p.screenshot({path:'artifacts/load-debug.png',fullPage:true}).catch(()=>{});
await new Promise(r=>setTimeout(r,3000));
await b.close().catch(()=>{});

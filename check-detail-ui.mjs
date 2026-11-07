import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const PLUGIN='E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin';
const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href);
const PROFILE=path.join(os.homedir(),'.dsh','browser-profiles','accounts','pdd_mms_4420074eaa258a49b1fedbf198b7b5f9');
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,userDataDir:PROFILE,defaultViewport:null,args:['--no-sandbox','--start-maximized'],ignoreDefaultArgs:['--enable-automation'],protocolTimeout:600000});
const p=(await b.pages())[0]||await b.newPage();
await p.goto('https://mms.pinduoduo.com/goods/goods_add/index?id=205604394902&goods_id=1026397002383',{waitUntil:'domcontentloaded',timeout:90000}).catch(()=>{});
await new Promise(r=>setTimeout(r,22000));
// 读页面上的详情图状态
const st=await p.evaluate(()=>{
  const t=document.body.innerText||'';
  // 找详情图区域
  const idx=t.indexOf('商品详情');
  const detailCtx = idx>=0 ? t.slice(idx, idx+400).replace(/\s+/g,' ') : '';
  // 统计页面上的图
  const imgs=[...document.querySelectorAll('img')].filter(x=>x.src && x.src.includes('pddpic')).length;
  return {detailCtx, imgCount:imgs, hasError:/错误（\d+）/.test(t), errTxt:(t.match(/错误（\d+）[^\n]{0,150}/)||[''])[0]};
}).catch(e=>({err:e.message.slice(0,60)}));
console.log(JSON.stringify(st,null,1).slice(0,1200));
await p.screenshot({path:'artifacts/detail-check.png',fullPage:true}).catch(()=>{});
console.log('截图 → artifacts/detail-check.png');
await new Promise(r=>setTimeout(r,2000));
await b.close().catch(()=>{});

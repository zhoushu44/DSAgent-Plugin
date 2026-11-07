import path from 'node:path'; import os from 'node:os';
import { pathToFileURL } from 'node:url';
const PLUGIN='E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin';
const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href);
const PROFILE=path.join(os.homedir(),'.dsh','browser-profiles','accounts','pdd_mms_edd349db5a8f8d0cf5efedf20d77c6b6');
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,userDataDir:PROFILE,defaultViewport:null,args:['--no-sandbox','--start-maximized'],ignoreDefaultArgs:['--enable-automation'],protocolTimeout:600000});
const p=(await b.pages())[0]||await b.newPage();
const caps=[];
p.on('request',r=>{ const u=r.url(); if(/file\/create|store_image|get_signature|upload/.test(u)){ caps.push({m:r.method(),u:u.split('?')[0],len:(r.postData()||'').length}); } });
// 打开图片空间页面，手动触发一次上传
await p.goto('https://mms.pinduoduo.com/goods/goods_list',{waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});
await new Promise(r=>setTimeout(r,12000));
// 点「发布新商品」→ 第1步上传图
try{
  const pt=await p.evaluate(()=>{ const e=[...document.querySelectorAll('button,a,div,span')].find(x=>(x.innerText||'').trim()==='发布新商品'); if(!e)return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; });
  if(pt){ await p.mouse.click(pt.x,pt.y); await new Promise(r=>setTimeout(r,8000)); }
  const pages=await b.pages();
  const cat=pages.find(x=>/goods\/category/.test(x.url()))||pages[pages.length-1];
  await cat.bringToFront(); await new Promise(r=>setTimeout(r,6000));
  console.log('第1步:',cat.url().slice(0,80));
  const inputs=await cat.$$('input[type=file]');
  console.log('file inputs:',inputs.length);
  if(inputs.length){
    await inputs[0].uploadFile('E:/360MoveData/Users/Administrator/Desktop/童装/14oz主图_5款/D1_雪域哑光·双层中空_1024.png');
    console.log('已触发上传，等 20s…');
    await new Promise(r=>setTimeout(r,20000));
  }
}catch(e){ console.log('操作失败:',e.message.slice(0,80)); }
console.log('=== 抓到的上传相关请求 ===');
caps.forEach(c=>console.log(`  ${c.m} ${c.u} (${c.len}B)`));
await new Promise(r=>setTimeout(r,2000));
await b.close().catch(()=>{});

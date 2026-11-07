import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const PLUGIN='E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin';
const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href);
const PROFILE=path.join(os.homedir(),'.dsh','browser-profiles','accounts','pdd_mms_4420074eaa258a49b1fedbf198b7b5f9');
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,userDataDir:PROFILE,defaultViewport:null,args:['--no-sandbox','--start-maximized'],ignoreDefaultArgs:['--enable-automation'],protocolTimeout:600000});
const p=(await b.pages())[0]||await b.newPage();
const caps=[];
p.on('request',(r)=>{ if(/goodsCommit\/action\/edit/.test(r.url())&&r.method()==='POST'){ try{const bd=r.postData(); if(bd&&bd.length>1000) caps.push(bd);}catch{} } });
// 已成功上架的商品编辑页
await p.goto('https://mms.pinduoduo.com/goods/goods_add/index?goods_id=1026321720727&type=edit',{waitUntil:'domcontentloaded',timeout:90000}).catch(()=>{});
await new Promise(r=>setTimeout(r,25000));
for(let i=0;i<15;i++){
  const busy=await p.evaluate(()=>/加载中/.test(document.body.innerText||'')).catch(()=>false);
  if(!busy){ console.log('就绪',i*5,'s'); break; }
  await new Promise(r=>setTimeout(r,5000));
}
await new Promise(r=>setTimeout(r,3000));
// 找保存草稿按钮（多种文案）
const btn=await p.evaluate(()=>{
  const cands=[...document.querySelectorAll('button')].map(e=>({t:(e.innerText||'').replace(/\s+/g,''),e})).filter(o=>/保存草稿|存草稿/.test(o.t));
  if(!cands.length) return {found:false, allBtns:[...document.querySelectorAll('button')].map(e=>(e.innerText||'').trim()).filter(Boolean).slice(0,20)};
  const el=cands[0].e; el.scrollIntoView({block:'center'});
  const r=el.getBoundingClientRect();
  return {found:true,x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
});
console.log('按钮:',JSON.stringify(btn));
if(btn.found){ await p.mouse.click(btn.x,btn.y); await new Promise(r=>setTimeout(r,18000)); }
console.log('抓到:',caps.length);
if(caps.length){
  fs.writeFileSync('artifacts/edit-success-body.json',caps[caps.length-1]);
  const j=JSON.parse(caps[caps.length-1]);
  console.log('=== detail_gallery ===');
  console.log(JSON.stringify(j.detail_gallery,null,1).slice(0,1500));
}
await new Promise(r=>setTimeout(r,2000));
await b.close().catch(()=>{});

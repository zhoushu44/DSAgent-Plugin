import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const PLUGIN='E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin';
const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href);
const PROFILE=path.join(os.homedir(),'.dsh','browser-profiles','accounts','pdd_mms_4420074eaa258a49b1fedbf198b7b5f9');
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,userDataDir:PROFILE,defaultViewport:null,args:['--no-sandbox','--start-maximized'],ignoreDefaultArgs:['--enable-automation'],protocolTimeout:600000});
const p=(await b.pages())[0]||await b.newPage();
const caps=[];
p.on('request',(r)=>{ if(/goodsCommit\/action\/edit/.test(r.url())&&r.method()==='POST'){ try{const bd=r.postData(); if(bd&&bd.length>1000) caps.push(bd);}catch{} } });
// 用当前草稿（已 action/edit 成功、卡在 submit 的）
await p.goto('https://mms.pinduoduo.com/goods/goods_add/index?id=205604394902&goods_id=1026397002383',{waitUntil:'domcontentloaded',timeout:90000}).catch(()=>{});
await new Promise(r=>setTimeout(r,22000));
// 填参考价
await p.evaluate((rp)=>{
  let inp=[...document.querySelectorAll('input')].find(e=>/参考价/.test(e.placeholder||''));
  if(!inp) return;
  const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
  inp.focus(); if(s) s.call(inp,String(rp)); else inp.value=String(rp);
  inp.dispatchEvent(new Event('input',{bubbles:true}));
  inp.dispatchEvent(new Event('change',{bubbles:true}));
  inp.dispatchEvent(new Event('blur',{bubbles:true}));
},199.9).catch(()=>{});
await new Promise(r=>setTimeout(r,2000));
// 点提交
const btn=await p.evaluate(()=>{ const x=[...document.querySelectorAll('button')].find(e=>/提交并上架/.test(e.innerText||'')); if(!x)return null; x.scrollIntoView({block:'center'}); const r=x.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; });
console.log('按钮:',JSON.stringify(btn));
if(btn){ await p.mouse.click(btn.x,btn.y); await new Promise(r=>setTimeout(r,20000)); }
console.log('URL:',p.url());
if(caps.length){
  fs.writeFileSync('artifacts/native-success-body.json',caps[caps.length-1]);
  const j=JSON.parse(caps[caps.length-1]);
  console.log('=== 页面成功提交的详情图字段 ===');
  for(const k of Object.keys(j)){ if(/detail|desc|decorat/i.test(k)){ const v=j[k]; console.log(`  ${k} = ${Array.isArray(v)?'['+v.length+']':(v===null?'null':String(v).slice(0,60))}`); } }
}
await new Promise(r=>setTimeout(r,2000));
await b.close().catch(()=>{});

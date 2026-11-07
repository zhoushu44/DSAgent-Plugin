import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const PLUGIN='E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin';
const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href);
const PROFILE=path.join(os.homedir(),'.dsh','browser-profiles','accounts','pdd_mms_4420074eaa258a49b1fedbf198b7b5f9');
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,userDataDir:PROFILE,defaultViewport:null,args:['--no-sandbox','--start-maximized'],ignoreDefaultArgs:['--enable-automation'],protocolTimeout:600000});
const p=(await b.pages())[0]||await b.newPage();

// ★ 抓页面点提交时的 commit/submit 请求体
const caps=[];
p.on('request',(r)=>{
  if(/commit\/submit/.test(r.url())&&r.method()==='POST'){ try{const bd=r.postData(); if(bd) caps.push({url:r.url(),body:bd}); }catch{} }
});
// 打开草稿页
await p.goto('https://mms.pinduoduo.com/goods/goods_add/index?id=205630056508&goods_id=1026542766111',{waitUntil:'domcontentloaded',timeout:90000}).catch(()=>{});
await new Promise(r=>setTimeout(r,22000));
for(let i=0;i<12;i++){ const busy=await p.evaluate(()=>/加载中/.test(document.body.innerText||'')).catch(()=>false); if(!busy) break; await new Promise(r=>setTimeout(r,5000)); }
await new Promise(r=>setTimeout(r,3000));
// 填参考价
await p.evaluate((rp)=>{ const i=[...document.querySelectorAll('input')].find(e=>/参考价/.test(e.placeholder||'')); if(!i)return; const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set; i.focus(); if(s)s.call(i,String(rp)); else i.value=String(rp); i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true})); i.dispatchEvent(new Event('blur',{bubbles:true})); },199.9).catch(()=>{});
await new Promise(r=>setTimeout(r,2000));
// 点提交
const btn=await p.evaluate(()=>{ const x=[...document.querySelectorAll('button')].find(e=>/提交并上架/.test(e.innerText||'')); if(!x)return null; x.scrollIntoView({block:'center'}); const r=x.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; });
console.log('按钮:',JSON.stringify(btn));
if(btn){ await p.mouse.click(btn.x,btn.y); await new Promise(r=>setTimeout(r,25000)); }
console.log('URL:',p.url());
console.log('抓到 commit/submit:',caps.length);
if(caps.length){
  console.log('=== 页面提交参数 ===');
  console.log(caps[caps.length-1].body);
  fs.writeFileSync('artifacts/submit-params.json',caps[caps.length-1].body);
}
await new Promise(r=>setTimeout(r,2000));
await b.close().catch(()=>{});

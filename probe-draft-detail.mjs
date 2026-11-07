import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const PLUGIN='E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin';
const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href);
const PROFILE=path.join(os.homedir(),'.dsh','browser-profiles','accounts','pdd_mms_4420074eaa258a49b1fedbf198b7b5f9');
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,userDataDir:PROFILE,defaultViewport:null,args:['--no-sandbox','--start-maximized'],ignoreDefaultArgs:['--enable-automation'],protocolTimeout:300000});
const p=(await b.pages())[0]||await b.newPage();
let cap=null;
p.on('response',async r=>{ if(/commit\/detail/.test(r.url())){ try{const t=await r.text(); if(t.length>3000) cap=t; }catch{} } });
// 打开一个失败的草稿页
await p.goto('https://mms.pinduoduo.com/goods/goods_add/index?id=205604394902&goods_id=1026397002383',{waitUntil:'domcontentloaded',timeout:90000}).catch(()=>{});
await new Promise(r=>setTimeout(r,22000));
if(cap){
  fs.writeFileSync('artifacts/draft-detail-full.json',cap);
  const d=JSON.parse(cap).result||JSON.parse(cap);
  console.log('=== 字段数:',Object.keys(d).length,'===');
  console.log('=== detail/desc/decorat/gallery 相关 ===');
  for(const k of Object.keys(d)){ if(/detail|desc|decorat|gallery/i.test(k)){ const v=d[k]; console.log(`  ${k} = ${Array.isArray(v)?'array['+v.length+']':(v===null?'null':typeof v==='object'?'obj':String(v).slice(0,40))}`); } }
} else console.log('未抓到');
await new Promise(r=>setTimeout(r,2000));
await b.close().catch(()=>{});

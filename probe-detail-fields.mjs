import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const PLUGIN='E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin';
const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href);
const PROFILE=path.join(os.homedir(),'.dsh','browser-profiles','accounts','pdd_mms_4420074eaa258a49b1fedbf198b7b5f9');
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,userDataDir:PROFILE,defaultViewport:null,args:['--no-sandbox','--start-maximized'],ignoreDefaultArgs:['--enable-automation'],protocolTimeout:300000});
const p=(await b.pages())[0]||await b.newPage();
await p.goto('https://mms.pinduoduo.com/',{waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});
await new Promise(r=>setTimeout(r,9000));
const r=await p.evaluate(async()=>{
  // 源商品 commit/detail 看所有字段名
  const resp=await fetch('https://mms.pinduoduo.com/glide/v2/mms/query/commit/detail',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({goods_id:1026321720727}),credentials:'include'});
  const j=await resp.json();
  if(!j.success) return {err:j.error_msg, ec:j.error_code};
  const d=j.result;
  const keys=Object.keys(d);
  const detail=[];
  for(const k of keys){ if(/detail|desc|decorat|gallery/i.test(k)){ const v=d[k]; detail.push({k, type:Array.isArray(v)?'array['+v.length+']':(v===null?'null':typeof v)}); } }
  return {total:keys.length, detailFields:detail};
});
console.log(JSON.stringify(r,null,1));
await new Promise(r=>setTimeout(r,2000));
await b.close().catch(()=>{});

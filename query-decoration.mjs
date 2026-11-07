import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const PLUGIN='E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin';
const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href);
const PROFILE=path.join(os.homedir(),'.dsh','browser-profiles','accounts','pdd_mms_4420074eaa258a49b1fedbf198b7b5f9');
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,userDataDir:PROFILE,defaultViewport:null,args:['--no-sandbox','--start-maximized'],ignoreDefaultArgs:['--enable-automation'],protocolTimeout:300000});
const p=(await b.pages())[0]||await b.newPage();
await p.goto('https://mms.pinduoduo.com/',{waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});
await new Promise(r=>setTimeout(r,9000));
const gid=1026542766111, cid=205630056508;
// 查装修是否保存成功
const r=await p.evaluate(async(g,c)=>{
  const out={};
  // query decoration
  try{
    const resp=await fetch('https://mms.pinduoduo.com/gorse/mms/goods/decoration/commit/query/V2',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({goods_id:g,goods_commit_id:Number(c)}),credentials:'include'});
    const j=await resp.json();
    out.query = j.success ? {floorCount:(j.result?.floor_list||[]).length, keys:Object.keys(j.result||{})} : {err:j.error_msg};
  }catch(e){ out.query={err:String(e).slice(0,60)}; }
  return out;
},gid,cid).catch(e=>({err:e.message.slice(0,50)}));
console.log(JSON.stringify(r,null,1));
await new Promise(r=>setTimeout(r,2000));
await b.close().catch(()=>{});

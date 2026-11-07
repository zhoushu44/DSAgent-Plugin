import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const PLUGIN='E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin';
const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href);
const PROFILE=path.join(os.homedir(),'.dsh','browser-profiles','accounts','pdd_mms_edd349db5a8f8d0cf5efedf20d77c6b6');
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,userDataDir:PROFILE,defaultViewport:null,args:['--no-sandbox','--start-maximized'],ignoreDefaultArgs:['--enable-automation'],protocolTimeout:300000});
const p=(await b.pages())[0]||await b.newPage();
await p.goto('https://mms.pinduoduo.com/goods/goods_list',{waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});
await new Promise(r=>setTimeout(r,12000));
const r=await p.evaluate(async()=>{
  const out={};
  const w=window;
  // 注入 anti
  if(typeof w.getAntiContent!=='function'){
    const wp=w.webpackJsonp;
    if(!Array.isArray(wp)) return {err:'no webpackJsonp'};
    w.sj=function(mid){ for(const ch of wp){ if(!Array.isArray(ch))continue; const t=ch[1]; if(t&&t[mid]){ const m={exports:{}}; const e={}; t[mid](m,e,()=>({})); return m.exports.default||m.exports; } } return {}; };
    w.getAntiContent=function(){ const a=w.sj('fbeZ'); const r=new a(); r.updateServerTime(Date.now()); return r.messagePack(); };
  }
  const anti=()=>String(w.getAntiContent()||'');
  // 1) get_signature
  const s=await fetch('https://mms.pinduoduo.com/galerie/business/get_signature',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','Anti-Content':anti()},body:JSON.stringify({bucket_tag:'mms-material-img'})});
  const sj=await s.json();
  out.signatureLen=(sj?.result?.signature||'').length;
  // 2) store_image - 用一个 1x1 png
  const b64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const bin=atob(b64); const bytes=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  const fd=new FormData(); fd.append('image',new Blob([bytes],{type:'image/png'}),'test.png'); fd.append('upload_sign',String(sj.result.signature));
  const sr=await fetch('https://file.pinduoduo.com/v3/store_image',{method:'POST',body:fd});
  const storeText=await sr.text();
  out.storeRaw=storeText.slice(0,500);
  return out;
});
console.log(JSON.stringify(r,null,1));
await new Promise(r=>setTimeout(r,2000));
await b.close().catch(()=>{});

import path from 'node:path'; import os from 'node:os';
import { pathToFileURL } from 'node:url';
const PLUGIN='E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin';
const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href);
const PROFILE=path.join(os.homedir(),'.dsh','browser-profiles','accounts','pdd_mms_edd349db5a8f8d0cf5efedf20d77c6b6');
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,userDataDir:PROFILE,defaultViewport:null,args:['--no-sandbox','--start-maximized'],ignoreDefaultArgs:['--enable-automation'],protocolTimeout:300000});
const p=(await b.pages())[0]||await b.newPage();
await p.goto('https://mms.pinduoduo.com/goods/goods_list',{waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});
await new Promise(r=>setTimeout(r,12000));
const r=await p.evaluate(async()=>{
  const w=window; const out={};
  if(typeof w.getAntiContent!=='function'){
    const wp=w.webpackJsonp; if(!Array.isArray(wp)) return {err:'no wp'};
    w.sj=function(mid){ for(const ch of wp){ if(!Array.isArray(ch))continue; const t=ch[1]; if(t&&t[mid]){ const m={exports:{}}; const e={}; t[mid](m,e,()=>({})); return m.exports.default||m.exports; } } return {}; };
    w.getAntiContent=function(){ const a=w.sj('fbeZ'); const r=new a(); r.updateServerTime(Date.now()); return r.messagePack(); };
  }
  const anti=()=>String(w.getAntiContent()||'');
  // 传一个真实 png
  const b64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const bin=atob(b64); const bytes=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  const s1=await fetch('https://mms.pinduoduo.com/galerie/business/get_signature',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','Anti-Content':anti()},body:JSON.stringify({bucket_tag:'mms-material-img'})});
  const sj=await s1.json();
  const fd=new FormData(); fd.append('image',new Blob([bytes],{type:'image/png'}),'t.png'); fd.append('upload_sign',String(sj.result.signature));
  const s2=await fetch('https://file.pinduoduo.com/v3/store_image',{method:'POST',body:fd});
  const storeJson=await s2.json();
  out.storeUrl=storeJson.url;
  // ★ 试多种 file/create 参数
  const variants=[
    {n:'A 原始', b:{create_time:Date.now(),extension:'jpeg',name:'t',url:storeJson.url}},
    {n:'B 加pic_operations', b:{create_time:Date.now(),extension:'jpeg',name:'t',url:storeJson.url,pic_operations:[]}},
    {n:'C 加width/height', b:{create_time:Date.now(),extension:'png',name:'t',url:storeJson.url,width:storeJson.width,height:storeJson.height,size:storeJson.size}},
    {n:'D 用cdn url', b:{create_time:Date.now(),extension:'jpeg',name:'t',url:storeJson.url.replace('img.pddpic.com','file.pinduoduo.com')}},
  ];
  out.results=[];
  for(const v of variants){
    const resp=await fetch('https://mms.pinduoduo.com/garner/mms/file/create',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','Anti-Content':anti()},body:JSON.stringify(v.b)});
    const j=await resp.json().catch(()=>({}));
    out.results.push({n:v.n, ok:!!j.result, ec:j.error_code, msg:(j.error_msg||'').slice(0,40)});
    await new Promise(r=>setTimeout(r,3000));
  }
  return out;
});
console.log(JSON.stringify(r,null,1));
await new Promise(r=>setTimeout(r,2000));
await b.close().catch(()=>{});

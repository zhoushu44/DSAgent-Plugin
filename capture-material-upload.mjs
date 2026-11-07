import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const PLUGIN='E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin';
const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href);
const PROFILE=path.join(os.homedir(),'.dsh','browser-profiles','accounts','pdd_mms_edd349db5a8f8d0cf5efedf20d77c6b6');
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,userDataDir:PROFILE,defaultViewport:null,args:['--no-sandbox','--start-maximized'],ignoreDefaultArgs:['--enable-automation'],protocolTimeout:600000});
const p=(await b.pages())[0]||await b.newPage();
const caps=[];
p.on('request',r=>{ const u=r.url(); if(/file\/create|store_image|get_signature|queryFileDetail|uploadImage|garner|galerie/.test(u)){ try{ caps.push({m:r.method(),u:u.split('?')[0],body:(r.postData()||'').slice(0,300)}); }catch{} } });
// ★ 直接用「图片空间」页面，那里有上传按钮
await p.goto('https://mms.pinduoduo.com/material/upload',{waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});
await new Promise(r=>setTimeout(r,15000));
console.log('图片空间页:',p.url().slice(0,70));
const inputs=await p.$$('input[type=file]');
console.log('file inputs:',inputs.length);
if(inputs.length){
  await inputs[0].uploadFile('E:/360MoveData/Users/Administrator/Desktop/童装/14oz主图_5款/D1_雪域哑光·双层中空_1024.png').catch(e=>console.log('upload err:',e.message.slice(0,50)));
  console.log('已触发，等 25s…');
  await new Promise(r=>setTimeout(r,25000));
}
console.log('=== 抓到 ===');
caps.forEach(c=>console.log(`${c.m} ${c.u}\n   body: ${c.body}`));
await new Promise(r=>setTimeout(r,2000));
await b.close().catch(()=>{});

import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const PLUGIN='E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin';
const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href);
const PROFILE=path.join(os.homedir(),'.dsh','browser-profiles','accounts','pdd_mms_4420074eaa258a49b1fedbf198b7b5f9');
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,userDataDir:PROFILE,defaultViewport:null,args:['--no-sandbox','--start-maximized'],ignoreDefaultArgs:['--enable-automation'],protocolTimeout:300000});
const p=(await b.pages())[0]||await b.newPage();
await p.goto('https://mms.pinduoduo.com/',{waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});
await new Promise(r=>setTimeout(r,9000));

// 用刚才的失败草稿
const gid=1026542766111, cid=205630056508;
// 从原生body取详情图URLs
const native=JSON.parse(fs.readFileSync('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/artifacts/pdd-native-props/cat16675_pdd_mms_4420074eaa258a49b1fedbf198b7b5f9_native-body.json','utf8'));
const urls=[];
for(const f of (native.decorationDetail||[])){
  for(const c of (f.content_list||[])){ if(c.img_url) urls.push(c.img_url); }
}
console.log('详情图URL数:',urls.length);

// 几种可能的参数形态逐个试
const variants=[
  {name:'A: goods_commit_id+detail_gallery', body:{goods_commit_id:Number(cid),goods_id:gid,detail_gallery:urls.map(u=>({url:u,file_type:'pic'}))}},
  {name:'B: 只 goods_commit_id+urls', body:{goods_commit_id:Number(cid),goods_id:gid,detail_gallery:urls}},
  {name:'C: commit_id+images', body:{goods_commit_id:Number(cid),goods_id:gid,images:urls}},
];
for(const v of variants){
  const r=await p.evaluate(async(bd)=>{
    try{
      const resp=await fetch('https://mms.pinduoduo.com/glide/mms/goodsCommit/action/detail_gallery/update',{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(bd),credentials:'include'});
      return {status:resp.status, data:await resp.json()};
    }catch(e){ return {err:String(e).slice(0,80)} }
  },v.body).catch(e=>({err:e.message.slice(0,60)}));
  console.log(`  ${v.name} →`, JSON.stringify(r.data||r).slice(0,200));
  await new Promise(r=>setTimeout(r,4000));
}
await new Promise(r=>setTimeout(r,2000));
await b.close().catch(()=>{});

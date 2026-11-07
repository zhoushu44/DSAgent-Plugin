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
const native=JSON.parse(fs.readFileSync('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/artifacts/pdd-native-props/cat16675_pdd_mms_4420074eaa258a49b1fedbf198b7b5f9_native-body.json','utf8'));
const floors=native.decorationDetail||[];
console.log('楼层数:',floors.length);

const variants=[
  {n:'A floor_list', body:{goods_id:gid,goods_commit_id:Number(cid),floor_list:floors}},
  {n:'B decoration_detail', body:{goods_id:gid,goods_commit_id:Number(cid),decoration_detail:floors}},
];
for(const v of variants){
  const r=await p.evaluate(async(bd)=>{
    try{ const resp=await fetch('https://mms.pinduoduo.com/gorse/mms/goods/decoration/commit/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(bd),credentials:'include'});
      const t=await resp.text(); let j=null; try{j=JSON.parse(t)}catch{}; return {status:resp.status, data:j||t.slice(0,150)}; }
    catch(e){ return {err:String(e).slice(0,80)} }
  },v.body).catch(e=>({err:e.message.slice(0,50)}));
  console.log(`  ${v.n} →`, JSON.stringify(r.data||r).slice(0,200));
  await new Promise(r=>setTimeout(r,4000));
}
await new Promise(r=>setTimeout(r,2000));
await b.close().catch(()=>{});

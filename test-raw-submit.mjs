import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const PLUGIN='E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin';
const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href);
const PROFILE=path.join(os.homedir(),'.dsh','browser-profiles','accounts','pdd_mms_4420074eaa258a49b1fedbf198b7b5f9');
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,userDataDir:PROFILE,defaultViewport:null,args:['--no-sandbox','--start-maximized'],ignoreDefaultArgs:['--enable-automation'],protocolTimeout:300000});
const p=(await b.pages())[0]||await b.newPage();
await p.goto('https://mms.pinduoduo.com/',{waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});
await new Promise(r=>setTimeout(r,9000));

// 读原生 body，原样 submit（不改任何字段）
const native=JSON.parse(fs.readFileSync('E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/artifacts/pdd-native-props/cat16675_pdd_mms_4420074eaa258a49b1fedbf198b7b5f9_native-body.json','utf8'));
const gid=native.goods_id, cid=native.goods_commit_id;
console.log('原生商品:',gid,'commit:',cid,'| decorationDetail:',native.decorationDetail?.length,'楼层');

const r=await p.evaluate(async(g,c)=>{
  const resp=await fetch('https://mms.pinduoduo.com/glide/v2/mms/edit/commit/submit',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({goods_commit_id:Number(c),goods_id:g,is_onsale:1,if_allow_submit_mall_checking:true}),
    credentials:'include'});
  return await resp.json();
},gid,cid);
console.log('submit 结果:',JSON.stringify(r).slice(0,300));
await new Promise(r=>setTimeout(r,2000));
await b.close().catch(()=>{});

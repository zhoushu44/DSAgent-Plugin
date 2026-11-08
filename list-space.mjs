import path from 'node:path'; import os from 'node:os';
import { pathToFileURL } from 'node:url';
const PLUGIN='E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin';
const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href);
const PROFILE=path.join(os.homedir(),'.dsh','browser-profiles','accounts','pdd_mms_2b1bca962e5fba5172e3edc19a09e406');
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,userDataDir:PROFILE,defaultViewport:null,args:['--no-sandbox','--start-maximized'],ignoreDefaultArgs:['--enable-automation'],protocolTimeout:300000});
const p=(await b.pages())[0]||await b.newPage();
await p.goto('https://mms.pinduoduo.com/goods/goods_list',{waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});
await new Promise(r=>setTimeout(r,12000));
const r=await p.evaluate(async()=>{
  // 读图片空间已有的图（这些都已 file/create 登记过）
  const resp=await fetch('https://mms.pinduoduo.com/garner/mms/file/dir_list',{
    method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({if_query_dir:true,order_by:'create_time desc ',dir_id:0,page:1,page_size:30,file_param:{file_type_desc:''},dir_param:{}})});
  const j=await resp.json();
  if(!j.success) return {err:j.error_msg};
  const list=(j.result?.file_list||j.result?.list||[]);
  return {count:list.length, sample:list.slice(0,8).map(f=>({name:f.name,url:f.url,id:f.id,size:f.size,w:f.width,h:f.height}))};
});
console.log(JSON.stringify(r,null,1).slice(0,1600));
await new Promise(r=>setTimeout(r,2000));
await b.close().catch(()=>{});

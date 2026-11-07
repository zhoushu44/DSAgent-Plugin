import path from 'node:path'; import os from 'node:os';
import { pathToFileURL } from 'node:url';
const PLUGIN='E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin';
const { default: puppeteer } = await import(pathToFileURL(`${PLUGIN}/node_modules/puppeteer-core/lib/cjs/puppeteer/puppeteer-core.js`).href);
const PROFILE=path.join(os.homedir(),'.dsh','browser-profiles','accounts','pdd_mms_edd349db5a8f8d0cf5efedf20d77c6b6');
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,userDataDir:PROFILE,defaultViewport:null,args:['--no-sandbox','--start-maximized'],ignoreDefaultArgs:['--enable-automation'],protocolTimeout:300000});
const p=(await b.pages())[0]||await b.newPage();
await p.goto('https://mms.pinduoduo.com/',{waitUntil:'domcontentloaded',timeout:60000}).catch(()=>{});
await new Promise(r=>setTimeout(r,9000));
const r=await p.evaluate(async()=>{
  // 查图片空间文件列表
  const resp=await fetch('https://mms.pinduoduo.com/garner/mms/file/dir_list',{
    method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({if_query_dir:true,order_by:'create_time desc ',dir_id:0,page:1,page_size:20,file_param:{file_type_desc:''},dir_param:{}})});
  const j=await resp.json();
  if(!j.success) return {err:j.error_msg};
  const files=(j.result?.file_list||j.result?.list||[]).map(f=>({name:f.name,url:f.url,id:f.id}));
  return {count:files.length, files:files.slice(0,10)};
});
console.log(JSON.stringify(r,null,1).slice(0,1500));
await new Promise(r=>setTimeout(r,2000));
await b.close().catch(()=>{});

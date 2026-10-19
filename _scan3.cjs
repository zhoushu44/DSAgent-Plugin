const fs=require('fs'),p=require('path');
const needles=['wares-jdm','fxg.jinritemai','offer-new.1688','sell.publish.tmall','item.upload.taobao','pageHooks','iframeHandler','_publisher'];
function walk(d){for(const f of fs.readdirSync(d,{withFileTypes:true})){if(f.name==='.git'||f.name==='node_modules')continue;const fp=p.join(d,f.name);if(f.isDirectory()){walk(fp);continue;}if(!/\.(md|mjs|cjs|js|ts|json|txt)$/.test(f.name))continue;let t;try{t=fs.readFileSync(fp,'utf8')}catch(e){continue}const hits=needles.filter(n=>t.includes(n));if(hits.length)console.log(fp+' -> '+hits.join(','));}}
walk('.');

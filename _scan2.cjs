const fs=require('fs'),p=require('path');
const needles=['setter','pageHooks','iframeHandler','JSON.stringify 劫持','jsonSetter','fetch 拦截'];
function walk(d){for(const f of fs.readdirSync(d,{withFileTypes:true})){if(f.name==='.git'||f.name==='node_modules')continue;const fp=p.join(d,f.name);if(f.isDirectory()){walk(fp);continue;}if(!/\.(md|mjs|cjs|js|ts|json|txt)$/.test(f.name))continue;let t;try{t=fs.readFileSync(fp,'utf8')}catch(e){continue}for(const n of needles){if(t.includes(n)){console.log(n+' :: '+fp);break;}}}}
walk('.');

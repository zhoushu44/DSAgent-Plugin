const cp=require('child_process');
const out=cp.execSync('git ls-files',{encoding:'utf8'});
const f=out.split('\n').filter(Boolean);
console.log('count',f.length);
console.log(f.slice(0,10).join('\n'));
console.log('--- mqs files');
console.log(f.filter(x=>/mqs/i.test(x)).join('\n'));

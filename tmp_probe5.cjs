const fs=require('fs');
const GM=fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/scripts/_gm.js','utf8');
function show(l,a,b){console.log('===== '+l);console.log(GM.slice(a,b));console.log('');}
show('3325 start',391850,392310);
show('5656 tail / 3325 boundary',394200,395000);
const kws=['devRunFillStep','devFillStep','platformCapability','getPlatformCapability','capability','supports','fieldMap','field_map','schemaMap','adapter','adapterFor','pluginAdapter','hostAdapter','PLATFORM_','platformConfig'];
for(const k of kws){const a=[];let i=-1;while((i=GM.indexOf(k,i+1))!==-1&&a.length<6)a.push(i);console.log(k,'=>',a.join(','));}

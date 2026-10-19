const fs=require('fs');
const GM=fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/scripts/_gm.js','utf8');
function dump(label,a,b){console.log('===== '+label+' ['+a+'..'+b+']');console.log(GM.slice(a,b));console.log('');}
dump('registry+judges',392200,393950);
dump('transformRequestBody',912600,913400);
dump('fillImageData',913400,914500);

const fs=require('fs');
const GM=fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/scripts/_gm.js','utf8');
function show(l,a,b){console.log('===== '+l+' ['+a+'..'+b+']');console.log(GM.slice(a,b));console.log('');}
show('devRunFillStep body',661150,662600);
show('devRunFillStep cont',662600,664000);

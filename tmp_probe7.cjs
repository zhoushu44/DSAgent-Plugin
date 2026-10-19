const fs=require('fs');
const GM=fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/scripts/_gm.js','utf8');
function show(l,a,b){console.log('===== '+l+' ['+a+'..'+b+']');console.log(GM.slice(a,b));console.log('');}
show('startPublish',5160900,5161700);
show('openPublish1',5090300,5091000);
show('openPublish2',5609250,5609700);
show('batchPublish1',2783350,2783700);
show('batchPublish2',5175900,5176300);
show('devRunFillStep',659900,661200);

const fs=require('fs');
const GM=fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/scripts/_gm.js','utf8');
function dump(label,a,b){console.log('===== '+label+' ['+a+'..'+b+']');console.log(GM.slice(a,b));console.log('');}
dump('judgeC_tail',393880,394400);
dump('fillSkuPriceData',914335,916200);
dump('findPriceData',915900,916400);
dump('getOrderedSkuKeyIds',797100,797600);
dump('buildStablePriceDetail',781400,782200);
dump('getPddStockMode',718900,719400);
dump('fillNoSpec',722480,723100);
dump('pddFields',922340,923000);
dump('summarize',664600,664900);

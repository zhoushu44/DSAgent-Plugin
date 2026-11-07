import fs from "node:fs";
const files=["scripts/promo.mjs","scripts/images.mjs"];
const set=new Set();
for(const f of files){const s=fs.readFileSync(f,"utf8");
 const re=/(?:\/mms-gateway\/)?((?:venus|poseidon|reinhardt|ryze|smartTool|traffic|caymanSuggestCard|goodsPromotionQuery|star|gauss|jinks|apollo|pms|charge|mammon|goods)\/[A-Za-z0-9_\/\-]+)/g; let m;
 while((m=re.exec(s))) set.add(m[1]);}
const arr=[...set].sort();
console.log("count",arr.length); console.log(arr.join("\n"));

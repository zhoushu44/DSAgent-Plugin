import fs from "node:fs";
const s=fs.readFileSync("scripts/promo.mjs","utf8");
const re=/["'`]([\w\-\.]+(?:\/[\w\-\.]+){1,6})["'`]/g; let m; const set=new Set();
while((m=re.exec(s))) set.add(m[1]);
const arr=[...set].filter(x=>!x.startsWith("http")&&!x.includes("pddpic")).sort();
console.log(arr.join("\n"));

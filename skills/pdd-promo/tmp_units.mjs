import fs from "node:fs";
const s=fs.readFileSync("scripts/promo.mjs","utf8");
const i=s.indexOf("const units =");
console.log(s.slice(Math.max(0,i-1500),i+1200));

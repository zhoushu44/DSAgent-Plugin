import fs from "node:fs";
const p = "C:/Users/Administrator/.dsh/profiles/desktop/wiki/平台/entities/拼多多签名注入范围（Anti-Content vs crawlerInfo）.md";
let t=fs.readFileSync(p,"utf8");
if(!t.includes("pdd-http 模块路径")){
  t = t.replace(
"**三条硬结论**：",
`**第三组（pdd-http 模块路径，2026-11-04 16:56）**：\`POST /sydney/api/mallDsr/dsrResult\`（两项都命中）
→ \`pdd-http.call()\` 返回 \`ok:true, signed:true, crawlerInfoInBody:true, whitelistHit:'sydney/api/mallDsr/dsrResult'\`，
真实取到 \`descScore/logisticsScore/serviceScore/scoreRegionRank\` 等 DSR 字段。
→ 证明两个标志在真实请求里各自生效、没有互相污染。

**三条硬结论**：`);
  fs.writeFileSync(p,t,"utf8"); console.log("added group C");
} else console.log("exists");

import fs from "node:fs";
const p="C:/Users/Administrator/.dsh/profiles/desktop/wiki/平台/entities/拼多多风控机制与应对.md";
let t=fs.readFileSync(p,"utf8");
const old="**当前唯一权威**：本页的错误码语义表 + 《拼多多签名注入范围（Anti-Content vs crawlerInfo）》的白名单。任何处置决策以这两页为准。";
const neu=`**当前唯一权威**：本页的错误码语义表 + 《拼多多签名注入范围（Anti-Content vs crawlerInfo）》的判据。任何处置决策以这两页为准。

## 已验证的对照实验（2026-11-04）

| 接口 | 条件 | 结果 |
|---|---|---|
| \`/vodka/v2/mms/query/display/mall/goodsList\` | header 带 + body 不塞指纹 + t2 真签名 | ✅ OK，total 1784 |
| 同上 | header/body 都不带（页面内裸 fetch，带 Cookie） | ❌ HTTP 200 但 \`error_code 54001\` |
| \`/sydney/api/mallDsr/dsrResult\` | 两项都命中，走 \`pdd-http\` | ✅ \`signed:true / crawlerInfoInBody:true\`，取到 DSR 字段 |
| 同上 | 连续高频调用 | ⚠️ HTTP 430 网关惩罚（等 100s 后单次重试即恢复） |

→ 最后一条是本轮新增的实感：**HTTP 430 确实是"请求太密"而非登录问题**，等 100 秒就恢复，不要重新登录。`;
if(!t.includes("已验证的对照实验")){ t=t.replace(old,neu); fs.writeFileSync(p,t,"utf8"); console.log("risk page updated"); } else console.log("exists");

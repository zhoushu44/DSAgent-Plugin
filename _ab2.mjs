import fs from "node:fs";
const p = "C:/Users/Administrator/.dsh/profiles/desktop/wiki/平台/entities/拼多多风控代码实现缺陷与修复清单.md";
let t = fs.readFileSync(p,"utf8");
if(!t.includes("A/B 对照实验")){
  t += `

### 34-1-补 · A/B 对照实验（2026-11-04 16:47 补做，冷却解除后）

此前 34-1 只做到「关闭签名 → 54001」，恢复对照被 40002 冷却打断。现补全：

| 组 | header Anti-Content | body crawlerInfo | 签名 | 结果 |
|---|---|---|---|---|
| A 修正后 | 带 | 不塞 | t2 risksdk | **OK / total 1784** |
| B 错误版 | 不带 | 不塞 | 页面裸 fetch（带 Cookie） | **HTTP 200 + error_code 54001** |

→ 修正版逻辑成立；「不在 162 名单就不用签名」被彻底证伪。
→ 附带发现：54001 会以 **HTTP 200** 返回，只判 status 必误判。
`;
  fs.writeFileSync(p,t,"utf8"); console.log("appended A/B record");
} else console.log("already there");

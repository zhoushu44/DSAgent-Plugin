import fs from "node:fs";
const p = "C:/Users/Administrator/.dsh/profiles/desktop/wiki/平台/entities/拼多多签名注入范围（Anti-Content vs crawlerInfo）.md";
let t = fs.readFileSync(p,"utf8");

const OLD = `> 注：我当时只验证到第一步（关闭 → 54001），第二步「恢复」被账号冷却打断，**未完成对照**。所以本页只断言「header 必须带」，不断言「带上就一定通」。\`/vodka/\` \`/glide/\` 的签名强度要求见下一节。`;

const NEW = `#### 完整对照实验（2026-11-04 16:47，账号 d105b9 冷却解除后补做，两条均成功）

同一接口 \`POST /vodka/v2/mms/query/display/mall/goodsList\`，同一账号、同一页面会话：

| 组 | header Anti-Content | body crawlerInfo | 签名强度 | 结果 |
|---|---|---|---|---|
| **A 修正后** | ✅ 带 | ❌ 不塞（不在 162 名单） | t2 真签名（risksdk） | **OK，total=1784，HTTP 200** |
| **B 错误版** | ❌ 不带 | ❌ 不塞 | 页面内裸 fetch | **HTTP 200 但 \`error_code=54001\`「操作太过频繁」** |

**三条硬结论**：
1. **header \`Anti-Content\` 是必需品**，即使接口不在 162 名单里——域名判据说了算。B 组证明：连页面内携带完整 Cookie 的裸 fetch 都会被 54001 拦。
2. **body \`crawlerInfo\` 不是必需品**，A 组没塞照样通——162 名单只决定这个字段。
3. **54001 会藏在 HTTP 200 里**，只判 \`resp.status\` 会误判成成功（这也是本项目"HTTP 200 不是成功"铁律的又一处印证）。

> 所以「能纯 HTTP」的正确判据是三条：①域名在签名域内 → header 必带 ②路径在 162 名单 → body 加指纹 ③该前缀的签名强度够不够（\`/vodka/\` \`/glide/\` 需 t2/t3，t1 简化签名不够）。`;

if(!t.includes(OLD)) throw new Error("anchor not found");
t = t.replace(OLD, NEW);
fs.writeFileSync(p, t, "utf8");
console.log("wiki updated with full A/B evidence");

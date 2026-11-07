import fs from "node:fs";
const p = "C:/Users/Administrator/.dsh/profiles/desktop/wiki/平台/entities/拼多多风控代码实现缺陷与修复清单.md";
let t = fs.readFileSync(p,"utf8");
const anchor = "## ";
// 在文件末尾追加本轮修复记录（若尚无）
if (!t.includes("2026-11-04 签名范围修正")) {
  t += `

---

## 2026-11-04 · 签名范围修正（第 34 轮，新增 3 项）

### 34-1 Anti-Content 与 crawlerInfo 被合并成一个条件（P0，我造成并已修复）

- **位置**：\`skills/_shared/pdd-http.mjs\` L239–241、\`skills/_shared/pdd-client.mjs\` L468–469（修正前）
- **错法**：读 bundle 时只看到 \`isCrawlerInfoRequired\`（162 条路径白名单），据此判定「不在名单 = 不用签名」，把 header \`Anti-Content\` 与 body \`crawlerInfo\` 一起关掉。
- **真相**：平台是**两个独立条件**——
  - 域名正则 \`L(url)\`（Service.cdf406f6@134946）→ 控制 **header Anti-Content**
  - 162 条路径白名单（@159490）→ 只控制 **body crawlerInfo**
- **真机反证**：\`POST /vodka/v2/mms/query/display/mall/goodsList\` 不在 162 名单但域名命中 → 关闭签名后 \`errorCode 54001 (captcha)\`。
- **修法**：新建 \`_shared/pdd-sign-scope.mjs\`，提供 \`signPlan(url) → {headerAnti, bodyCrawlerInfo, whitelistRule}\`；\`pdd-http\` 与 \`pdd-client\` 改为分别取用两个标志。
- **验证**：\`signPlan\` 单测 13/13 通过（含 goodsList=头 true/体 false、submit=头 true/体 true、CDN=全 false）。

### 34-2 补 \`310120000\` 错误码（P1）

- **位置**：\`pdd-error.mjs\` EC_MAP/KIND_MAP/EC_HINT；\`pdd-http.mjs\` ERR 常量 + 403 分支
- **依据**：推广域 \`msfe-9d32834f5061ec2a@529922\`（\`eR = 31012e4\`）与 \`@531800\`（\`403 && 310120000 → location.reload()\`）
- **修法**：映射为 \`reload_required\`，提示语明确「不是登录失效，不要跳登录页」
- **验证**：\`normalize({ec:310120000})\` → \`reload_required\`；5/5 错误码单测通过

### 34-3 9 个 SKILL.md 风控速查同步（P2）

- 补 \`310120000\` 行；把「三条铁律」升为「四条铁律」（新增两个签名条件的区分）；补 \`getRisckInfoError\` 兜底坑
- pdd-publish-http 原先没有速查块，一并补齐
- **验证**：9/9 SKILL.md 均含 \`310120000\` 与「分清两个签名条件」

### 34-4 平台原文里发现的额外事实（已写入知识库）

- \`mms-static.pddpic.com\` 会被平台的 \`(mms|...).+\\.com\` 正则误判命中；平台自己不用 fetch 拉静态资源所以不受影响，我方已显式排除静态域（加固项，非平台行为）。
- 会话失效判据是**响应头 \`checklogin: false\`**，不是只看 body 的 \`errorCode\`。
`;
  fs.writeFileSync(p,t,"utf8");
  console.log("appended round-34 record");
} else console.log("already recorded");

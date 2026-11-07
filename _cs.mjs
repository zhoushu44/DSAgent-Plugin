import fs from "node:fs";
const files = fs.readdirSync("skills").filter(d=>/^pdd/.test(d)).map(d=>`skills/${d}/SKILL.md`).filter(f=>fs.existsSync(f));
const START="<!-- RISK-CHEATSHEET:START（由 dev/inject-risk-cheatsheet.mjs 注入，请勿手改） -->";
const END="<!-- RISK-CHEATSHEET:END -->";
const block = `## ⚠ 风控速查（先读这里再排查）

> 完整机制与历史踩坑记录在**知识库**，遇到风控问题**先查库**：
> \`\`\`
> dsagent_wiki_search(keyword="风控")                                     # 全部风控页
> dsagent_wiki_search(path="平台/entities/拼多多风控机制与应对.md")        # 机制总览
> dsagent_wiki_search(path="平台/entities/拼多多签名注入范围与接口白名单.md") # 该不该带签名
> \`\`\`

### 错误码 → 处置

| 错误码 | failureKind | 含义 | 正确处置 |
|---|---|---|---|
| \`54001\` | \`risk_control\` | 操作太过频繁（风控） | **可自愈**：清旧 token → 提新票 → 重放。失败则人工过一次滑块，通过后有 10 分钟通行证。**不要**重新登录 |
| \`40002\` | \`rate_limit\` | 高频限流（**接口级**） | **不可本地修复**，重试无效、只会延长封禁。等待冷却，或降级（如 search → feed） |
| \`100001\` | \`rate_limit\` | 活动写操作频控（请 2 小时后重试） | **不可本地修复**。等待 2 小时或换时间段 |
| \`43001\` | \`token_expired\` | 会话过期（**不是风控**） | 重新扫码登录。注意凭证库快照可能是旧票，优先用浏览器当前 Cookie |
| \`40001\` | \`token_expired\` | 未登录 | 重新扫码登录 |
| \`310120000\` | \`reload_required\` | **页面上下文失效**（403 专用码） | 官方处置是 \`window.location.reload()\`：重开/刷新页面后重试。**不是登录失效，不要跳登录页** |
| \`40010\` | \`no_permission\` | 无权限 | 可能是账号类型不对（需诚信通/实力商家），或换主店号 |
| \`2000000\` | \`no_permission\` | 账号不适合发布 | 权限问题，换号或到后台查违规记录 |
| \`48143\` | \`api_error\` | 非法请求 | 该接口依赖页面 SDK 的请求上下文，需让页面自己发请求（DOM 触发） |
| \`3000000\` | \`api_error\` | 参数错误或灰度未开放 | 检查入参（日期/页码/queryType 等） |
| HTTP \`430\` | \`rate_limit\` | 网关级频率惩罚（Cookie 有效） | 等 15~30s 重试。**不要**误判成 session_expired |
| \`detached Frame\` / \`Target closed\` | \`risk_control\` | 平台主动关掉页面 | 等 3~5 分钟再试，别连续重试 |

### 四条铁律

1. **不要把 54001 当 token_expired** —— 前者需要过一次滑块，后者才需要重新登录。误判会让用户反复登录，每次登录还刷新一次风控基线。
2. **不要重试 40002** —— 它是接口级持久限流，实测冷却 240s 零请求后仍空。
3. **不要在冷却期内连续调用** —— 拼多多按「累计行为分数」延长封禁，越打越久。
4. **不要给不需要签名的接口加 Anti-Content** —— 平台是**选择性注入**：商家后台只有 162 条前缀白名单内的接口才需要签名（商品发布/上下架在名单内，订单/售后/发货/批量改库存**不在**）。给名单外的接口硬塞签名 = 白送「签名调用频次」这个风控信号。判据见 \`_shared/pdd-sign-scope.mjs\` 的 \`needAntiContent()\`。

### 其他已知坑

- **两个登录态不通用**：\`pdd\`（H5 买家态，\`.yangkeduo.com\`）与 \`pdd_mms\`（商家后台态，\`mms.pinduoduo.com\`）是两套独立账号，各跑一套风控评分。
- **\`Failed to launch the browser process!\`** 大概率是 Profile 被孤儿 Chrome 占用（SingletonLock 残留），不是 Chrome 坏了。清理：\`~/.dsh/pdd-account-locks\` 无关，要杀占用该 Profile 的 chrome 进程 + 删 \`SingletonLock\`。
- **账号级并发**：两个任务同时打同一个号会显著提高被封概率，\`_shared/pdd-risk.mjs\` 的账号锁会拦住，看到「正被其他任务占用」就等等。
- **签名兜底字面量**：平台自己的兜底值是 \`"getRisckInfoError"\`（注意 \`Risck\` 是平台拼写）。带它发请求 = 自报「我拿不到环境指纹」，比不带更可疑。
`;
let changed=0;
for(const f of files){
  let t=fs.readFileSync(f,"utf8");
  const i=t.indexOf(START), j=t.indexOf(END);
  if(i<0||j<0){ console.log("SKIP (no block):",f); continue }
  const next=t.slice(0,i+START.length)+"\n\n"+block+"\n"+END+t.slice(j+END.length);
  if(next!==t){ fs.writeFileSync(f,next,"utf8"); changed++ }
}
console.log("updated",changed,"of",files.length);

import fs from "node:fs";
const p = "C:/Users/Administrator/.dsh/profiles/desktop/wiki/平台/entities/拼多多风控代码实现缺陷与修复清单.md";
let t = fs.readFileSync(p,"utf8");
if(!t.includes("第 35 轮")){
  t += `

---

## 2026-11-04 · 第 35 轮：风控能力横向审计 + 统一闸门

### 35-0 审计方法

静态扫描 7 个 pdd 技能 / 32 个脚本，按 7 个维度统计关键字命中：
账号锁 / 冷却检查 / 账号级节流 / 进程内节流 / 记冷却 / 签名判定 / 54001 自愈。
（关键字匹配，非运行时行为；完整表见《拼多多技能统一风控闸门（pdd-guard）》）

### 35-1 pdd-publish-http 零风控（P0，最严重）

- **位置**：\`publish-v2.mjs\`、\`batch-publish.mjs\`
- **问题**：7 个维度**全为 0**。无账号锁、无冷却检查、无节流、不记冷却。
  而它打的是 \`/glide/\` \`/vodka/\` —— 全平台 Anti-Content 门禁最严的商品发布域，
  上架还是 L2 写操作。
- **修法**：两处入口都改为「开浏览器之前」先过 \`pdd-guard\` 的 \`openTask\`，被拦则直接 emit + exit。
- **验证**：给测试账号设 54001 冷却后跑 \`publish-v2 --confirm true\` →
  返回 \`failureKind: rate_limit\`、\`原因：账号冷却中\`，**未启动浏览器**（日志无「新开浏览器窗口」）。

### 35-2 批量上架 / 矩阵铺货无间隔（P0）

- **位置**：\`batch-publish.mjs\` 主循环、\`matrix.mjs\` 变体循环
- **问题**：每个商品/变体提交完立刻发下一个，无任何 sleep。
  平台侧看就是纯脚本节奏，是批量被风控的主因。
- **修法**：批次内强制间隔 45s（\`--gap\` 可调，\`Math.max(20_000, gap*1000)\` 兜底），
  间隔后复检 \`beforeCall\`，不可用则提前中止本批。
- **验证**：\`--gap\` 解析 4/4 通过（30→30s、=60→60s、无参→45s、5→20s 被抬到下限）。

### 35-3 batch-publish 的 shopKey 硬编码兜底（P0，安全）

- **位置**：\`batch-publish.mjs:29\`（原）\`arg('account', 'pdd_mms_c09a0b4f80ef6a8524cd0f23d53f40f4')\`
- **问题**：不传 \`--account\` 时**批量上架会直接打进别人的店铺**。
  与历史第 N 轮修的「Profile 硬编码兜底」同类，只是这次在 shopKey 这一层。
- **修法**：改为必填，不传直接报错退出，不做任何兜底。
- **验证**：不传参数 → \`缺少 --account（shopKey）…不做默认兜底（防误发到别人店铺）\`。

### 35-4 pdd-chance 进程内节流失效（P0）

- **位置**：\`chance.mjs:254\` \`const lastHit = new Map()\`
- **问题**：每次 \`execute_skill\` 都是新 Node 进程 → Map 归零 → 首个请求立即发出。
  与 \`pdd-http\` 在 2026-10-27 修过的是同一个 bug（当时只修了 pdd-http，没横向排查）。
- **修法**：改用 \`pdd-antiban.reserveSlot\`（落盘 + 先同步占位），进程内 Map 降为兜底。

### 35-5 新增统一闸门 pdd-guard.mjs

- **设计**：准入（冷却/健康分/账号锁）+ beforeCall（节流+签名计划）+ afterCall（归因记账）+ close（放锁）
- **不接管请求**：技能原来的请求方式不变，避免改动 32 个脚本的业务逻辑
- **不写新状态**：复用 pdd-antiban / pdd-risk 的落盘状态，防「第三套状态」
- **fail-open**：依赖缺失时降级为只记录不拦截，打 \`degraded\` 日志
- **验证**：回归 17/17 通过（模块健康 1 + 签名判定 6 + 错误码 6 + 闸门行为 4）；
  节流实测：串行 5 次间隔 **5.1s**、并发 10 次 **10/10 零穿透（跨度 45.9s）**

### 35-6 测试污染教训

第一次测 \`reserveSlot\` 得到「平均间隔 25.4s、首个请求等 81.8s」，误以为是 bug。
实际是**测试账号继承了上一轮的 \`nextAllowedAt\` 时间槽**——
\`clearCooldown()\` **只清 \`cooldownUntil\`，不清 \`nextAllowedAt\`**。
清空该账号 state 后重测即恢复 5.1s。
→ 教训：\`clearCooldown\` 不是「重置账号」，只是「解除冷却」。测节流必须先清时间槽。
`;
  fs.writeFileSync(p,t,"utf8"); console.log("appended round 35");
} else console.log("exists");

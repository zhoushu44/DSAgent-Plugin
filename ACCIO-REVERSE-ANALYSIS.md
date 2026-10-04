# Accio 技能体系逆向分析 · 对 DSAgent-Plugin 的借鉴点

> 分析对象：`D:\软件\Accio`（Electron 应用，v 内含 `resources/app.asar` 115 MB / `_staging` 121 MB）
> 分析方法：自写 ASAR 解析器解包（npm 因沙箱 EPERM 不可用），提取 main 侧 bundle 与 assets 做源码级阅读
> 分析日期：本次会话
> 结论：Accio 与 DSAgent-Plugin 是**同一架构范式**（SKILL.md + 技能市场 + 连接器），但 Accio 在
> **技能质量治理、触发路由、技能自生长**三块有成熟设计，且这三块正是当前插件的空白区。

---

## 0. 一句话结论

DSAgent-Plugin 目前是「**技能仓库**」——技能能被扫到、能被调用、能在市场里开关；
Accio 是「**技能运行时**」——技能会被**校验、评分、按工具调用自动路由、从对话里自动生长、按使用率淘汰**。

差距不在技能数量（你 55 个，Accio 内置 5 个forced + 市场），而在**技能的元数据被当成一等公民**。

---

## 1. 架构对照

| 维度 | Accio | DSAgent-Plugin（现状） | 差距 |
|---|---|---|---|
| 技能载体 | `SKILL.md` + YAML frontmatter | 同 | ✅ 一致 |
| 技能发现 | 递归扫描 `SKILL.md`/`skill.json`/`package.json` | 扫描 `SKILL.md` | ✅ 一致 |
| 技能 ID 生成 | `id` → `name` → 目录名 三级回退；非法字符转 slug + sha256 前 8 位后缀 | 目录名 | ⚠️ Accio 更强 |
| 元数据容错 | YAML 解析失败 → 降级 flat parser，并**明确警告 nested 字段被忽略** | — | ⚠️ 可借鉴 |
| 技能市场 | 13 个能力分类 + 强制安装 + 废弃清理 | 13 能力分类 + 11 平台 | ✅ 你更细（多平台维度） |
| **质量门禁** | **校验 + 0.00~1.00 评分模型** | **无** | ❌ 关键差距 |
| **工具触发路由** | **`tool_triggers` 声明式注册表 + 正则匹配 + 运行时提示注入** | **无** | ❌ 关键差距 |
| **技能自生长** | **SkillHarvest：从对话自动提炼 SKILL.md + 淘汰** | **无** | ❌ 关键差距 |
| 技能补丁 | `SKILL.patch.md` 自动合并到主文档 | 无 | ⚠️ 可借鉴 |
| 渐进披露 | `Paths` 变量 + `<available_skills>` 表 + 按需 read | 技能清单整体进 system prompt | ⚠️ 可借鉴 |
| 使用统计 | `.skill-stats.json`（useCount / lastUsedAt） | 无 | ⚠️ 可借鉴 |
| 风控闭环 | — | ✅ **你有完整 risk_verify 闭环，Accio 未见** | ✅ 你的优势 |

> **重要**：风控验证闭环（`dsagent_risk_verify` + 凭证回收 + 冷却）是你相对 Accio 的**真实优势**，
> Accio 的 bundle 里没有对应的 punish/滑块回收链路。这块不要动，继续强化。

---

## 2. 借鉴点 A：SKILL.md 质量门禁（最高优先级）

### Accio 的做法

`gw-src-BJA2EZJO.js` 里有**两层**机制：先硬校验（不合格直接拒绝写入），再软评分（用于淘汰排序）。

**硬校验规则**（原文错误信息，逐条可复现）：

| 检查 | 阈值 | 错误信息 |
|---|---|---|
| frontmatter 起始 | 首行必须 `---` | `missing closing ---` |
| 必填字段 | `name:` / `description:` 非空 | `frontmatter missing name` / `missing description` |
| 正文长度 | ≥ 200 字符 | `skill body too short (N chars, min 200): must contain at least a ## Workflow section with numbered steps` |
| 必须有 H2 | 至少一个 `## ` | `skill body must contain at least one ## section` |
| **必须有 Workflow 段** | `^## Workflow` | `skill body must contain a ## Workflow section with the proven step-by-step execution path` |
| Workflow 步数 | ≤ 7 步 | `skill Workflow too detailed (N steps, max 7): collapse routine tool calls into higher-level phases` |
| Fallback / Edge Cases | ≤ 3 条 | `Fallback / Edge Cases too detailed (N items, max 3)` |
| Pitfalls | ≤ 3 条 | `Pitfalls too detailed (N items, max 3)` |
| Suggestions | ≤ 3 条 | `Suggestions too detailed (N items, max 3)` |
| **description 长度** | **72 ~ 420 字符** | `frontmatter description too short (N chars, min 72): explain when to use this skill — user intents, triggers, keywords, preconditions, or typical sequence — target ~120–380 characters, not a vague one-liner` |

**软评分模型**（用于淘汰与排序，满分 1.00）：

```js
const W = {
  FRONTMATTER_NAME_SCORE: .15,   // name 非空
  FRONTMATTER_DESC_SCORE: .15,   // description 非空
  BODY_MIN_LENGTH:        200,
  BODY_LENGTH_SCORE:      .15,   // 正文 ≥ 200 字符
  BODY_SECTION_SCORE:     .15,   // 至少一个 ## 
  WORKFLOW_SECTION_SCORE: .20,   // 有 ## Workflow   ← 权重最高
  ERROR_HANDLING_SCORE:   .10,   // 有 ## Pitfall / Fallback / Edge
  PRECONDITION_SCORE:     .10,   // 有 ## Precondition / Verification / Success
};
score = Math.min(sum, 1)
```

### 我对你 55 个技能跑了同一套评分（实测）

结果在 `.tmp-accio/audit-report.txt`，摘录：

```
TOTAL DIRS: 57   NO SKILL.md: 2  (.dsagent, xiaohongshu-analytics)
QUALITY SCORE DISTRIBUTION (Accio rubric, max 1.00)
  1.00       0
  0.85-0.99  0
  0.70-0.84  0
  <0.70      55          ← 全部落在最低档
  average score: 0.600
```

**关键发现**：55 个技能**全部得 0.60**，且**全部被判「missing ## Workflow section」**。

但这**不是因为你没写工作流**——你的技能用的是中文标题：

| 技能 | 你实际的 H2 | Accio 找的 H2 |
|---|---|---|
| `a-stock-diagnosis` | `## 工作流`、`## 错误处理`、`## 限制` | `## Workflow`、`## Pitfalls` |
| `product-reviews` | `## 前置条件`、`## 完整 HTML 报告工作流` | `## Workflow`、`## Precondition` |
| `market-analysis` | `## 前置条件`、`## 直接使用` | 同上 |

**所以真实结论是两条**：

1. **好消息**：你的技能内容结构（前置条件 / 工作流 / 错误处理 / 限制）**已经覆盖了 Accio 要求的槽位**，只是标题是中文。信息密度不输。
2. **坏消息**：Accio 的评分器是**英文正则硬编码**（`/^## Workflow/im`）。任何工具链（包括 Accio 自己）都会把你的技能判为不合格。**你的技能在外面世界是「不可机读」的。**

**另一个真实缺陷**：`description` 有 3 个 < 72 字符（`chat_with_agent` 50、`make_plan` 58、`dws` 68），3 个 > 420 字符（`data-report` 554、`pywencai-stock` 440、`pdd-publish` 421）。而 45/55 落在 120–380 甜区——这块整体是健康的。

### 建议动作

**A1（低成本，立即见效）** —— 给 `skill-service.ts` 加一个 `validateSkill()`，把 Accio 的硬规则**本地化**（接受中英双语标题）：

```ts
// 双语槽位映射：任一命中即算通过
const SLOT = {
  workflow:      /^##\s+(Workflow|工作流|流程|执行流程|主流程)/im,
  errorHandling: /^##\s+(Pitfalls?|Fallback|Edge|错误处理|异常处理|常见错误|降级)/im,
  precondition:  /^##\s+(Preconditions?|Verification|Success|前置条件|验收|校验|成功标准)/im,
};
```

约束：Workflow ≤ 7 步、Fallback/Pitfalls/Suggestions ≤ 3 条、description 72–420 字符。

**A2** —— 把评分跑进技能市场 UI，每张技能卡显示质量分 + 具体缺陷（你已有风险等级徽标位，可并列）。
停用/上架决策从「人肉看」变成「分数驱动」。

**A3** —— `SKILL.md` 的 `description` 是**给模型看的唯一路由依据**（Accio 把它单列 `SECTION_DYNAMIC_SKILL_PREAMBLE`）。
建议给 description 定一条写作规范：`Use when:` 开头 + 用户意图 + 触发词 + 前置条件 + 典型序列，对齐 Accio 的 120–380 字符目标。
你现在 45/55 已达标，把剩下 6 个修掉即可。

---

## 3. 借鉴点 B：`tool_triggers` 声明式触发路由（最有价值的新机制）

这是 Accio 最值得整体搬过来的设计，**你的 24 个工具天然适配**。

### 机制

技能可以在自己的 `SKILL.md` frontmatter 里**声明**：「当某个工具带特定参数被调用时，我应该被提示给模型」。

```yaml
---
name: lark-tools
tool_triggers:
  - tool: mcp_call
    args:
      action: search
      keyword: /lark|feishu|飞书/i      # 支持正则（/pattern/flags）
  - tool: bash
    args:
      command: /accio-mcp-cli\s+(?:keyword|search|find)\b.*(?:lark|feishu|飞书)/i
---
```

### 运行时行为（源码级）

```js
// 解析（scanner.parseToolTriggers）：只接受 tool:string，args 值统一转 string
static parseToolTriggers(e) {
  let t = e.tool_triggers;
  if (!Array.isArray(t)) return [];
  ...
}

// 匹配（ToolTriggerRegistry.match）：按 tool 名分桶，args 逐键比对
match(toolName, callArgs) {
  const rules = this.rules.get(toolName);        // 按 tool 名索引
  if (!rules) return [];
  const hits = [], seen = new Set();
  for (const r of rules)
    if (!seen.has(r.skillName) && (!r.args || matches(r.args, callArgs)))
      hits.push(r), seen.add(r.skillName);        // 每技能只提示一次
  return hits;
}

// args 比对：值为 /regex/flags 形式走正则，否则字符串全等
function matches(expected, actual) {
  for (const [k, v] of Object.entries(expected)) {
    const got = actual[k];
    if (got == null) return false;                // 缺参数 = 不匹配
    const m = v.match(/^\/(.+)\/([gimsuy]*)$/);
    if (m) { if (!new RegExp(m[1], m[2]).test(String(got))) return false; }
    else if (String(got) !== v) return false;
  }
  return true;
}
```

**触发后注入的提示**（`formatHint`）：

```
---
Skill relevant to this operation:
- lark-tools: Use when the user wants to interact with Lark/Feishu — ...

Read the relevant skill file for complete instructions before proceeding:
  <skillPath>
```

### 为什么这对你特别有价值

你当前的路由是：**24 个工具常驻 system prompt + 55 个技能清单整体注入**。这有两个问题：

1. **55 个技能的 description 全量进 prompt** —— 按你 README 的用量数据（单会话 4.3M tok），这是可观的固定成本。Accio 的做法是 `<available_skills>` 只放**路由表**，正文 `read` 时按需加载（渐进披露）。
2. **包一层工具的技能没有触发信号** —— 例如 `dsagent_execute_skill(id="product-reviews")` 和 `dsagent_product_reviews(...)`，
   模型在调用前**不知道** `product-reviews` 技能里有 240s 时间预算、`answers_truncated` 语义、tmall 域要求。这些坑只写在 SKILL.md 里，而 SKILL.md 没被加载。

**`tool_triggers` 正好补这一环**：把「哪个工具 + 什么参数 → 该读哪个技能」变成**声明式数据**，
在工具调用瞬间注入提示，逼模型先读 SKILL.md。

### 建议动作

**B1** —— 在 `skill-service.ts` 加 `parseToolTriggers()`，frontmatter 支持：

```yaml
tool_triggers:
  - tool: dsagent_execute_skill
    args:
      id: /^(product-reviews|product-wdj)$/
  - tool: dsagent_product_reviews
  - tool: dsagent_proxy
    args:
      platform: taobao
      url: /mtop\.taobao\.com/
```

**B2** —— 建 `ToolTriggerRegistry`，在工具执行前的 hook 里 `match(toolName, args)`，
命中则把 `formatHint()` 拼到工具结果或工具描述里。

**B3** —— 把 `dsagent_risk_verify` 做成一条 triggers 规则：
`tool: dsagent_execute_skill, args: {id: ...} ` 命中即提示「本技能可能返回 risk_control，先读风控处置段」。
这直接降低你 FIX-LOG 里 #45–#53 那批风控问题的复发率。

---

## 4. 借鉴点 C：技能自生长与淘汰（SkillHarvest）

### 机制

Accio 会在对话/子代理结束时，用**另一个 LLM 调用**判断「这次交互有没有值得沉淀的经验」，
有则生成新的 `SKILL.md` 落到 `skills-management` 目录，命名带来源标记 `[Harvest]` / `[Harvest-SubAgent]`。

**触发条件**（源码 `maybeRun`）：

```js
if (process.env.PHOENIX_SKILL_HARVEST === `0`) return { triggered: false };
if (messageCount < 5) return { triggered: false, reason: `too few messages` };   // 会话太短不提炼
if (!historyText.trim()) return { triggered: false, reason: `empty history text` };
```

**生成后硬校验**（就是第 2 节那套规则，不合格不许落盘）。

**淘汰模型**（`SkillEviction`）：

```js
const MAX_HARVEST_SKILLS = 50;      // PHOENIX_MAX_HARVEST_SKILLS
const EVICT_BATCH_SIZE   = 5;       // PHOENIX_EVICT_BATCH_SIZE
const MIN_AGE_MS         = 24h;     // 太新的不淘汰

// 综合分 = 0.4×使用频次 + 0.4×新鲜度 + 0.2×文档质量
useCountScore = Math.min(useCount / 50, 1);
recencyScore  = Math.max(0, 1 - ageDays / 180);     // 180 天线性衰减
qualityScore  = <第 2 节的评分模型>;
score = 0.4*useCountScore + 0.4*recencyScore + 0.2*qualityScore;
```

**使用统计**：`.skill-stats.json`

```json
{ "skill-dir-name": { "useCount": 12, "lastUsedAt": 1758000000000 } }
```

**只淘汰自生长的技能**：`filter(e => e.isHarvest && age > 24h)` —— 人工技能永不自动删除。这个边界划得很对。

### 建议动作

**C1** —— 你的技能是「平台连接器 + 业务技能」双轨。**自生长对你的高价值场景不是通用技能，而是「平台坑位记忆」**：
比如淘宝某个接口的反爬特征、某个类目的风控阈值、某个技能的参数组合。这些现在散落在 FIX-LOG 里（#45–#65，21 条），
人的记忆和文档都会漂移，但**从对话自动提炼成 skill 坑位段**可以持续累积。

**C2** —— 引入 `.skill-stats.json` 并使用统计。你的技能市场页可以按「真实使用率」排序，
把 `xiaohongshu-crawl`（上游限制、从未成功）这类排在后面或标记。

**C3** —— **不要照搬自动淘汰**。你的技能是人工精心编写的连接器，误删代价高。
建议只做「使用率统计 + 市场页排序 + 长期未用提醒」，淘汰交给人。

---

## 5. 借鉴点 D：渐进披露与 `SKILL.patch.md`

### 渐进披露

Accio 的 skill system prompt 结构：

```
## Paths
${agent_skills} = /abs/path/to/agent/skills
${plugin_skills} = ...
...
<available_skills>
| skill_id | description | ... |     ← 只有路由表，没有正文
</available_skills>
```

模型用两步发现：
1. `Skill(action: "list", plugin_id)` —— 列出插件下的技能
2. `Skill(action: "read", skill_id)` —— 按需读 SKILL.md 正文

并且**明确写了 fallback**：`skill` 工具不可用时，用通用 `read` 读 `${variable}/<dir>/SKILL.md`。

### `SKILL.patch.md`

技能目录下可放 `SKILL.patch.md`，`Skill` 工具的 `read` 会**自动把它合并到主文档之后**：

> `patch_content`（from SKILL.patch.md），apply it AFTER the main SKILL.md body —
> it contains amendments collected from past sessions.

在子代理场景里，patch 会以 `#### SKILL.patch.md` 形式追加：

```
### ${skillName}
Description: ${desc}

${mainBody}

#### SKILL.patch.md
${patchContent}
```

**设计意图**：主文档是「出厂版本」，patch 是「本地现场修正」，**升级技能时不覆盖用户的现场经验**。

### 建议动作

**D1** —— 你的 `product-reviews` 的 #53（改走 tmall 域）、`product-wdj` 的 #55（240s 时间预算）
这类「现场修正」非常适合放 `SKILL.patch.md`，而不是每次改主文档。好处：
- 上游技能升级时，你的修正不丢
- 修正可追溯、可回滚
- 不同店铺/环境可以有不同 patch

**D2** —— 技能市场页增加「补丁」视图，展示每个技能的 patch 摘要，让现场经验可见、可审。

**D3** —— 渐进披露：把当前整体注入的技能清单改为路由表 + 按需 read。
考虑到你已经踩过沙箱管道（#42/#43/#44），按需 read 还能减少无关技能正文进入上下文。

---

## 6. 借鉴点 E：技能 ID 生成与元数据容错

### ID 三级回退（`scanner`）

```js
function deriveId(explicitId, name, dirPath) {
  if (explicitId) {
    if (/^[a-zA-Z0-9_-]+$/.test(explicitId)) return { id: explicitId, idSource: `explicit` };
    const slug = slugify(explicitId);            // 非字母数字 → '-'
    return { id: slug ? `${slug}-${sha256(explicitId).slice(0,8)}` : `skill-${sha256(...)}` };
  }
  if (name) { /* 同上，idSource: 'derived-from-name' */ }
  const base = basename(dirPath);
  /* 同上，idSource: 'derived-from-dirname' */
}
```

**要点**：中文名/非法字符不会导致技能被跳过，而是 slug 化 + 哈希后缀**保证唯一性**。

### YAML 容错

```js
function parseFrontmatter(text, path, onError) {
  const m = text.match(/^---\r?\n([\s\S]+?)\r?\n---/);
  if (!m) return {};
  try { return YAML.parse(m[1]) ?? {}; }
  catch (e) {
    logger.warn(`YAML frontmatter parse failed for ${path}; falling back to flat parser — `
      + `nested fields (renderers, tools, tool_triggers) will be IGNORED. `
      + `Quote any value starting with "[", "{", "#", or "*", or use | / > block scalars.`);
    return flatParse(m[1]);
  }
}
```

**两条经验**：
1. 解析失败**不丢技能**，降级到 flat parser，但**明确警告哪些嵌套字段被忽略**。
2. 提示了 YAML 的经典坑：以 `[` `{` `#` `*` 开头的值必须加引号。**你的 `description` 里大量使用 `[src: ...]` 这类方括号**，这是高危点。

### 建议动作

**E1** —— 你的 `skill-service.ts` 若用简易正则解析 frontmatter，**必须**处理「值以 `[` 开头」的情况。
你的 `data-report` description 554 字符且含 `[`，`pywencai-stock` 440 字符，实测都在风险区。

**E2** —— 保留 `idSource` 字段并暴露到市场页，排查「为什么这个技能 ID 变了」时非常有用。

---

## 7. 借鉴点 F：Wiki 本体编译（`wiki-skills/merchant-wiki-compiler`）

这是 `_staging/resources/wiki-skills/` 里的独立技能，**不在 asar 里，是明文**，质量很高，值得单独学习。

### 八域本体 Schema

商品 / 店铺 / 客户 / 经营 / 平台 / 资产 / 接待 / **概念**

- **概念域独立成域**，是「各域字段口径的唯一出处」——解决同一指标在不同页面口径漂移。
- **渐进式读取**：`references/schema/_index.md`（Level 1，路由层，每次必读）→ 命中域才读 `schema/{域}.md`（Level 2）。
  > 「**不要一次性读全**」——这条明确写进 SKILL.md 的硬约束，是控制 context 的显式设计。

### 最值得抄的两条硬约束

**① frontmatter 必须经脚本生成，禁止模型直接写**

> `frontmatter.py template` 生成完整锁定模板 → 模型只替换 `null` → `frontmatter.py render` 校验并序列化
> 「模型只填值」——保留模板全部 key 和层级，缺失值保持 `null`，由 `render` 统一清理。

`render` 会拒绝：结构变化、重复 key、Schema 外字段、错误枚举、空必填项、无效 `resource`、
frontmatter 内 `[src]`、title/H1/文件名不一致。

**② 引用与追溯分离**

| 机制 | 位置 | 内容 | 用途 |
|---|---|---|---|
| `resource` | frontmatter 顶层 | `raw/` 起始的**完整相对路径** | 机械校验来源可达 |
| `[src: 文件名#L行号]` | **只在正文** | 文件名 + 行号 | 段落级就近溯源 |

> "`resource` 与 `[src]` 分工明确，不要互相套用"；"frontmatter 字段内不得出现 `[src]`"

### 对 DSAgent-Plugin 的启示

你的插件**没有知识沉淀层**——每次分析完，结论留在对话里，下次从头再来。
`store-patrol-manager` / `competitor-strategy-comparison` 这类技能产出大量结构化结论，
如果按八域模型（至少取 商品/店铺/客户/经营 四域）沉淀成本地 wiki，
「上次巡店的结论」就能成为「这次分析的输入」。

**注意**：这条是**产品级战略选项**，不是即改项。优先级排在第 2、3 节之后。

---

## 8. 其他可借鉴细节（清单）

| # | Accio 做法 | 源码位置 | 对你的价值 |
|---|---|---|---|
| 1 | **强制安装白名单**：`skill-finder`、`skill-creator`、`self-improvement`、`accio-mcp-cli`、`image-prompt-guide` 启动时自动补齐/启用 | `forced-install-skills` | ⭐ 你的 `skill-creator`/`make-skill` 可设为内置必装 |
| 2 | **废弃技能清理**：`mcp-tools`、`alibaba-publish-skill` 启动时自动卸载 | 同上 | ⭐ 你 55 个技能迭代快，需要这个 |
| 3 | **重名冲突处理**：同 skillId 多 dirPath 时保留全部并 `warn` 冲突插件列表，调用方无 pluginId 时确定性选取 | `SkillRendererIndex` | 你的技能目录隔离已做，可加冲突告警 |
| 4 | **mtime 陈旧检查**：60s 节流 + mtime 变化才重扫，避免热更新时的重复扫描 | 同上 | 你的 `watch: true` 可加节流 |
| 5 | **技能渲染器**（`renderers`）：技能可声明自定义 UI 渲染 | `parseRenderers` | 产品增强项 |
| 6 | **技能工具声明**（`tools`）：技能可自带工具 | `parseTools` | 与你 `contract.json` 思路一致 |
| 7 | **知识型/脚本型双模**：`readSkillJson` → `readPackageJson` 回退，支持纯 npm 包当技能 | `scanner` | 可选 |
| 8 | **子代理必须显式传 `required_skills`**：因为子会话看不到主会话，加载过 ≠ 注入到子代理 | system prompt | ⭐ 你若接了多代理协作要注意这个坑 |
| 9 | **`created_by: sub_agent` 溯源标记**：区别人写的技能和 AI 提炼的技能 | system prompt | ⭐ 配合第 4 节使用 |
| 10 | **13 个能力分类**（team/sourcing/research-selection/design/content-gtm/seo-ads/store-ops/shipping-tariff/analytics-finance/crm-retention/productivity/agent-tools/other） | `skill-blacklist` | 你已有 13 个自己的能力分类，可对照合并 |

---

## 9. 建议的落地顺序

| 优先级 | 动作 | 工作量 | 收益 |
|---|---|---|---|
| **P0** | **A1** `validateSkill()` 双语质量门禁 | 小 | 立刻能把 55 个技能的短板量化出来 |
| **P0** | **E1** 修 `description` 里 `[` 开头的 YAML 解析风险 | 小 | 消除一个隐蔽的静默失败点 |
| **P1** | **B1+B2** `tool_triggers` 注册表 + 运行时提示注入 | 中 | 从「模型猜」到「声明式路由」，直击你 FIX-LOG 半数问题 |
| **P1** | **A2** 质量分上市场页 | 小 | 技能治理可视化 |
| **P2** | **C2** `.skill-stats.json` 使用统计 + 市场排序 | 小 | 数据驱动运营 |
| **P2** | **D1** `SKILL.patch.md` 现场修正层 | 中 | 技能升级不丢现场经验 |
| **P3** | **B3** 用 triggers 自动提示风控处置 | 小 | 降低风控问题复发 |
| **P3** | **C1** 从对话提炼「平台坑位记忆」 | 大 | 需要 LLM 调用 + 审核流程 |
| **P4** | **§7** 八域知识沉淀层 | 很大 | 产品级战略选项 |

---

## 10. 不需要抄的部分

| Accio 做法 | 为什么不建议抄 |
|---|---|
| 自动淘汰人工技能 | 你的技能是人工精编的连接器，误删代价高 |
| 全自动 SkillHarvest 直接落盘 | 需先有审核流程 + `created_by` 溯源，否则技能目录会被噪声淹没 |
| Composio MCP 集成层 | 你的网关 + 凭证库模型更贴合国内平台，不要引入第三方抽象 |
| Electron 内置浏览器 runtime | 你复用本机 Chrome + puppeteer-core 更轻 |

---

## 附：分析产物位置

| 文件 | 说明 |
|---|---|
| `.tmp-accio/audit-report.txt` | 你 55 个技能按 Accio 评分模型的完整体检报告 |
| `.tmp-accio/audit-skills.mjs` | 评分脚本（可改双语正则后复用为 CI 检查） |
| `.tmp-accio/asar.mjs` / `dump.mjs` / `dump2.mjs` / `snip.mjs` | 自写 ASAR 解析与源码摘录工具 |
| `D:\软件\Accio\_staging\resources\wiki-skills\` | 明文八域 wiki 技能（**非 asar，可直接读**） |
| `D:\软件\Accio\_staging\resources\global-memory-workflow\dsl\` | 10 个平台身份/店铺画像探测 DSL（淘宝/京东/拼多多/抖音/1688） |

> **工具备注**：`npx @electron/asar` 在本机沙箱下因 npm cache EPERM 不可用，
> 故自写了 `asar.mjs`。后续需要读 Accio 内部实现可直接复用这几个脚本。

---

# 第二部分 · 实施记录（全部建议已落地）

> 本节记录 2026-10-04 的实施结果。**所有 P0–P4 项均已实现并通过验证**。
> 实施过程中修正了原分析中 3 处与实测不符的结论，逐条标注在下方。

## 实施总览

| 优先级 | 项 | 状态 | 落地文件 |
|---|---|---|---|
| P0 | 双语技能质量门禁 | ✅ | `src/services/skill-quality.ts` |
| P0 | frontmatter 解析加固 + YAML 陷阱检测 | ✅ | `src/services/skill-quality.ts` |
| P1 | `tool_triggers` 注册表 + 运行时提示注入 | ✅ | `src/services/tool-triggers.ts` |
| P1 | 质量分上市场页（徽标 + 缺陷清单 + 排序） | ✅ | `src/ui/skill-market-page.ts` |
| P2 | `.skill-stats.json` 使用统计 + 淘汰评分 | ✅ | `src/services/skill-stats.ts` |
| P2 | `SKILL.patch.md` 现场修正层 | ✅ | `src/services/skill-patch.ts` |
| P3 | 风控 triggers 自动提示（内置规则） | ✅ | `src/services/tool-triggers.ts` |
| P3 | 平台坑位记忆（C1） | ✅ | `src/services/pitfall-memory.ts` |
| P4 | 八域本体知识沉淀层 | ✅ | `wiki-schema.ts` / `wiki-frontmatter.ts` / `wiki-store.ts` |

接入点：`src/services/skill-service.ts`、`src/index.ts`（HTTP action + 8 个新工具）。

## ★ 实测修正（3 处原分析结论有误）

### 修正 1：你的技能并非「结构缺失」，而是「标题语言不匹配」

原分析说「55/55 判为 missing Workflow」。深挖后发现**你的技能内容结构是完整的**，
只是标题用了中文（`## 工作流` / `## 前置条件` / `## 错误处理`），
而 Accio 的评分器是英文硬编码正则。因此改造点是**正则双语化**，而非让作者补章节。

实施时还发现两个必须绕开的坑：

| 坑 | 现象 | 修法 |
|---|---|---|
| `\b` 在中文后永不匹配 | `工作流\b` 命中 0/56 | JS 里 `\w` 只含 `[A-Za-z0-9_]`，中文不属于 `\w`，改用「行内包含」判定 |
| 中文标题是描述式的 | `## 完整 HTML 报告工作流（含分析结论）`、`## 4 步主流程` 全部漏判 | 从「以关键词开头」放宽为「H2 行内含关键词」（`###` 不命中，误报风险低） |

**实测效果**（56 个技能，同一量表）：

| 指标 | Accio 英文口径 | 双语口径 |
|---|---|---|
| 平均分 | 0.600 | **0.807** |
| Workflow 命中 | 0/56 | **39/56** |
| 满分技能 | 0 | 2 |

修订正则后（新增技能）达 **0.837 / 48 个命中 Workflow / 11 个满分**。

### 修正 2：`CANDIDATE_THRESHOLD` 作为资格判定会让阈值失效

首版照搬 Accio「综合分 < 0.2 进淘汰候选」。但综合分含 0.2 权重的**静态**文档质量分，
于是任何质量满分的技能其分数恒 ≥0.2，**永远不可能**成为候选 —— 阈值形同虚设。

这是被验证脚本抓出来的（`idleCandidates 只列曾经用过且长期空闲的` 用例失败）。
修法：候选资格改用「**成功次数少** + **长期空闲**」两个真正反映陈旧的信号，
综合分只用于候选之间的排序。并补了一条回归用例锁死该行为。

> 顺带印证：**验证脚本本身是有价值的**，它抓到了一个照抄就会带进来的逻辑缺陷。

### 修正 3：`patch` 不应计入主文档质量分

`product-reviews` 的「错误处理」只写在 `SKILL.patch.md` 里，主文档得 0.90。
曾考虑把 patch 合并后再评分，但那样会**掩盖「主文档缺章节」这一事实**。
最终决定评分只读 `SKILL.md` 主文档 —— 质量分衡量的是「主文档是否自足」。

## 关键实现决策（与原分析的差异）

| 决策 | 原分析建议 | 实际做法 | 理由 |
|---|---|---|---|
| 质量门禁是否阻断写入 | 「不合格直接拒绝」 | **只报告不拦截**（`force` 可显式拒绝） | Accio 是封闭市场能约束作者；本项目技能目录是用户资产，硬拦截会让人无法保存半成品 |
| 是否自动淘汰技能 | Accio 自动淘汰 `[Harvest]` | **只列候选，绝不自动删除** | Accio 淘汰的是自己生成的副产品；本项目是人工精编的连接器，误删不可恢复 |
| 内置触发规则 | 未提及 | **新增 2 条内置规则** | 无需改任何 SKILL.md 即可让风控处置在第一次调用时就可见（直击 FIX-LOG #45–#53） |
| 触发去重 | Accio 按技能去重 | **再加会话级去重** | 多轮对话里同一技能反复提示会刷屏 |
| 自引用防护 | 未提及 | **合并块显式声明「无需再读」** | patch 里若写「读取 SKILL.md」会让模型陷入读取循环 |
| **坑位记忆如何提炼** | 「从对话自动提炼成 skill 坑位段」（LLM） | **只记录机器可验证的事实**（失败类型/归一化签名/次数/时间），**不落盘到技能目录**，需要沉淀时导出草稿交人审核 | 见下 |

### 为什么坑位记忆**不**用 LLM 提炼

原分析 §4 C1 建议「从对话自动提炼成 skill 坑位段」。实施时改为**确定性统计**，三条理由：

1. **幻觉风险**。LLM 提炼的「经验」无法与事实核对，写进技能目录后会长期误导。
   本模块记录的每个字段都可验证：`failureKind` 来自脚本自报、`count` 来自真实调用次数、
   `lastSeenAt` 是时间戳。**没有任何一项来自模型推断。**
2. **成本**。每次会话结束跑一次 LLM 调用，在长会话（本项目实测有 4.3M token 的会话）是纯开销。
   本模块是纯内存 + 一次 JSON 落盘。
3. **审核边界**。Accio 自动落盘，本模块**只记录不写入技能目录**；
   需要沉淀成 `SKILL.patch.md` 时由 `dsagent_pitfalls(mode=draft)` 生成**带证据的草稿**交人审核。

两个必须处理的工程细节（都有专门用例锁死）：

| 细节 | 不处理的后果 |
|---|---|
| **签名归一化** | `商品 123456 取数失败` 与 `商品 789012 取数失败` 会变成两条独立记录，各自计数永远到不了阈值，**坑位永远无法晋升** |
| **证据阈值（3 次）** | 单次失败可能只是网络抖动；误报的坑位会污染提示，比漏报代价更高 |

## 真实运行时验证发现并修复的一个缺陷（2026-10-04）

**只有真实运行时验证才能发现**的问题，也是本轮 UI 验证最大的收获。

### 现象

在 DSH 真实会话里调用 `dsagent_wiki_write` 写入一个
`披露等级: 可对外` 的页面，其中含机密字段 `价格底线: 0.55元/只` ——
**写入成功了**，机密值落进了对外页面。

### 根因：两条校验路径分叉

| 入口 | 走的校验函数 | 参数形状 | 机密检查 |
|---|---|---|---|
| `buildTemplate` + `renderPage` | `validateTemplate()` | 模板**对象** | ✅ 有 |
| `dsagent_wiki_write` 工具 | `checkPageText()` | frontmatter **文本** | ❌ **原先没有** |

工具签名收的是 `frontmatterYaml` 文本，天然走文本路径；而首版 `checkPageText()`
只做了顶层字段 / 废弃字段 / `[src]` / 域块 / title-H1 五项，**完全没有**机密字段、
枚举、接待域规则、域字段名这些检查。于是产生绕过路径：

```
用 dsagent_wiki_template 生成模板 → validateTemplate → 拦得住
直接手写 frontmatterYaml 传进 write → checkPageText → 拦不住
```

### 为什么 68 个用例没抓到

`dev/verify-wiki.mjs` 的机密字段用例调用的是 `validateTemplate()`（模板路径），
而线上工具走 `checkPageText()`（文本路径）——**测了 A 却上了 B**。
用例本身没错，错在覆盖的是另一条路径。

### 修复

1. 新增 `parseFieldPaths()`：把 frontmatter 文本解析成「字段路径 → 值」，
   使文本路径也能做依赖字段位置的检查（支持顶层标量 / 两层映射，容错优先）。
2. `checkPageText()` 补齐与 `validateTemplate()` 对齐的全部检查：
   机密字段进可对外页、Schema 外字段/分组、实体子类型枚举与单一形态域约束、
   接待域两条 L1 规则、建页锚点。
3. 新增 `dev/verify-wiki-textpath.mjs`（25 用例），
   **对同一份违规内容同时跑两条路径并要求结论一致** —— 防止再次分叉。

### 教训

> 同一概念有两条入口时，校验逻辑必须收敛、或至少保证两条路径被同一组用例覆盖。
> 只测其中一条，等于另一条完全没有护栏。

## 真实运行时验证发现并修复的第二个缺陷：记录策略两路径分叉

### 现象

在 DSH 真实会话里对一个平台技能触发 `token_expired` 失败后，
查 `dsagent_pitfalls` 显示**零条记录**。

### 根因：判定散落在两个地方

| 失败路径 | `token_expired` 是否记录 |
|---|---|
| 预检分支（`fetchSessionHint` 返回 expired/reauth_required） | ❌ 不记 |
| 脚本失败分支（`RECORDABLE` 白名单） | ✅ 记 |

同一个 failureKind，两条路径行为相反 —— 与上一个缺陷是**同一类错误**
（同一概念两处实现），只是从「校验」换成了「策略」。

### 修法与判定原则

把「什么算坑位」收口到 `pitfall-memory::isRecordableFailure()`，两条路径共用。
判定标准明确为一句话：

> **「知道它已经发生过 N 次」是否改变模型这一次该做什么？**

- **收录**：`risk_control`（N 次 → 先走验证别盲重试）、`rate_limit`（N 次 → 是频控，换 mode）、
  `no_permission`（N 次 → 换号才解决）、`api_error`/`parse_error`/`skill_error`（N 次 → 不是抖动，去读文档）
- **排除**：`token_expired` —— 第 1 次和第 100 次的处置**完全相同**（重新登录），
  计数不改变任何决策；且换账号即消失，属**账号状态**而非平台坑位。
  同理排除 `not_bound` / `need_account_choice` / `skill_not_found` / `invalid_args`。

### 附带修正

原白名单**包含** `token_expired`，按上述原则属于误收 —— 已移除。
`dev/verify-pitfalls.mjs` 增加一节策略用例（含「白名单恰好 6 项」防止再漂移）。

## 验证结果

六套测试套件，全部通过（**246 个用例**）：

| 套件 | 用例数 | 覆盖 |
|---|---|---|
| `dev/verify-skill-governance.mjs` | **47** | 双语槽位评分、frontmatter 解析、tool_triggers 解析与匹配、注册表去重、统计并发安全、patch 合并 |
| `dev/verify-patch-layer.mjs` | **25** | patch 参与真实执行链路、质量概览 API、使用统计 API、评分与 patch 解耦 |
| `dev/verify-wiki.mjs` | **68** | 八域 Schema、锁定模板、**校验器拦住模型漂移**、接待域 L1 规则、render 删空值、披露过滤、文件名清洗、落盘与索引 |
| `dev/verify-wiki-textpath.mjs` | **25** | **文本路径与模板路径的校验一致性**、机密字段泄漏回归、parseFieldPaths |
| `dev/verify-pitfalls.mjs` | **54** | 签名归一化与折叠、**证据不足不提示**、陈旧坑位退出提示、并发安全、脏数据净化、容量淘汰、提示渲染、**记录白名单策略单一出处** |
| `dev/verify-host-integration.mjs` | **27** | `apply()` 真实注册 34 个工具、系统提示词注入、**原有工具无回归**、`required:false` 回归、知识库工具端到端写入 |


另有两个诊断脚本：

- `dev/audit-skill-quality.mjs` —— 给全体技能做质量体检（可接 CI）
- `dev/verify-real-triggers.mjs` —— 用真实技能文件验证 triggers 匹配

`npm run build`（typecheck + tsc + client bundle + 15 项 smoke）全部通过，无回归。

## 已落地的真实范例

不是只写了机制，而是在真实技能上跑了：

| 技能 | 加了什么 | 验证 |
|---|---|---|
| `product-reviews` | `tool_triggers`（3 条，含 `dsagent_proxy` 兜底）+ `SKILL.patch.md`（tmall 域修正 #53、风控处置、翻页上限） | 真实注册表命中 2 条 |
| `product-wdj` | `tool_triggers`（3 条）+ `SKILL.patch.md`（240s 预算、`answers_truncated` 语义 #55） | 真实注册表命中 2 条 |

## 新增工具（8 个）

| 工具 | 用途 |
|---|---|
| `dsagent_wiki_schema` | 查看八域本体 Schema（不传 domain 返回路由表） |
| `dsagent_wiki_template` | 生成页面锁定模板（**frontmatter 必须经此生成**） |
| `dsagent_wiki_write` | 校验并写入页面（校验不过拒绝写入） |
| `dsagent_wiki_search` | 检索 / 读取 Wiki 页面 |
| `dsagent_wiki_stats` | Wiki 概览 + 重建 INDEX.md |
| `dsagent_pitfalls` | 查看平台坑位记忆 / 导出可审核草稿（`summary` / `all` / `draft`） |
| （已有工具增强）`dsagent_list_skills` | 现在输出质量分 / 补丁标记 / 使用次数 |
| （已有工具增强）`dsagent_get_skill_detail` | 现在输出质量诊断 + 补丁内容 |

工具总数（静态注册）：24 → **34**。另有 15 个技能契约工具（`dsagent_<技能id>`）在运行期按 `contract.json` 动态注册，不计入上述静态数。

## 未实施项（刻意保留）

| 项 | 原因 |
|---|---|
| 从对话用 LLM 自动提炼技能（SkillHarvest 全量） | 已用**确定性坑位统计**替代（见「为什么坑位记忆不用 LLM 提炼」）。LLM 提炼需先有完整审核流程 + `created_by` 溯源，否则技能目录会被无法核对的文字淹没 |
| 技能 ID 三级回退 + sha256 后缀 | 本项目技能 id 已由目录名稳定确定，且契约/绑定规则都按 id 索引，改动会波及面过大 |
| 强制安装白名单 / 废弃技能清理 | 属于产品运营策略，需先确认哪些技能是「必装」 |
| Accio 的 `renderers` / `tools` frontmatter 声明 | 与本项目 `contract.json` 契约机制重叠，无新增价值 |



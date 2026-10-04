---
name: self-improvement
description: "把「报错、被纠正、偏好、能力缺口、复盘」沉淀成可累积的执行经验：写入日记（.dsagent-memory/diary/YYYY-MM-DD.md），高价值条目提升为长期规则到 .dsagent-memory/ 下的 SOUL/AGENTS/TOOLS/MEMORY。触发场景：(1) 命令或操作意外失败，(2) 用户纠正你，(3) 用户表达偏好（「我喜欢/总是/从不…」），(4) 用户要求的能力不存在，(5) 外部 API 或工具失败，(6) 知识过时或错误，(7) 发现更好的做法，(8) 完成重要工作后要做质量复盘。启动大型任务前也应先翻查近期日记。"
metadata:
  dsagent:
    display_name: "自我改进与经验沉淀"
    emoji: "🧠"
    requires: {}
---

# Self-Improvement Skill

## 前置条件

- 记忆根目录为工作区下的 `.dsagent-memory/`；不存在时先创建 `mkdir -p .dsagent-memory/diary`。
- 写入前先检索已有日记，避免把同一条经验重复记录成多条；重复出现时改为累加 `**Count**` 并补 `**See Also**`。
- 日记是只追加的：修正状态用改 `**Status**` 字段，不要删除历史条目。

## 错误处理

- 记不清细节时不要编造：只写确定的部分，并在 `**Details**` 标注不确定处。
- 用户沉默不等于偏好：不得从"没有反馈"推断出偏好条目。
- 涉及凭据、密钥、Cookie、他人隐私时一律不写入日记与记忆文件，只记"存在该约束"这一事实。

Log learnings, errors, feature requests, and self-reflections into the daily diary
(`.dsagent-memory/diary/YYYY-MM-DD.md`) for continuous improvement. Important learnings get
promoted to durable memory files under `.dsagent-memory/`.

> **路径口径（DSAgent 适配）**：本技能原版面向 `agent-core/` 目录结构与 Claude Code 的
> `UserPromptSubmit` / `PostToolUse` 钩子。DeepSeek Agent 宿主**没有钩子机制**，因此所有记录动作
> 由你自己在对话中主动执行，不依赖任何自动触发脚本。
>
> 记忆根目录统一为工作区下的 **`.dsagent-memory/`**：
>
> ```
> .dsagent-memory/
> ├── diary/YYYY-MM-DD.md   # 每日日记（学习/错误/需求/复盘合并在这一个文件）
> ├── SOUL.md                # 行为准则、沟通风格、用户偏好
> ├── AGENTS.md              # 工作流、工具使用模式、自动化规则
> ├── TOOLS.md               # 工具能力、集成坑点
> └── MEMORY.md              # 项目事实、约定、长期知识
> ```
>
> 目录不存在时用 `mkdir -p .dsagent-memory/diary` 创建。日记是**只追加**的，永不删除。

## Quick Reference

| Situation | Action |
|-----------|--------|
| Command/operation fails | Log `[ERR]` entry to today's diary |
| User corrects you | Log `[LRN]` entry with category `correction` |
| User states a preference | Log `[LRN]` with category `preference`, promote immediately |
| User wants missing feature | Log `[FEAT]` entry to today's diary |
| API/external tool fails | Log `[ERR]` entry with integration details |
| Knowledge was outdated | Log `[LRN]` entry with category `knowledge_gap` |
| Found better approach | Log `[LRN]` entry with category `best_practice` |
| Completed significant work | Log `[REF]` entry with self-evaluation |
| Similar to existing entry | Link with `**See Also**`, bump `**Count**` |
| Same correction 3 times | Ask user to confirm as permanent rule, then promote |
| Behavioral patterns | Promote to `SOUL.md` |
| Workflow improvements | Promote to `AGENTS.md` |
| Tool gotchas | Promote to `TOOLS.md` |
| Project facts, conventions | Promote to `MEMORY.md` |

## Setup

All entries go into the daily diary file under `.dsagent-memory/`.

### Directory Structure

```
.dsagent-memory/
├── diary/
│   └── YYYY-MM-DD.md          # all learnings merged with normal diary entries
├── skills/
│   └── self-improvement/
│       └── SKILL.md            # this file
├── AGENTS.md                   # promotion target (workflows)
├── SOUL.md                     # promotion target (behavioral)
├── TOOLS.md                    # promotion target (tool gotchas)
└── MEMORY.md                   # promotion target (long-term facts)
```

### Activation Guide

DSAgent has no hook mechanism, so activate this behaviour by keeping it in the agent's
standing instructions. Add the following to your workspace `AGENTS.md` (or the agent's
system/记忆文件) so the habit survives across sessions.

**Add to `SOUL.md`:**

```markdown
## Self-Improvement

Compounding execution quality is part of the job.
Before non-trivial work, scan recent diary entries for relevant learnings.
After corrections, failed attempts, or reusable lessons, write one concise diary entry immediately.
Prefer learned rules when relevant, but keep self-inferred rules revisable.
```

**Add to `AGENTS.md`:**

```markdown
## Self-Improvement Workflow

Use `.dsagent-memory/diary/YYYY-MM-DD.md` for factual continuity (events, context, decisions)
and execution-improvement learnings.
Use `MEMORY.md` / `SOUL.md` / `TOOLS.md` for promoted, durable rules.
After a correction or strong reusable lesson, write the diary entry before the final response.
When user says "remember this": if factual context → diary; if preference/style/rule → promote
to the appropriate `.dsagent-memory/` file.
```

### Promotion Targets

When learnings prove broadly applicable, promote them to durable memory files:

| Learning Type | Promote To | Example |
|---------------|------------|---------|
| Behavioral patterns | `SOUL.md` | "Be concise, avoid disclaimers" |
| Workflow improvements | `AGENTS.md` | "Spawn sub-agents for long tasks" |
| Tool gotchas | `TOOLS.md` | "Git push needs auth configured first" |
| Project facts, conventions | `MEMORY.md` | "Package manager: bun (not npm)" |

## Logging Format

All entries are appended to `.dsagent-memory/diary/YYYY-MM-DD.md` (create the file if it
doesn't exist for today). Entries use the diary header format with a type tag.

### Learning Entry `[LRN]`

```markdown
### YYYY-MM-DD HH:MM - [LRN] category: One-line summary
*   **Priority**: low | medium | high | critical
*   **Area**: frontend | backend | infra | tests | docs | config
*   **Details**: Full context — what happened, what was wrong, what's correct
*   **Action**: Specific fix or improvement to make
*   **Source**: conversation | error | user_feedback
*   **Count**: 1 (increment on recurrence; at 3 → ask user to confirm)
*   **Tags**: tag1, tag2
*   **See Also**: Reference to related diary entries if applicable
*   **Status**: pending
```

### Error Entry `[ERR]`

```markdown
### YYYY-MM-DD HH:MM - [ERR] Brief description of what failed
*   **Priority**: high
*   **Area**: frontend | backend | infra | tests | docs | config
*   **Error**: `actual error message or output`
*   **Context**: Command/operation attempted, input or parameters used
*   **Fix**: What might resolve this (if identifiable)
*   **Reproducible**: yes | no | unknown
*   **Tags**: tag1, tag2
*   **See Also**: Reference to related diary entries if applicable
*   **Status**: pending
```

### Feature Request Entry `[FEAT]`

```markdown
### YYYY-MM-DD HH:MM - [FEAT] Capability name
*   **Priority**: low | medium | high
*   **Area**: frontend | backend | infra | tests | docs | config
*   **Request**: What the user wanted to do
*   **User Context**: Why they needed it, what problem they're solving
*   **Complexity**: simple | medium | complex
*   **Implementation**: How this could be built
*   **Frequency**: first_time | recurring
*   **Status**: pending
```

### Self-Reflection Entry `[REF]`

```markdown
### YYYY-MM-DD HH:MM - [REF] Task type: What I noticed
*   **What I did**: Brief description of the work
*   **Outcome**: success | partial | failed
*   **Reflection**: What could be better — compare outcome vs intent
*   **Lesson**: What to do differently next time
*   **Status**: pending
```

## Self-Reflection

After completing significant work, pause and evaluate your own output before moving on.

### When to Self-Reflect

- After completing a multi-step task
- After receiving feedback (positive or negative)
- After fixing a bug or mistake
- When you notice your output could be better
- After a failed approach that required a pivot

### How to Self-Reflect

1. **Did it meet expectations?** — Compare outcome vs intent
2. **What could be better?** — Identify improvements for next time
3. **Is this a pattern?** — If you've seen this before, link entries and consider promotion

Self-reflection entries follow the same promotion rules: if a lesson proves durable
(applied successfully 3+ times), promote it to the appropriate memory file.

## Resolving Entries

When an issue is fixed, update the entry in the diary:

1. Change `**Status**: pending` to `**Status**: resolved`
2. Append a resolution line:

```markdown
*   **Status**: resolved
*   **Resolved**: YYYY-MM-DD, brief description of what was done
```

Other status values:
- `in_progress` — Actively being worked on
- `wont_fix` — Decided not to address
- `promoted` — Elevated to SOUL.md, AGENTS.md, TOOLS.md, or MEMORY.md
- `case_by_case` — Declined for promotion; handle per-situation
- `archived` — Compacted or superseded; skip during review

## Promoting to Durable Memory

When a learning is broadly applicable (not a one-off fix), promote it to permanent memory files.

### When to Promote

- Learning applies across multiple files/features
- Knowledge any contributor (human or AI) should know
- Prevents recurring mistakes
- Documents project-specific conventions
- User explicitly states a preference ("Always do X", "I prefer Y")

### Promotion Targets

| Target | What Belongs There |
|--------|-------------------|
| `SOUL.md` | Behavioral guidelines, communication style, principles, user preferences |
| `AGENTS.md` | Agent workflows, tool usage patterns, automation rules |
| `TOOLS.md` | Tool capabilities, usage patterns, integration gotchas |
| `MEMORY.md` | Project facts, conventions, long-term knowledge |

### How to Promote

1. **Distill** the learning into a concise rule or fact
2. **Add** to appropriate section in target file
3. **Update** original diary entry: change `**Status**: pending` to `**Status**: promoted`

### Promotion Examples

**Diary entry** (verbose):
> ### 2026-03-09 10:30 - [LRN] knowledge_gap: Project uses bun not npm
> *   **Details**: Attempted `npm install` but project uses bun workspaces. Lock file is `bun.lock`.

**In MEMORY.md** (concise):
```markdown
## Build & Dependencies
- Package manager: bun (not npm) - use `bun install`
```

**Diary entry** (verbose):
> ### 2026-03-09 14:00 - [LRN] best_practice: Regenerate client after API changes
> *   **Details**: When modifying API endpoints, the TypeScript client must be regenerated. Forgetting causes type mismatches at runtime.

**In AGENTS.md** (actionable):
```markdown
## After API Changes
1. Regenerate client: `bun run generate:api`
2. Check for type errors: `bun tsc --noEmit`
```

## 3-Count Confirmation Flow

When the same correction appears repeatedly, use counting to decide when to promote.

### How It Works

1. On first occurrence, log with `**Count**: 1`
2. On recurrence, search diary for the existing entry, bump count and add `**See Also**` link
3. At count 3, ask the user:

```
I've noticed you prefer X over Y (corrected 3 times).
Should I always do this?
  - Yes, always → promote to SOUL.md / MEMORY.md
  - Only in [context] → add scoped note to MEMORY.md
  - No, case by case → mark as case_by_case, stop counting
```

4. If confirmed → promote immediately, mark all related diary entries as `promoted`
5. If declined → mark as `case_by_case`

### Exceptions: Immediate Promotion

Some signals skip the 3-count flow entirely:
- User says "Always do X" / "Never do Y" / "I prefer..." → promote immediately
- User says "Remember that I..." → promote immediately
- Confirmed preference stated explicitly → no counting needed

## Recurring Pattern Detection

If logging something similar to an existing diary entry:

1. **Search first**: `grep -r "keyword" .dsagent-memory/diary/`
2. **Link entries**: Add `**See Also**: YYYY-MM-DD entry title` in the new entry
3. **Bump count** on the original entry
4. **At count 3**: Trigger confirmation flow (see above)
5. **Consider systemic fix**: Recurring issues often indicate:
   - Missing documentation (promote to MEMORY.md)
   - Missing automation (add to AGENTS.md)
   - Tool misunderstanding (add to TOOLS.md)

## Detection Triggers

Automatically log when you notice:

**Corrections** (log `[LRN]` with category `correction`):
- "No, that's not right..."
- "Actually, it should be..."
- "You're wrong about..."
- "That's outdated..."
- "I told you before..."
- "Stop doing X"
- "Why do you keep..."

**Preferences** (log `[LRN]` with category `preference`, promote immediately):
- "I like when you..."
- "Always do X for me"
- "Never do Y"
- "My style is..."
- "I prefer..."
- "Remember that I always..."
- "For [project], use..."

**Feature Requests** (log `[FEAT]`):
- "Can you also..."
- "I wish you could..."
- "Is there a way to..."
- "Why can't you..."

**Knowledge Gaps** (log `[LRN]` with category `knowledge_gap`):
- User provides information you didn't know
- Documentation you referenced is outdated
- API behavior differs from your understanding

**Errors** (log `[ERR]`):
- Command returns non-zero exit code
- Exception or stack trace
- Unexpected output or behavior
- Timeout or connection failure

## What NOT to Log

Do not create diary entries for:

- **One-time instructions** — "do X now", "just this once"
- **Context-specific directives** — "in this file...", "for this PR..."
- **Hypothetical discussions** — "what if...", "could we theoretically..."
- **Third-party preferences** — "John likes...", "the team prefers..." (no consent)
- **Information already in context** — don't re-log what's in SOUL.md, AGENTS.md, or MEMORY.md
- **Silence** — never infer preferences from lack of feedback
- **Single instance of anything ambiguous** — wait for repetition or explicit statement

## Periodic Review

Review diary entries at natural breakpoints:

### When to Review
- Before starting a new major task
- After completing a feature
- When working in an area with past learnings
- Weekly during active development

### Quick Status Check

用 PowerShell（Windows 宿主）：

```powershell
# Count pending items across all diary files
(Select-String -Path .dsagent-memory/diary/*.md -Pattern 'Status\*\*: pending').Count

# List pending high-priority items
Select-String -Path .dsagent-memory/diary/*.md -Pattern 'Priority\*\*: high' -Context 1,0

# Find learnings for a specific area
Select-String -Path .dsagent-memory/diary/*.md -Pattern 'Area\*\*: backend' -List

# Find all error entries
Select-String -Path .dsagent-memory/diary/*.md -Pattern '\[ERR\]'

# Find entries ready for confirmation (count >= 3)
Select-String -Path .dsagent-memory/diary/*.md -Pattern 'Count\*\*: [3-9]'
```

### Review Actions
- Resolve fixed items
- Promote applicable learnings
- Link related entries
- Escalate recurring issues
- Compact stale entries

## Compaction

When diary files accumulate stale entries, compact them to reduce noise.

### When to Compact
- During periodic review
- When a diary file exceeds ~100 entries
- When multiple entries cover the same topic

### How to Compact

1. **Merge similar corrections** into a single promoted rule:

```
BEFORE (3 entries across diary files):
  [LRN] correction: Use tabs not spaces
  [LRN] correction: Indent with tabs
  [LRN] correction: Tab indentation please

AFTER (1 promoted rule in MEMORY.md):
  - Indentation: tabs (confirmed 3x)

  + mark all 3 diary entries as **Status**: promoted
```

2. **Summarize verbose resolved errors** — keep one-liner + fix:

```
BEFORE:
  ### 2026-03-05 09:15 - [ERR] Docker build fails on M1...
  (10 lines of detail)

AFTER:
  ### 2026-03-05 09:15 - [ERR] Docker build fails on M1
  *   **Fix**: `--platform linux/amd64`
  *   **Status**: archived
```

3. **Mark old entries as `archived`** so they are skipped during search but never deleted (diary is append-only)

### Rules
- Never delete diary entries — append-only
- Never lose confirmed preferences during compaction
- Archived entries can be collapsed but must retain date, type tag, and one-line summary

## Priority Guidelines

| Priority | When to Use |
|----------|-------------|
| `critical` | Blocks core functionality, data loss risk, security issue |
| `high` | Significant impact, affects common workflows, recurring issue |
| `medium` | Moderate impact, workaround exists |
| `low` | Minor inconvenience, edge case, nice-to-have |

## Area Tags

Use to filter learnings by codebase region:

| Area | Scope |
|------|-------|
| `frontend` | UI, components, client-side code |
| `backend` | API, services, server-side code |
| `infra` | CI/CD, deployment, Docker, cloud |
| `tests` | Test files, testing utilities, coverage |
| `docs` | Documentation, comments, READMEs |
| `config` | Configuration files, environment, settings |
| `skills` | 技能定义、SKILL.md、技能脚本与契约 |

## Security Boundaries

### Never Store

Do not write any of the following to diary or memory files:

| Category | Examples |
|----------|----------|
| Credentials | Passwords, API keys, tokens, SSH keys, Cookie 串 |
| Financial data | Card numbers, bank accounts, crypto seeds |
| Medical/health | Diagnoses, medications, conditions |
| Third-party personal info | Information about other people without consent |
| Location patterns | Home/work addresses, daily routines |

### Store with Caution

| Category | Rules |
|----------|-------|
| Work context | Scope to project; decay when project ends |
| Emotional states | Only if user explicitly shares; never infer |
| Schedules | General patterns OK ("busy mornings"), not specific times |

### Transparency

- Every action from memory should cite its source: "Using X (from MEMORY.md)"
- User can ask "what do you know about me?" and get a full accounting
- If it affects behavior, it must be visible in memory files

## Best Practices

1. **Log immediately** — context is freshest right after the issue
2. **Be specific** — future agents need to understand quickly
3. **Include reproduction steps** — especially for errors
4. **Link related files** — makes fixes easier
5. **Suggest concrete fixes** — not just "investigate"
6. **Use consistent categories** — enables filtering
7. **Promote aggressively** — if in doubt, add to MEMORY.md or AGENTS.md
8. **Review regularly** — stale learnings lose value
9. **Self-reflect after significant work** — don't wait for errors to learn
10. **Respect the ignore list** — avoid noise from one-off or hypothetical items

## Automatic Skill Extraction

When a learning is valuable enough to become a reusable skill, extract it.

### Skill Extraction Criteria

A learning qualifies for skill extraction when ANY of these apply:

| Criterion | Description |
|-----------|-------------|
| **Recurring** | Has `See Also` links to 2+ similar issues |
| **Verified** | Status is `resolved` with working fix |
| **Non-obvious** | Required actual debugging/investigation to discover |
| **Broadly applicable** | Not project-specific; useful across codebases |
| **User-flagged** | User says "save this as a skill" or similar |

### Extraction Workflow

1. **Identify candidate**: Learning meets extraction criteria
2. **Run helper** (or create manually):
   ```bash
   bash {baseDir}/scripts/extract-skill.sh skill-name --dry-run
   bash {baseDir}/scripts/extract-skill.sh skill-name
   ```
3. **Customize SKILL.md**: Fill in template with learning content
4. **Update diary entry**: Set status to `promoted_to_skill`
5. **Verify**: Read skill in a fresh session to ensure it's self-contained

### Manual Extraction

优先直接用 `make-skill`（`/make-skill`）把当前对话沉淀为工作区技能；需要手写时按下面的约定：

1. Create `skills/<skill-name>/SKILL.md`
2. Use template from `{baseDir}/assets/SKILL-TEMPLATE.md`
3. Follow DSAgent skill spec:
   - YAML frontmatter with `name` and `description`（description 必须含触发条件）
   - Name must match folder name
   - No README.md inside skill folder
   - 校验：`python skills/skill-creator/scripts/quick_validate.py skills/<skill-name>`

### Extraction Detection Triggers

Watch for these signals that a learning should become a skill:

**In conversation:**
- "Save this as a skill"
- "I keep running into this"
- "This would be useful for other projects"
- "Remember this pattern"

**In diary entries:**
- Multiple `See Also` links (recurring issue)
- High priority + resolved status
- Category: `best_practice` with broad applicability
- User feedback praising the solution

### Skill Quality Gates

Before extraction, verify:

- [ ] Solution is tested and working
- [ ] Description is clear without original context
- [ ] Code examples are self-contained
- [ ] No project-specific hardcoded values
- [ ] Follows skill naming conventions (lowercase, hyphens)

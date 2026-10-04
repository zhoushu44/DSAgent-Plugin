# Entry Examples

Concrete examples of well-formatted diary entries with all fields.

---

## Learning: Correction

```markdown
### 2026-03-09 10:30 - [LRN] correction: Pytest fixtures are module-scoped in this codebase
*   **Priority**: high
*   **Area**: tests
*   **Details**: Assumed all pytest fixtures were function-scoped. User corrected that while function scope is the default, the codebase convention uses module-scoped fixtures for database connections to improve test performance.
*   **Action**: When creating fixtures that involve expensive setup (DB, network), check existing fixtures for scope patterns before defaulting to function scope.
*   **Source**: user_feedback
*   **Count**: 1
*   **Tags**: pytest, testing, fixtures
*   **Status**: pending
```

## Learning: Knowledge Gap (Resolved)

```markdown
### 2026-03-09 14:22 - [LRN] knowledge_gap: Project uses pnpm not npm
*   **Priority**: medium
*   **Area**: config
*   **Details**: Attempted to run `npm install` but project uses pnpm workspaces. Lock file is `pnpm-lock.yaml`, not `package-lock.json`.
*   **Action**: Check for `pnpm-lock.yaml` or `pnpm-workspace.yaml` before assuming npm. Use `pnpm install` for this project.
*   **Source**: error
*   **Count**: 1
*   **Tags**: package-manager, pnpm, setup
*   **Status**: resolved
*   **Resolved**: 2026-03-09, added to MEMORY.md for future reference
```

## Learning: Preference (Immediate Promotion)

Explicit user preferences skip the 3-count flow and get promoted immediately.

```markdown
### 2026-03-09 11:00 - [LRN] preference: Always use bullet points, never prose
*   **Priority**: high
*   **Area**: docs
*   **Details**: User said "I prefer bullet points over prose paragraphs. Always use bullets when explaining things."
*   **Action**: Promote to SOUL.md immediately — explicit preference.
*   **Source**: user_feedback
*   **Tags**: communication, formatting
*   **Status**: promoted
*   **Promoted**: SOUL.md — "Communication: Use bullet points, not prose paragraphs"
```

## Learning: 3-Count Confirmation Flow

Demonstrates how a repeated correction escalates to a confirmed rule.

**Day 1 — First occurrence (count 1):**

```markdown
### 2026-03-05 14:32 - [LRN] correction: Use 2-space indentation, not 4
*   **Priority**: medium
*   **Area**: config
*   **Details**: User corrected: "Use 2-space indentation, not 4"
*   **Action**: Switch to 2-space indent for this codebase.
*   **Source**: user_feedback
*   **Count**: 1
*   **Tags**: code-style, indentation
*   **Status**: pending
```

**Day 3 — Second occurrence (count 2):**

```markdown
### 2026-03-07 09:15 - [LRN] correction: Indent with 2 spaces
*   **Priority**: medium
*   **Area**: config
*   **Details**: Same correction again — user wants 2-space indentation.
*   **Source**: user_feedback
*   **Count**: 2
*   **Tags**: code-style, indentation
*   **See Also**: 2026-03-05 "Use 2-space indentation, not 4"
*   **Status**: pending
```

**Day 5 — Third occurrence (count 3, triggers confirmation):**

```markdown
### 2026-03-09 16:00 - [LRN] correction: 2-space indentation again
*   **Priority**: high
*   **Area**: config
*   **Details**: Third time corrected on indentation. Triggering confirmation flow.
*   **Source**: user_feedback
*   **Count**: 3
*   **Tags**: code-style, indentation
*   **See Also**: 2026-03-05, 2026-03-07 indentation entries
*   **Status**: pending
```

Agent asks:

> I've noticed you prefer 2-space indentation over 4-space (corrected 3 times). Should I always do this?
> - Yes, always
> - Only in [context]
> - No, case by case

User: "Yes, always"

Agent promotes to MEMORY.md:
```markdown
## Code Style
- Indentation: 2 spaces (confirmed 3x)
```

Then marks all 3 diary entries as `**Status**: promoted`.

## Learning: Promoted to MEMORY.md

```markdown
### 2026-03-09 16:00 - [LRN] best_practice: API responses must include correlation ID
*   **Priority**: high
*   **Area**: backend
*   **Details**: All API responses should echo back the X-Correlation-ID header from the request. This is required for distributed tracing. Responses without this header break the observability pipeline.
*   **Action**: Always include correlation ID passthrough in API handlers.
*   **Source**: user_feedback
*   **Count**: 1
*   **Tags**: api, observability, tracing
*   **Status**: promoted
*   **Promoted**: MEMORY.md
```

## Learning: Promoted to AGENTS.md

```markdown
### 2026-03-10 09:00 - [LRN] best_practice: Must regenerate API client after spec changes
*   **Priority**: high
*   **Area**: backend
*   **Details**: When modifying API endpoints, the TypeScript client must be regenerated. Forgetting this causes type mismatches that only appear at runtime. The generate script also runs validation.
*   **Action**: After any API changes, run `pnpm run generate:api`.
*   **Source**: error
*   **Count**: 1
*   **Tags**: api, codegen, typescript
*   **Status**: promoted
*   **Promoted**: AGENTS.md
```

---

## Error Entry

```markdown
### 2026-03-09 09:15 - [ERR] Docker build fails on M1 Mac due to platform mismatch
*   **Priority**: high
*   **Area**: infra
*   **Error**: `failed to solve: python:3.11-slim: no match for platform linux/arm64`
*   **Context**: Ran `docker build -t myapp .` — Dockerfile uses `FROM python:3.11-slim`, running on Apple Silicon (M1/M2)
*   **Fix**: Add platform flag: `docker build --platform linux/amd64 -t myapp .` or update Dockerfile: `FROM --platform=linux/amd64 python:3.11-slim`
*   **Reproducible**: yes
*   **Tags**: docker, arm64, m1
*   **Status**: pending
```

## Error Entry: Recurring Issue

```markdown
### 2026-03-10 11:30 - [ERR] Third-party payment API timeout during checkout
*   **Priority**: critical
*   **Area**: backend
*   **Error**: `TimeoutError: Request to payments.example.com timed out after 30000ms`
*   **Context**: POST /api/checkout, timeout set to 30s, occurs during peak hours (lunch, evening)
*   **Fix**: Implement retry with exponential backoff. Consider circuit breaker pattern.
*   **Reproducible**: yes (during peak hours)
*   **Tags**: payment, timeout, resilience
*   **See Also**: 2026-03-05 payment timeout entry, 2026-03-08 checkout failure entry
*   **Status**: pending
```

---

## Feature Request

```markdown
### 2026-03-09 16:45 - [FEAT] Export analysis results to CSV
*   **Priority**: medium
*   **Area**: backend
*   **Request**: Export analysis results to CSV format
*   **User Context**: User runs weekly reports and needs to share results with non-technical stakeholders in Excel. Currently copies output manually.
*   **Complexity**: simple
*   **Implementation**: Add `--output csv` flag to the analyze command. Use standard csv module. Could extend existing `--output json` pattern.
*   **Frequency**: recurring
*   **Status**: pending
```

## Feature Request: Resolved

```markdown
### 2026-03-05 14:00 - [FEAT] Dark mode support for the dashboard
*   **Priority**: low
*   **Area**: frontend
*   **Request**: Dark mode support for the dashboard
*   **User Context**: User works late hours and finds the bright interface straining. Several other users have mentioned this informally.
*   **Complexity**: medium
*   **Implementation**: Use CSS variables for colors. Add toggle in user settings. Consider system preference detection.
*   **Frequency**: recurring
*   **Status**: resolved
*   **Resolved**: 2026-03-08, implemented with system preference detection and manual toggle (#142)
```

---

## Self-Reflection Entry `[REF]`

```markdown
### 2026-03-09 17:00 - [REF] Flutter UI Build: Spacing looked off
*   **What I did**: Built a settings screen with toggle switches and section dividers
*   **Outcome**: partial — user said "spacing looks off, redo it"
*   **Reflection**: Focused on functionality and correct behavior, but didn't visually check the layout balance. Padding between sections was inconsistent.
*   **Lesson**: Always review visual spacing and alignment before presenting UI work to the user. Take a step back and evaluate the whole layout, not just individual components.
*   **Status**: pending
```

## Self-Reflection: Promoted

```markdown
### 2026-03-10 10:00 - [REF] API refactoring: Missed backward compatibility
*   **What I did**: Refactored the /api/users endpoint to use a new response schema
*   **Outcome**: failed — broke existing mobile client that depended on the old shape
*   **Reflection**: Changed the response without checking downstream consumers. Should have searched for all callers before modifying a public API.
*   **Lesson**: Before changing any API response shape, grep for all consumers and ensure backward compatibility or versioning.
*   **Status**: promoted
*   **Promoted**: AGENTS.md — "Before changing API responses, search for all consumers first"
```

---

## Compaction Example

Before compaction (3 separate diary entries over multiple days):

```markdown
### 2026-03-05 14:32 - [LRN] correction: Use tabs not spaces
*   **Count**: 1
*   **Status**: pending

### 2026-03-07 09:15 - [LRN] correction: Indent with tabs
*   **Count**: 2
*   **See Also**: 2026-03-05 tabs entry
*   **Status**: pending

### 2026-03-09 16:00 - [LRN] correction: Tab indentation please
*   **Count**: 3
*   **See Also**: 2026-03-05, 2026-03-07 tabs entries
*   **Status**: pending
```

After compaction — one promoted rule in MEMORY.md:

```markdown
## Code Style
- Indentation: tabs (confirmed 3x, 2026-03-05 to 2026-03-09)
```

All 3 diary entries updated to:

```markdown
*   **Status**: promoted
```

## Compaction: Verbose Error Summarized

Before:

```markdown
### 2026-03-05 09:15 - [ERR] Docker build fails on M1 Mac due to platform mismatch
*   **Priority**: high
*   **Area**: infra
*   **Error**: `failed to solve: python:3.11-slim: no match for platform linux/arm64`
*   **Context**: Ran `docker build -t myapp .` — Dockerfile uses `FROM python:3.11-slim`, running on Apple Silicon (M1/M2)
*   **Fix**: Add platform flag: `docker build --platform linux/amd64 -t myapp .` or update Dockerfile: `FROM --platform=linux/amd64 python:3.11-slim`
*   **Reproducible**: yes
*   **Tags**: docker, arm64, m1
*   **Status**: resolved
*   **Resolved**: 2026-03-05, added --platform flag
```

After compaction:

```markdown
### 2026-03-05 09:15 - [ERR] Docker build fails on M1
*   **Fix**: `--platform linux/amd64`
*   **Status**: archived
```

## Learning: Promoted to Skill

```markdown
### 2026-03-09 11:00 - [LRN] best_practice: Docker build fails on Apple Silicon
*   **Priority**: high
*   **Area**: infra
*   **Details**: When building Docker images on M1/M2 Macs, the build fails because the base image doesn't have an ARM64 variant. This is a common issue that affects many developers.
*   **Action**: Add `--platform linux/amd64` to docker build command, or use `FROM --platform=linux/amd64` in Dockerfile.
*   **Source**: error
*   **Count**: 1
*   **Tags**: docker, arm64, m1, apple-silicon
*   **See Also**: 2026-03-05 docker build error, 2026-03-07 arm64 mismatch
*   **Status**: promoted_to_skill
*   **Skill-Path**: skills/docker-m1-fixes
```

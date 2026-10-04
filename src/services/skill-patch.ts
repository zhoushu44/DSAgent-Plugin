/**
 * SKILL.patch.md 现场修正层 —— 吸收 Accio 的 SKILL.patch.md 机制。
 *
 * 背景（见 ACCIO-REVERSE-ANALYSIS.md §5）：
 *   Accio 允许在技能目录下放 `SKILL.patch.md`，`Skill` 工具在 read 时
 *   自动把 patch **追加到主文档正文之后**（子代理场景下还会加 `#### SKILL.patch.md` 小标题）。
 *
 *   设计意图：主文档是「出厂版本」，patch 是「本地现场修正」——
 *   **升级技能时不覆盖用户的现场经验**。
 *
 * ★ 本项目的适配要点：
 *   1. 路径安全。patch 路径同样要过 skillRoot 越界检查（复用 skill-service 的判定口径）。
 *   2. 自引用防护。若 patch 内容里又写了「读取 SKILL.md / SKILL.patch.md」的指令，
 *      合并后会让模型陷入「读了还要再读」的循环。这里只做**一层**合并，不做递归，
 *      并在合并块里显式声明「本块已是完整修正，无需再次读取」。
 *   3. 体积上限。patch 过大时截断并标注，避免把系统提示词或工具回传撑爆。
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** patch 文件固定名（与 Accio 一致） */
export const PATCH_FILENAME = 'SKILL.patch.md'

/** patch 内容上限：超出则截断。与工具回传上限同量级，但更保守 */
export const PATCH_MAX_CHARS = 16_000

export interface PatchResult {
  /** 是否成功读取到 patch */
  present: boolean
  /** patch 原文（未合并） */
  content: string
  /** 是否存在但读取失败 */
  error?: string
  /** 是否被截断 */
  truncated?: boolean
}

/**
 * 读取技能目录下的 SKILL.patch.md。
 *
 * 不存在属于正常情况（绝大多数技能没有 patch），返回 present:false 而非报错。
 */
export async function readSkillPatch(skillDir: string): Promise<PatchResult> {
  const file = join(skillDir, PATCH_FILENAME)
  if (!existsSync(file)) return { present: false, content: '' }
  try {
    let content = await readFile(file, 'utf8')
    let truncated = false
    if (content.length > PATCH_MAX_CHARS) {
      content = `${content.slice(0, PATCH_MAX_CHARS)}\n\n…（SKILL.patch.md 过长，已截断；完整内容请直接读取该文件）`
      truncated = true
    }
    return { present: true, content: content.trim(), truncated }
  } catch (e) {
    return {
      present: false,
      content: '',
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * 把 patch 合并到技能正文之后。
 *
 * 合并格式（对齐 Accio 子代理场景的写法）：
 *
 *   <主文档正文>
 *
 *   #### SKILL.patch.md
 *
 *   <patch 正文>
 *
 * 显式加上「本块为现场修正」的说明与自引用防护提示。
 */
export function mergePatch(body: string, patch: PatchResult): string {
  if (!patch.present || !patch.content) return body
  return [
    body.trimEnd(),
    '',
    '#### SKILL.patch.md',
    '',
    '> 以下内容是对上方主文档的**现场修正**，与主文档冲突时以本块为准。',
    '> 本块已包含全部修正内容，无需再读取 SKILL.md 或 SKILL.patch.md。',
    '',
    patch.content,
    '',
  ].join('\n')
}

/**
 * 给指令型技能渲染「带 patch 的完整正文」。
 *
 * 用于 run() 里 `mode: 'instructions'` 的分支：正文要原样直传给模型，
 * 因此 patch 必须在这里就合并进去，否则模型看不到修正。
 */
export function renderBodyWithPatch(body: string, patch: PatchResult): string {
  return mergePatch(body, patch)
}

/**
 * layout.ts —— 工作流目录布局（单层 yaml ↔ 工作流自带文件夹两种并存）
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么要有这个
 * ══════════════════════════════════════════════════════════════════
 * 原本 `skills/workflows/` 只认单层 `.yaml` 文件，工作流要用的一切脚本
 * 都得先「变成一个技能」（注册进 skills/、写 SKILL.md、写 contract.json），
 * 哪怕那个脚本只服务于这一条工作流。
 *
 * 结果就是：一次性脚本混进技能目录，和工作流 yaml 各放一处、互相找不到；
 * 而有的工作流又把技能目录里某个脚本的参数硬塞进 contract，把技能本身弄坏。
 *
 * 现在支持两种布局并存：
 *
 *   A. 单层（历史，保持兼容）
 *      skills/workflows/拼多多多链接矩阵.yaml
 *
 *   B. 自带文件夹（推荐，工作流私有资源都放里面）
 *      skills/workflows/拼多多多链接矩阵/
 *        ├── workflow.yaml      ← 模板本体（文件名固定）
 *        ├── scripts/           ← 该工作流专用的脚本
 *        │     └── run.py
 *        └── assets/            ← 该工作流专用的素材
 *
 * 判定规则：目录下存在 `workflow.yaml`（或 `workflow.yml`）即视为工作流文件夹。
 * 不含 workflow.yaml 的子目录一律忽略 —— 避免把 `scripts/` 这类纯资源目录
 * 误当成工作流。
 */

import { existsSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** 工作流文件夹的固定入口文件名 */
export const WORKFLOW_ENTRY = 'workflow.yaml'
export const WORKFLOW_ENTRY_ALT = 'workflow.yml'

/** 一条工作流记录：模板文件路径 + 它所属的根目录（自带脚本时 = 文件夹，否则 = workflowDir） */
export interface WorkflowFileRef {
  /** 模板 yaml 的绝对路径 */
  file: string
  /** 该工作流可访问的资源根目录（script: 的相对路径以此为基准） */
  root: string
  /** 是否来自自带文件夹布局 */
  isFolder: boolean
}

/**
 * 列出全部工作流模板文件（单层 yaml + 文件夹内的 workflow.yaml）。
 *
 * 顺序：先文件夹（功能更完整），后单层历史文件。
 */
export function listWorkflowFiles(workflowDir: string): WorkflowFileRef[] {
  if (!existsSync(workflowDir))
    return []

  const out: WorkflowFileRef[] = []
  let entries: { name: string, isDirectory(): boolean, isFile(): boolean }[]
  try {
    // readdirSync 的 withFileTypes 在 @types/node 不同版本下 Dirent 泛型不一致，
    // 这里显式收窄成本模块真正需要的三个成员，避免 Buffer/string 泛型冲突。
    entries = readdirSync(workflowDir, { withFileTypes: true }) as unknown as
      { name: string, isDirectory(): boolean, isFile(): boolean }[]
  }
  catch {
    return []
  }

  // ① 文件夹布局
  for (const e of entries) {
    if (!e.isDirectory())
      continue
    const dir = join(workflowDir, e.name)
    const entry = [WORKFLOW_ENTRY, WORKFLOW_ENTRY_ALT]
      .map((n) => join(dir, n))
      .find((p) => existsSync(p))
    if (entry)
      out.push({ file: entry, root: dir, isFolder: true })
  }

  // ② 单层历史文件
  for (const e of entries) {
    if (!e.isFile())
      continue
    if (!/\.ya?ml$/i.test(e.name))
      continue
    // 跳过 workflow.yaml 本身（它属于文件夹布局，不该被当单层处理）
    if (/^workflow\.ya?ml$/i.test(e.name))
      continue
    out.push({ file: join(workflowDir, e.name), root: workflowDir, isFolder: false })
  }

  return out
}

/**
 * 按模板名定位文件。
 *
 * 查找顺序：
 *   1. 文件夹布局：`<workflowDir>/<name>/workflow.yaml`
 *   2. 单层直连：`<workflowDir>/<safeName>.yaml`
 *   3. 扫描全部文件比对文件内的 `name:` 字段
 *
 * @param safeFileName 由调用方注入（service 内部已有实现），避免本模块重复造轮子
 */
export function findWorkflowFile(
  workflowDir: string,
  name: string,
  safeFileName: (s: string) => string,
  readName: (file: string) => string | null,
): WorkflowFileRef | null {
  // ① 文件夹
  const folderEntry = [WORKFLOW_ENTRY, WORKFLOW_ENTRY_ALT]
    .map((n) => join(workflowDir, safeFileName(name), n))
    .find((p) => existsSync(p))
  if (folderEntry)
    return { file: folderEntry, root: dirname(folderEntry), isFolder: true }

  // ② 单层直连
  const direct = join(workflowDir, `${safeFileName(name)}.yaml`)
  if (existsSync(direct))
    return { file: direct, root: workflowDir, isFolder: false }

  // ③ 扫描比对
  for (const ref of listWorkflowFiles(workflowDir)) {
    if (readName(ref.file) === name)
      return ref
  }
  return null
}

/**
 * 解析步骤里的 `script:` 相对路径。
 *
 * 安全约束：只允许落在该工作流自己的 root 之内 —— 禁止 `../` 逃逸到别的技能
 * 或插件根目录。工作流脚本是「该工作流私有」的，越界访问属于配置错误。
 *
 * @returns 绝对路径；非法时抛错（带可读原因）
 */
export function resolveStepScript(root: string, script: string): string {
  const rel = String(script || '').trim()
  if (!rel)
    throw new Error('script 为空')

  if (/^[a-zA-Z]:[\\/]/.test(rel) || rel.startsWith('/') || rel.startsWith('\\'))
    throw new Error(`script 必须是相对路径（相对于工作流目录），收到绝对路径：${rel}`)

  const abs = join(root, rel)
  const normRoot = join(root).toLowerCase().replace(/[\\/]+$/, '')
  const normAbs = join(abs).toLowerCase()

  if (normAbs !== normRoot && !normAbs.startsWith(normRoot + '\\') && !normAbs.startsWith(normRoot + '/'))
    throw new Error(`script 越界（不允许 ../ 逃出工作流目录）：${rel}`)

  if (!existsSync(abs))
    throw new Error(`script 不存在：${rel}（期望路径 ${abs}）`)

  return abs
}

/** 按扩展名判定用哪个解释器 */
export function scriptRunner(file: string): 'node' | 'python' | 'other' {
  if (/\.(?:mjs|cjs|js)$/i.test(file))
    return 'node'
  if (/\.py$/i.test(file))
    return 'python'
  return 'other'
}

/** 便于日志与调试：返回「文件夹名 / 文件名」 */
export function describeRef(ref: WorkflowFileRef): string {
  return ref.isFolder
    ? `${basename(ref.root)}/${basename(ref.file)}`
    : basename(ref.file)
}

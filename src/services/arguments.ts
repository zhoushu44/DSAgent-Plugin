/**
 * 技能输入输出契约（contract.json）—— 每个技能一个独立文件。
 *
 * 目标（对齐原项目「每个技能一个具名输入 + 固定输出」的形态）：
 *   1. 有输入：把技能自己的 argparse 参数固化成具名参数，模型直接看到该技能
 *      的参数表（名字/类型/是否必填/可选值），不再靠统一 args 字符串 + 正则猜。
 *   2. 有输出：把结果协议（`__DSAGENT_RESULT__` / `---[OUTPUT_FILES]`）写进契约，
 *      调用方据此判定「有没有产出」。
 *   3. 隔离：契约是每技能独立文件，改一个技能只动它自己的文件；
 *      **没有契约的技能自动回退到原有的单工具 + 正则路径**，互不影响。
 *
 * 文件位置：`<skillDir>/contract.json`
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolParameter } from '@deepseek-ai/dsh-tools'

/** 契约文件名 */
export const CONTRACT_FILE = 'contract.json'
/** 契约 schema 标识 */
export const CONTRACT_SCHEMA = 'dsagent/skill-contract@1'

export type ContractArgType = 'string' | 'integer' | 'number' | 'boolean' | 'array'

/** 一个具名输入参数 */
export interface ContractArg {
  /** 参数名（命令行 flag 名去 `--`、位置参数名） */
  name: string
  type?: ContractArgType
  description?: string
  /** 必填。位置参数（nargs 不是 ?/*）默认视为必填 */
  required?: boolean
  default?: string | number | boolean
  /** 枚举白名单 */
  choices?: string[]
  /** 位置参数（argparse 里不带 `--flag`） */
  positional?: boolean
  /** argparse nargs，如 `+` / `*` / `?` */
  nargs?: string
  /** 显式 flag 名；缺省按 `--<name>` 推导 */
  flag?: string
  /** argparse.SUPPRESS：不暴露给模型 */
  hidden?: boolean
}

/** 子命令（`python -m pkg <sub> ...` 里的 `<sub>`） */
export interface ContractSubcommand {
  name: string
  description?: string
  args?: ContractArg[]
}

/** 技能契约 */
export interface SkillContract {
  schema: string
  id: string
  entry: {
    form: 'package' | 'script' | 'instructions'
    /** form=package 时的包名 */
    pkg?: string
    /** form=script 时的脚本相对路径，如 `scripts/fetch_data.py` */
    script?: string
  }
  input?: {
    /** 顶层参数。与 subcommands 并存时表示「省略 command 即走这套默认调用」 */
    args?: ContractArg[]
    /** 子命令参数分组。与 args 并存时 command 可省略 */
    subcommands?: ContractSubcommand[]
  }
  output?: {
    /** `dsagent-result`：脚本按 __DSAGENT_RESULT__ 行回传 JSON；`instructions`：正文直传 */
    protocol?: string
    resultPrefix?: string
    filesMarker?: string
    fields?: Record<string, string>
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 校验契约结构 —— 生成器与运行时共用同一套规则，避免「生成的契约运行时读不了」。
 * 返回错误列表（空数组表示合法）。
 */
export function validateContract(c: SkillContract): string[] {
  const errs: string[] = []
  if (!isRecord(c)) return ['契约必须是 JSON 对象']
  if (c.schema !== CONTRACT_SCHEMA) errs.push(`schema 必须是 ${CONTRACT_SCHEMA}（实际 ${String(c.schema)}）`)
  if (typeof c.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(c.id)) errs.push(`id 非法：${String(c.id)}`)
  const entry = c.entry
  const form = entry?.form
  if (form !== 'package' && form !== 'script' && form !== 'instructions') {
    errs.push(`entry.form 非法：${String(form)}`)
  } else if (form === 'package' && !entry.pkg) {
    errs.push('entry.form=package 时必须给 entry.pkg')
  } else if (form === 'script' && !entry.script) {
    errs.push('entry.form=script 时必须给 entry.script')
  }

  const checkArgs = (list: ContractArg[] | undefined, where: string) => {
    const seen = new Set<string>()
    for (const a of list ?? []) {
      const name = a?.name
      if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        errs.push(`${where} 参数名非法：${String(name)}`)
        continue
      }
      if (seen.has(name)) errs.push(`${where} 参数名重复：${name}`)
      seen.add(name)
      if (a.choices !== undefined && !Array.isArray(a.choices)) errs.push(`${where}.${name} 的 choices 必须是数组`)
    }
  }

  // args 与 subcommands 允许并存：并存表示「省略 command 就走 args 那套默认调用」，
  // 对应 __main__.py 里手写分发的形态（`sys.argv[1] == "<sub>" … else: main()`，
  // 如 market-trend 的 inject-report / list-categories）。
  checkArgs(c.input?.args, 'input.args')
  for (const s of c.input?.subcommands ?? []) {
    if (!s || typeof s.name !== 'string' || !s.name) { errs.push('子命令缺 name'); continue }
    checkArgs(s.args, `子命令 ${s.name}`)
  }
  return errs
}

const contractCache = new Map<string, SkillContract | null>()

/**
 * 读取技能契约。文件不存在 / 解析失败 / 校验不通过 → 返回 null（调用方走回退路径）。
 */
export function loadContract(skillDir: string): SkillContract | null {
  const cached = contractCache.get(skillDir)
  if (cached !== undefined) return cached
  let result: SkillContract | null = null
  const file = join(skillDir, CONTRACT_FILE)
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as SkillContract
      const errs = validateContract(parsed)
      if (errs.length) console.warn(`[dsagent] 技能契约无效，已忽略 ${file}：${errs.join('；')}`)
      else result = parsed
    } catch (e) {
      console.warn(`[dsagent] 技能契约解析失败，已忽略 ${file}：${String(e)}`)
    }
  }
  contractCache.set(skillDir, result)
  return result
}

/** 清空契约缓存（技能目录被替换后调用） */
export function clearContractCache(): void {
  contractCache.clear()
}

/**
 * 契约 → 工具名。
 *
 * 用 `dsagent_` 前缀与现有工具保持同一命名空间；若与既有工具重名，
 * 注册方会跳过（既有工具优先，例如 xianyu-publish 已有原生 dsagent_xianyu_publish）。
 */
export function contractToolName(skillId: string): string {
  const slug = skillId.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase()
  return `dsagent_${slug}`
}

/** 参数类型/取值说明 —— ToolParameter 没有 enum，可选值与默认值只能写进描述 */
function argHint(a: ContractArg, required: boolean): string {
  const bits: string[] = []
  if (required) bits.push('必填')
  if (a.type === 'integer') bits.push('整数')
  else if (a.type === 'number') bits.push('数字')
  else if (a.type === 'boolean') bits.push('布尔')
  else if (a.type === 'array' || a.nargs === '+' || a.nargs === '*') bits.push('多值，用空格分隔')
  if (a.choices?.length) bits.push(`可选值：${a.choices.join(' / ')}`)
  if (a.default !== undefined) bits.push(`默认 ${String(a.default)}`)
  return bits.length ? `（${bits.join('；')}）` : ''
}

function toToolParameter(a: ContractArg, required: boolean, markRequired = required): ToolParameter {
  const desc = `${a.description ?? ''}${argHint(a, required)}`
  return {
    type: a.type === 'boolean' ? 'boolean' : 'string',
    ...(markRequired ? { required: true } : {}),
    ...(desc ? { description: desc } : {}),
  }
}

/**
 * 契约 → DSH 工具参数表。
 *
 * 有子命令时额外暴露一个 `command` 参数，并把顶层参数与各子命令的参数按名合并。
 * 顶层参数与子命令**可以并存**（`__main__.py` 手写分发的形态：命中子命令走子命令，
 * 否则走默认调用），并存时 `command` 可省略；此时没有任何参数是所有路径都必填，
 * 因此一律只保留「必填」文字提示、不打 required 标记，缺参由 buildContractArgv
 * 按所选路径给出可读报错。
 */
export function contractToolParameters(c: SkillContract): Record<string, ToolParameter> {
  const params: Record<string, ToolParameter> = {}
  const subs = c.input?.subcommands
  const rootArgs = c.input?.args ?? []
  if (subs && subs.length > 0) {
    const hasDefault = rootArgs.length > 0
    params.command = {
      type: 'string',
      ...(hasDefault ? {} : { required: true }),
      description: `子命令${hasDefault ? '（可选，省略即执行默认调用）' : '（必填）'}：${subs.map(s => `${s.name}${s.description ? `＝${s.description}` : ''}`).join('；')}`,
    }
    const merged = new Map<string, ContractArg>()
    for (const a of rootArgs) if (!a.hidden) merged.set(a.name, a)
    for (const s of subs) {
      for (const a of s.args ?? []) {
        if (!a.hidden && !merged.has(a.name)) merged.set(a.name, a)
      }
    }
    for (const [name, a] of merged) params[name] = toToolParameter(a, !!a.required, false)
  } else {
    for (const a of rootArgs) {
      if (a.hidden) continue
      params[a.name] = toToolParameter(a, !!a.required)
    }
  }
  return params
}

/**
 * 契约 + 工具入参 → argv（不含解释器与入口）。
 *
 * 与 `skill-service.buildCommand` 的「正则猜」不同，这里只做映射与校验：
 * 缺必填 / 子命令非法 / 枚举越界都直接抛错，由工具层转成模型可读的失败文案。
 */
export function buildContractArgv(c: SkillContract, args: Record<string, unknown>): string[] {
  const subs = c.input?.subcommands
  const rootArgs = c.input?.args ?? []
  let defs: ContractArg[]
  const head: string[] = []
  if (subs && subs.length > 0) {
    const name = String(args.command ?? '').trim()
    if (!name) {
      // 省略 command → 走顶层参数那套默认调用（对应 __main__.py 的 `else: main()`）
      if (rootArgs.length === 0) {
        throw new Error(`缺少子命令 command；可选：${subs.map(s => s.name).join('、')}`)
      }
      defs = rootArgs
    } else {
      const sub = subs.find(s => s.name === name)
      if (!sub) {
        const allowed = subs.map(s => s.name).join('、')
        throw new Error(`子命令「${name}」不存在；可选：${allowed}`)
      }
      head.push(sub.name)
      defs = sub.args ?? []
    }
  } else {
    defs = rootArgs
  }

  const positionals: string[] = []
  const flags: string[] = []
  for (const a of defs) {
    if (a.hidden) continue
    const raw = args[a.name]
    const provided = raw !== undefined && raw !== null && String(raw).trim() !== ''
    if (!provided) {
      if (a.required) throw new Error(`缺少必填参数「${a.name}」${a.description ? `（${a.description}）` : ''}`)
      continue
    }
    if (a.type === 'boolean' && !a.positional) {
      const truthy = raw === true || String(raw).toLowerCase() === 'true' || String(raw) === '1'
      if (truthy) flags.push(a.flag ?? `--${a.name}`)
      continue
    }
    const values = (Array.isArray(raw) ? raw : [raw]).map(v => String(v))
    if (a.choices?.length) {
      for (const v of values) {
        if (!a.choices.includes(v)) throw new Error(`参数「${a.name}」取值非法：${v}；可选：${a.choices.join(' / ')}`)
      }
    }
    if (a.positional) positionals.push(...values)
    else flags.push(a.flag ?? `--${a.name}`, ...values)
  }
  return [...head, ...positionals, ...flags]
}

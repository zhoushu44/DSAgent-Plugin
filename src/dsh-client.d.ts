/**
 * Ambient type declarations for DSH Desktop browser-side SDK services.
 *
 * These packages are provided by the DSH Desktop runtime at bundle time —
 * they are not npm packages and exist only in the browser half of a DSH plugin.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
// React 由 DSH 运行时注入，构建时不安装 react 包
type AnyComponent = any

interface SlotRegistrationOptions {
  name: string
  id?: string
  key?: string
  order?: number
  label?: string | (() => string)
  locale?: string
  priority?: number
  select?: (owner: unknown) => unknown | null
  children?: Record<string, unknown>
  store?: () => unknown
  inject?: (...args: unknown[]) => object
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    effect: (callback: () => (() => void) | void, name?: string) => (() => void) | void
    locale: {
      register(namespace: string, table: Record<string, Record<string, string>>): void
      bind(namespace: string): (key: string, ...args: unknown[]) => string
    }
    slots: {
      register(options: SlotRegistrationOptions, component: AnyComponent): () => void
      inject(key: string, callback: () => (() => void) | Iterable<() => void>): () => void
    }
    systemPrompt: {
      section(opts: { name: string; order: number; text: any }): () => void
    }
    tools: {
      register(tool: unknown): () => void
    }
    /**
     * 宿主 LLM 服务（`@deepseek-ai/dsh-llm` 注册名 `llm`）。
     * 用 `ctx.llm.stream()` 直接调用「用户在 DSH 里选的聊天模型」，无需任何 API Key。
     * 宿主测试桩可能不提供该服务，读取处务必防御（可选链 / `ctx.get('llm', false)`）。
     */
    llm: {
      stream(options: LlmStreamOptions): AsyncIterable<LlmStreamChunk>
      listProviders(): Array<{ id: string; name?: string }>
      listModels(provider: string): Promise<Array<{ id: string; name?: string }>>
    }
  }
}

/** `ctx.llm.stream()` 入参（官方 GenerateOptions 的最小子集）。 */
interface LlmStreamOptions {
  provider: string
  model: string
  /** 系统提示词（字符串形式） */
  system?: string
  messages: Array<{ role: string; content: Array<{ type: string; text: string }> }>
  temperature?: number
  maxTokens?: number
  stop?: string[]
  signal?: AbortSignal
}

/**
 * 流式分片。`finish` 是每流的唯一终止分片：
 * 失败 `{ kind: 'error', failure: { code, message } }`、取消 `{ kind: 'aborted', failure }`。
 */
interface LlmStreamChunk {
  type: 'block-start' | 'text-delta' | 'reasoning-delta' | 'tool-call-delta' | 'block-end' | 'usage' | 'finish'
  index?: number
  text?: string
  block?: unknown
  reason?: { kind: string; failure?: { code: string; message: string } }
  [key: string]: unknown
}

declare module '@deepseek-ai/dsh-tools' {
  /** 会话 id。运行时形如 `session-1`（不是 uuid）。 */
  export type SessionId = string
  /** 当前调用所属的智能体（= 会话）。 */
  export interface Agent {
    readonly id: SessionId
  }
  /** 工具执行的只读上下文（官方 ToolExecutionInput 的扁平化声明）。 */
  export interface ToolRunContext {
    readonly callId: string
    readonly rootCallId?: string
    readonly name: string
    readonly arguments: unknown
    /** 无智能体归属的调用（如宿主内部调用）时为 undefined。 */
    readonly agent?: Agent
    readonly signal: AbortSignal
    deferContext(context: unknown): void
    concludeTurn(): void
  }
  export interface ToolParameter {
    type: string
    description?: string
    required?: boolean
  }
  export interface ToolOutput {
    schema: { type: string }
    render: (args: unknown, value: unknown) => Array<{ type: string; text: string }>
  }
  export interface ToolDefinition {
    name: string
    description: string
    parameters?: Record<string, ToolParameter>
    output?: ToolOutput
    execute: (args: any, exec: ToolRunContext) => Promise<unknown>
  }
  export function defineTool(def: ToolDefinition): ToolDefinition
}

declare module '@deepseek-ai/dsh-client-locale/client' {}
declare module '@deepseek-ai/dsh-client-ui-renderer/client' {}

/**
 * 宿主 LLM 包（`@deepseek-ai/dsh-llm`）。
 * 与 `@deepseek-ai/dsh-tools` 同样：运行时由宿主提供（模块回退），构建期靠本声明。
 * 这里只声明插件用到的 `BlockAssembler` —— 官方把流式分片拼成内容块的规范算法。
 */
declare module '@deepseek-ai/dsh-llm' {
  export interface LlmBlock {
    type: string
    text?: string
    id?: string
    name?: string
    arguments?: string
  }
  export interface LlmFinish {
    kind: string
    failure?: { code: string; message: string }
  }
  export class BlockAssembler {
    push(chunk: unknown): void
    blocks(): LlmBlock[]
    readonly finish: LlmFinish
    readonly usage: unknown
  }
}

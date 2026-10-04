/**
 * 共享类型定义 —— host 半区和 browser 半区共用
 */

/**
 * 账号状态。
 *
 * ★ `expired` 与 `reauth_required` 的分工（吸收 Accio 的 `error` / `reconnect_required` 二分）：
 *
 *   | 状态               | 含义                                             | 正确引导           |
 *   |--------------------|--------------------------------------------------|--------------------|
 *   | `valid`            | 正常可用                                          | 直接用             |
 *   | `pending`          | 已建条目、尚未完成首次登录校验                     | 引导完成登录       |
 *   | `expired`          | 登录态**疑似**失效（探测失败计数中/历史遗留标记）  | 可先重试，再重登   |
 *   | `reauth_required`  | 已确认**必须人工重新登录**，重试无用               | 直接引导重新登录   |
 *   | `invalid`          | Cookie 结构不完整/已损坏，不可恢复                 | 删除并重新添加     |
 *
 * 为什么要把后两者分开：`expired` 只表示「探测到疑似失效」，此时重试或换个网络
 * 仍可能成功；而 `reauth_required` 是**连续失败达阈值后的确定结论**，重试纯属浪费。
 * 把两者混成一个状态，模型只能给出模糊的「登录态已过期」，用户于是反复重试而不是去重登。
 */
export type AccountStatus = 'valid' | 'expired' | 'reauth_required' | 'invalid' | 'pending'

/** 鉴权方式 */
export type AuthType = 'cookie' | 'apikey'

/**
 * 失败类型枚举（吸收 QIWork 的 failure_kind 设计）。
 * 让 LLM 能区分"让用户重登"还是"稍后重试"。
 */
export type FailureKind =
  | 'not_bound'        // 平台未绑定账号 → 引导用户去「账号连接」页面
  | 'need_account_choice' // 平台有多个可用账号且当前会话未绑定 → 把账号列表交给模型问用户
  | 'token_expired'    // 登录态过期 → 引导用户重新登录
  | 'risk_control'     // 被风控拦截 → 提示用户去平台完成验证
  | 'rate_limit'       // 接口限流 → 建议稍后重试
  | 'no_permission'    // 登录态有效但账号无该业务/类目权限 → 引导换有权限的账号，不是重登
  | 'api_error'        // 平台 API 返回错误 → 展示错误信息
  | 'parse_error'      // 响应解析失败 → 展示原始返回
  | 'skill_not_found'  // 技能 ID 不存在 → 列出可用技能
  | 'skill_error'      // 技能脚本执行失败 → 展示 stderr
  | 'unknown'          // 未知错误

/**
 * 多账号待选时回给模型的候选账号（不含任何 Cookie 内容）。
 * 模型据此向用户提问「用哪个账号」，用户选定后把 shopKey 传回工具即可。
 */
export interface AccountChoice {
  /** 凭证库主键，模型回传时必须用它，不能用 accountId */
  shopKey: string
  platformId: string
  accountId: string
  nickname: string
  status: AccountStatus
}

export interface AccountRow {
  /** 凭证库主键 {platform}_{accountId}，绑定/删除必须用它，不能用 accountId */
  shopKey: string
  accountId: string
  platformId: string
  nickname: string
  platformUid: string
  status: AccountStatus
  lastCheckAt: string
  syncServices: string[]
  boundAgentName: string
  /** 已绑定的会话（智能体）ID 列表；'default' 表示平台默认账号 */
  boundAgentIds?: string[]
  expireReason?: string | null
  /** 鉴权方式，默认 'cookie' */
  authType?: AuthType
  /** API Key 账号的 AppID（仅 auth_type=apikey 时有值） */
  appId?: string
  /** API Key 账号的掩码 Secret（如 wx12••••） */
  secretHint?: string
}

export interface HealthRow {
  platformId: string
  nickname: string
  status: AccountStatus
  reason?: string
}

export interface BindingContext {
  /** 凭证库主键，格式 `${platform}_${account_id}`（与 store.shop_key 一致） */
  shopKey: string
  /** 会话状态提示：ok / risk_control / expired / none */
  sessionHint: string
  displayLabel: string
  tbToken?: string | null
  platformId: string
  accountId: string
  nickname: string
  /** 非正常态时的失败类型（need_account_choice 时 choices 为候选账号） */
  failureKind?: FailureKind
  /** need_account_choice 时的候选账号（不含 Cookie），交给模型问用户 */
  choices?: AccountChoice[]
}

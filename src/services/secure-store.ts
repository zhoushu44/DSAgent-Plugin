/**
 * 凭证文件加密层 —— 为 `dsagent-accounts.json` 提供「静态加密」。
 *
 * ## 为什么需要
 *
 * 凭证库里存的是 `cookies` / `cookie_str` / `app_secret` —— 等同于账号的登录态。
 * 加密前它们以明文 JSON 落盘，同一台机器上的**任何进程**都能直接读走：
 *
 *     { "accounts": { "taobao_2218891961201": { "cookies": { "unb": "...", ... } } } }
 *
 * 这不是理论风险：任何一次「顺手把配置目录打包发出去」或「备份到网盘」都会连带泄露账号。
 *
 * ## 与 Accio 的对应关系（本模块的移植来源）
 *
 * Accio 的 `ElectronSafeAuthStorage` 有四个特征，本模块逐条对齐：
 *   1. 三种模式 `auto / safe / plaintext`，可用环境变量锁定；
 *   2. 主路径加密，但**读到旧明文会自动迁移**成密文（不要求用户手动处理）；
 *   3. 失败要带 **reason code**（`safe_unavailable` / `decrypt_failed` / `parse_failed` /
 *      `invalid_credentials`），绝不静默当空库 —— 静默空库会让用户「账号凭空消失」；
 *   4. 硬失效标记文件：一旦置上，`load()` 直接返回 null，强制重新登录。
 *
 * ★ 差异点（必须说明，避免误判安全等级）：Accio 跑在 Electron 里，能直接用
 * `safeStorage`（Windows 走 DPAPI、macOS 走 Keychain）——密钥由**操作系统**托管，
 * 属于「同机同用户可解、换机器/换用户不可解」。
 *
 * 本插件跑在 DSH 宿主（普通 Node 进程）里，**没有**这层 OS 托管能力，所以改用
 * 「机器标识 + 随机盐」在本地派生密钥。安全性对照：
 *
 *   | 场景                                   | DPAPI（Accio） | 本模块 |
 *   |----------------------------------------|----------------|--------|
 *   | 单看 json 文件内容                     | 不可读         | 不可读 |
 *   | 把 json 拷到别的机器 / 网盘            | 不可读         | 不可读 |
 *   | 同机同用户的另一个进程（拿到密钥文件） | 可读           | 可读   |
 *   | 拿到密钥文件但换机器                   | 不可读         | 不可读 |
 *
 * 即：挡得住「文件外流」和「顺手一看」，**挡不住**「本机已提权的恶意进程」。
 * 要做到后者必须引入 OS 密钥托管（需原生模块），当前不引入 —— 但本模块的
 * `mode` 与 reason code 已经把接口留好，日后换成 DPAPI/keychain 实现时
 * 上层调用方**无需改动**。
 *
 * ## 主密钥派生
 *
 *     masterKey = HKDF-SHA256(ikm = machineIdentity, salt = keyFile.salt, info = DOMAIN, len = 32)
 *
 * `machineIdentity` 按平台取（见 `machineIdentityCandidates()`），**保留多个候选**并按
 * `verify` 校验逐个试 —— 因为机器标识源可能在某次启动时读不到（如注册表不可访问），
 * 若只认单一来源，一次读取失败就会导致「全部账号解密失败」，退化成强制重登。
 * 候选链 + verify 校验让这种情况自动降级到次优来源，密钥仍然一致。
 *
 * `keyFile`（`dsagent-accounts.key`，mode 0600）只存随机盐与校验值，**不存密钥本身**。
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execSync } from 'node:child_process'

// ── 对外类型 ────────────────────────────────────────────────

/** 存储模式：auto=能加密就加密（默认）/ safe=必须加密 / plaintext=强制明文（排障用） */
export type StorageMode = 'auto' | 'safe' | 'plaintext'

/**
 * 加载失败原因（对应 Accio 的 reason code）。
 * 调用方据此给出**不同**的用户引导，而不是笼统的「读取失败」。
 */
export type LoadFailureReason =
  /** 文件/密钥文件不存在 —— 首次使用，正常态，不是错误 */
  | 'not_found'
  /** 要求加密但本机无法派生密钥（密钥文件损坏/权限不足） */
  | 'safe_unavailable'
  /** 密文解不开 —— 换机器/换用户/密钥文件被替换，需重新登录 */
  | 'decrypt_failed'
  /** JSON 解析失败 —— 文件被写坏 */
  | 'parse_failed'
  /** 结构合法但不是凭证库形态（缺 accounts 字段） */
  | 'invalid_credentials'
  /** 硬失效标记存在 —— 用户/系统要求强制重新登录 */
  | 'invalidated'

/** 解密/解析结果：成功给凭据，失败给 reason code（绝不抛异常，避免调用方崩在启动路径上） */
export type DecodeResult<T> =
  | { ok: true; data: T; /** 数据来自旧明文，调用方应择机回写为密文 */ migrated: boolean }
  | { ok: false; reason: LoadFailureReason; detail?: string }

// ── 常量 ────────────────────────────────────────────────────

const ENVELOPE_VERSION = 1
const ALGO = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
const SALT_BYTES = 32
/** HKDF info 串：把本用途的密钥与其他用途隔离开（域分离） */
const KDF_INFO = 'dsagent.credentials.v1'
/** 密钥文件里的自校验串：用来判定「派生出的密钥是否正确」 */
const KDF_VERIFY_LABEL = 'dsagent.credentials.keycheck.v1'

/** 环境变量：强制存储模式 */
const MODE_ENV = 'DSAGENT_CREDENTIALS_MODE'
/** 环境变量：覆盖密钥文件路径（测试/多环境隔离用） */
const KEYFILE_ENV = 'DSAGENT_CREDENTIALS_KEYFILE'
/** 环境变量：显式提供主密钥（hex 或 base64，32 字节），优先级最高（CI/容器场景） */
const MASTERKEY_ENV = 'DSAGENT_CREDENTIALS_KEY'

/** 加密信封的磁盘形态：仍是 JSON，便于排障时肉眼确认「这是密文而非明文」 */
interface Envelope {
  /** 信封版本，日后换算法时据此分支 */
  v: number
  /** 算法标识 */
  alg: string
  /** base64 IV */
  iv: string
  /** base64 GCM 认证标签 */
  tag: string
  /** base64 密文 */
  data: string
  /** 密钥来源指纹（仅用于排障，不泄露密钥） */
  kid: string
}

/** 密钥文件磁盘形态：只放盐与校验值，**不放密钥** */
interface KeyFile {
  v: number
  salt: string
  /** base64 HMAC(masterKey, KDF_VERIFY_LABEL)，用于验证派生结果 */
  verify: string
}

// ── 模式与可用性 ────────────────────────────────────────────

let _modeCache: StorageMode | null = null

/** 当前存储模式。环境变量非法值时退回 auto（不因配置笔误拒绝启动）。 */
export function getStorageMode(): StorageMode {
  if (_modeCache) return _modeCache
  const raw = (process.env[MODE_ENV] ?? 'auto').trim().toLowerCase()
  _modeCache = raw === 'safe' || raw === 'plaintext' ? raw : 'auto'
  return _modeCache
}

/** 仅供测试：清空模式缓存，让环境变量改动生效 */
export function resetStorageModeCache(): void {
  _modeCache = null
}

/** 密钥文件路径：与凭证文件同目录，避免跨目录权限问题 */
export function keyFilePathFor(storePath: string): string {
  const override = (process.env[KEYFILE_ENV] ?? '').trim()
  if (override) return override
  return path.join(path.dirname(storePath), 'dsagent-accounts.key')
}

/** 硬失效标记路径（对应 Accio 的 `auth-session-invalidated`） */
export function invalidationPathFor(storePath: string): string {
  return path.join(path.dirname(storePath), 'dsagent-accounts.invalidated')
}

// ── 机器标识 ────────────────────────────────────────────────

let _identityCache: string[] | null = null
/** MachineGuid 读取结果缓存（注册表读取要起进程，只做一次） */
let _winGuidCache: string | null | undefined

/**
 * Windows 注册表 MachineGuid。**不可读时返回 null**（不回退成空串，
 * 否则会让「读不到」和「读到了空值」派生出相同密钥，掩盖问题）。
 *
 * 用 `reg query` 而非原生模块：不引入编译依赖。加 2s 超时避免拖慢启动。
 */
function windowsMachineGuid(): string | null {
  if (_winGuidCache !== undefined) return _winGuidCache
  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { stdio: 'pipe', timeout: 2000, encoding: 'utf8', windowsHide: true },
    )
    const m = String(out).match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/)
    _winGuidCache = m ? m[1].toLowerCase() : null
  } catch {
    _winGuidCache = null
  }
  return _winGuidCache
}

/**
 * 机器标识候选链（**按优先级**，解密时逐个试直到 verify 命中）。
 *
 * 多候选是刻意的：任一来源在某次启动中读不到时，只要有一个还能读到，
 * 密钥就能派生出来，账号不会集体「解密失败」。首个候选（`primary`）用于**新建**密钥文件。
 */
export function machineIdentityCandidates(): string[] {
  if (_identityCache) return _identityCache
  const list: string[] = []
  const push = (s: string | null | undefined) => {
    const v = (s ?? '').trim()
    if (v && !list.includes(v)) list.push(v)
  }

  if (process.platform === 'win32') {
    const guid = windowsMachineGuid()
    if (guid) push(`win:${guid}`)
  } else if (process.platform === 'darwin') {
    try {
      const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', {
        stdio: 'pipe', timeout: 2000, encoding: 'utf8',
      })
      const m = String(out).match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)
      if (m) push(`mac:${m[1]}`)
    } catch { /* 忽略，走兜底候选 */ }
  } else {
    try {
      const id = fs.readFileSync('/etc/machine-id', 'utf-8').trim()
      if (id) push(`linux:${id}`)
    } catch { /* 忽略 */ }
  }

  // 兜底：主机名 + 用户名 + home。稳定性弱于机器标识，但好过完全没有。
  try {
    const u = os.userInfo()
    push(`fallback:${os.hostname()}:${u.username}:${u.homedir}`)
  } catch {
    push(`fallback:${os.hostname()}`)
  }

  _identityCache = list
  return list
}

/** 仅供测试：清空机器标识缓存 */
export function resetMachineIdentityCache(): void {
  _identityCache = null
  _winGuidCache = undefined
}

// ── 密钥派生 ────────────────────────────────────────────────

function deriveKey(identity: string, salt: Buffer): Buffer {
  return Buffer.from(
    crypto.hkdfSync('sha256', Buffer.from(identity, 'utf-8'), salt, Buffer.from(KDF_INFO, 'utf-8'), KEY_BYTES),
  )
}

function verifyToken(key: Buffer): string {
  return crypto.createHmac('sha256', key).update(KDF_VERIFY_LABEL).digest('base64')
}

/** 显式主密钥（环境变量）——存在即绕过机器标识派生 */
function explicitMasterKey(): Buffer | null {
  const raw = (process.env[MASTERKEY_ENV] ?? '').trim()
  if (!raw) return null
  try {
    const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64')
    return buf.length === KEY_BYTES ? buf : null
  } catch {
    return null
  }
}

function readKeyFile(p: string): KeyFile | null {
  try {
    if (!fs.existsSync(p)) return null
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'))
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.salt !== 'string' || typeof parsed.verify !== 'string') return null
    return { v: Number(parsed.v) || 1, salt: parsed.salt, verify: parsed.verify }
  } catch {
    return null
  }
}

function writeKeyFile(p: string, data: KeyFile): void {
  const dir = path.dirname(p)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(p)}.${crypto.randomBytes(6).toString('hex')}.tmp`)
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, p)
  } catch (err) {
    try { fs.unlinkSync(tmp) } catch { /* 忽略 */ }
    throw err
  }
  // rename 之后补一次 chmod：Windows 上 mode 参数不生效，POSIX 上确保不被 umask 放宽
  try { fs.chmodSync(p, 0o600) } catch { /* 平台不支持则忽略 */ }
}

/**
 * 取主密钥。返回值里带 `created` —— 新建密钥文件时调用方需要知道
 * 「此刻磁盘上还没有密文」，从而不把「本文件没用」误报成解密失败。
 *
 * 失败返回 null（调用方按 safe_unavailable 处理），**不抛异常**。
 */
function resolveMasterKey(storePath: string): { key: Buffer; kid: string; created: boolean } | null {
  const explicit = explicitMasterKey()
  if (explicit) {
    return { key: explicit, kid: 'explicit', created: false }
  }

  const kp = keyFilePathFor(storePath)
  let kf = readKeyFile(kp)
  let created = false

  if (!kf) {
    const identities = machineIdentityCandidates()
    const primary = identities[0]
    if (!primary) return null
    const salt = crypto.randomBytes(SALT_BYTES)
    const key = deriveKey(primary, salt)
    kf = { v: 1, salt: salt.toString('base64'), verify: verifyToken(key) }
    try {
      writeKeyFile(kp, kf)
      created = true
    } catch {
      // 密钥文件写不进去（只读盘/权限不足）→ 本次无法提供加密能力
      return null
    }
    return { key, kid: fingerprint(primary), created }
  }

  const salt = Buffer.from(kf.salt, 'base64')
  for (const identity of machineIdentityCandidates()) {
    const key = deriveKey(identity, salt)
    if (verifyToken(key) === kf.verify) {
      return { key, kid: fingerprint(identity), created: false }
    }
  }
  // 所有候选都验不过 —— 换机器/换用户/密钥文件被替换
  return null
}

/** 机器标识的短指纹，仅用于排障展示，不可逆推原文 */
function fingerprint(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 12)
}

// ── 加解密 ──────────────────────────────────────────────────

/** 加密是否可用（不产生副作用：能拿到密钥文件或环境变量密钥即可） */
export function isEncryptionAvailable(storePath: string): boolean {
  try {
    return resolveMasterKey(storePath) !== null
  } catch {
    return false
  }
}

/** 明文 → 信封 JSON 字符串 */
function seal(plaintext: string, storePath: string): string {
  const mk = resolveMasterKey(storePath)
  if (!mk) throw new Error('safe_unavailable: 无法派生出凭证加密密钥')
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGO, mk.key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const envelope: Envelope = {
    v: ENVELOPE_VERSION,
    alg: ALGO,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: enc.toString('base64'),
    kid: mk.kid,
  }
  return JSON.stringify(envelope, null, 2)
}

/** 信封 JSON 字符串 → 明文 */
function unseal(raw: string, storePath: string): { ok: true; plaintext: string } | { ok: false; reason: LoadFailureReason; detail?: string } {
  let envelope: Envelope
  try {
    envelope = JSON.parse(raw)
  } catch (err) {
    return { ok: false, reason: 'parse_failed', detail: String(err) }
  }
  if (!envelope || typeof envelope.data !== 'string' || typeof envelope.iv !== 'string' || typeof envelope.tag !== 'string') {
    return { ok: false, reason: 'parse_failed', detail: '信封字段缺失' }
  }

  const mk = resolveMasterKey(storePath)
  if (!mk) return { ok: false, reason: 'safe_unavailable', detail: '无法派生密钥（换机器或密钥文件丢失）' }

  try {
    const decipher = crypto.createDecipheriv(ALGO, mk.key, Buffer.from(envelope.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    const dec = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()])
    return { ok: true, plaintext: dec.toString('utf-8') }
  } catch (err) {
    // GCM 认证失败 = 密钥不对或密文被改
    return { ok: false, reason: 'decrypt_failed', detail: String(err) }
  }
}

// ── 对外统一入口 ────────────────────────────────────────────

/** 磁盘内容是否为加密信封（结构判别，不解密） */
export function isEnvelope(raw: unknown): boolean {
  if (typeof raw !== 'string') return false
  const t = raw.trim()
  if (!t.startsWith('{')) return false
  try {
    const o = JSON.parse(t)
    return !!(o && typeof o === 'object' && typeof o.data === 'string' && typeof o.iv === 'string' && typeof o.tag === 'string')
  } catch {
    return false
  }
}

/**
 * 加载并解码凭证文件。
 *
 * 与 Accio `loadAuto()` 同构的三段式：
 *   ① 硬失效标记存在 → 直接 `invalidated`（不读盘）
 *   ② 能加密 → 按信封解；解不开**才**看是不是旧明文（迁移路径）
 *   ③ 不能加密（safe 模式外）→ 直接当明文读
 *
 * ★ 顺序很关键：必须**先**试信封再试明文。反过来的话，一个加密文件会被
 * 明文路径读成 parse_failed，用户看到的是「文件损坏」而不是「需要重登」。
 */
export function decodeCredentialsFile<T>(
  storePath: string,
  validate: (o: unknown) => T | null,
): DecodeResult<T> {
  // ① 硬失效标记
  if (fs.existsSync(invalidationPathFor(storePath))) {
    return { ok: false, reason: 'invalidated' }
  }

  let raw: string
  try {
    if (!fs.existsSync(storePath)) return { ok: false, reason: 'not_found' }
    raw = fs.readFileSync(storePath, 'utf-8')
  } catch (err) {
    return { ok: false, reason: 'parse_failed', detail: String(err) }
  }

  if (!raw.trim()) return { ok: false, reason: 'not_found' }

  const mode = getStorageMode()

  // ② 加密路径
  if (mode !== 'plaintext') {
    if (isEnvelope(raw)) {
      const un = unseal(raw, storePath)
      if (!un.ok) return { ok: false, reason: un.reason, detail: un.detail }
      return finishParse(un.plaintext, validate, false)
    }
    // 不是信封 → 旧明文，走迁移
    const parsed = finishParse(raw, validate, true)
    if (parsed.ok) return parsed
    // 明文解析也失败：若还能派生密钥，说明这既不是信封也不是合法明文
    return parsed
  }

  // ③ 强制明文模式
  return finishParse(raw, validate, false)
}

function finishParse<T>(
  plaintext: string,
  validate: (o: unknown) => T | null,
  migrated: boolean,
): DecodeResult<T> {
  let obj: unknown
  try {
    obj = JSON.parse(plaintext)
  } catch (err) {
    return { ok: false, reason: 'parse_failed', detail: String(err) }
  }
  const data = validate(obj)
  if (data === null) return { ok: false, reason: 'invalid_credentials' }
  return { ok: true, data, migrated }
}

/**
 * 把凭证对象编码成待落盘字符串。
 *
 * `auto` 模式下密钥不可得时**退回明文**（并返回 encrypted=false 让调用方可以告警）——
 * 宁可明文可用，也不要因为环境缺机器标识就让整个插件无法保存账号。
 * `safe` 模式下密钥不可得则抛错（显式要求加密的部署应当失败得响）。
 */
export function encodeCredentials(
  storePath: string,
  data: unknown,
): { payload: string; encrypted: boolean; reason?: string } {
  const mode = getStorageMode()
  const plaintext = JSON.stringify(data, null, 2)

  if (mode === 'plaintext') return { payload: plaintext, encrypted: false }

  try {
    return { payload: seal(plaintext, storePath), encrypted: true }
  } catch (err) {
    if (mode === 'safe') throw err
    return { payload: plaintext, encrypted: false, reason: String(err) }
  }
}

// ── 硬失效标记 ──────────────────────────────────────────────

/** 置上硬失效标记：此后 `decodeCredentialsFile` 一律返回 invalidated，直到清除 */
export function markInvalidated(storePath: string): void {
  const p = invalidationPathFor(storePath)
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, new Date().toISOString(), 'utf-8')
  } catch { /* 标记写不进去不该阻断主流程 */ }
}

/** 清除硬失效标记（用户成功重新登录后调用） */
export function clearInvalidated(storePath: string): void {
  try { fs.unlinkSync(invalidationPathFor(storePath)) } catch { /* ENOENT 即目标状态 */ }
}

export function isInvalidated(storePath: string): boolean {
  return fs.existsSync(invalidationPathFor(storePath))
}

// ── 供排障/迁移脚本复用的低层能力 ───────────────────────────

/** 列出已知的密钥文件路径（主路径 + 环境变量覆盖），用于「换机器后恢复」类脚本排查 */
export function knownKeyFilePaths(storePath: string): string[] {
  const set = new Set<string>([keyFilePathFor(storePath)])
  const home = (() => { try { return os.homedir() } catch { return '' } })()
  if (home) set.add(path.join(home, '.dsh', 'dsagent-accounts.key'))
  return [...set]
}

export const __internals = { seal, unseal, deriveKey, verifyToken, resolveMasterKey, fingerprint }

// Browser-side stub for Node.js built-in modules.
// These modules are used by credential-store.ts / skill-service.ts / secure-store.ts,
// which only run in the host half-zone. In the browser bundle they are no-ops.
//
// ★ 注意：esbuild 对 `import * as fs from 'node:fs'` + `fs.mkdir(...)` 这类具名访问
//   要求 stub 必须导出对应名字，否则会直接报
//   `No matching export in "dev/node-stub.js" for import "mkdir"` 而使构建失败
//   （这会截断 lib/client.js 产物）。因此这里对 host 半区用到的 Node API 做**全量兜底导出**，
//   避免每次 host 侧新增一个 Node 调用就打断客户端构建。

export default {}

const noop = () => {}
const noopAsync = async () => {}

// ── fs ──────────────────────────────────────────────────────────────
export const readdir = async () => []
export const readdirSync = () => []
export const readFile = async () => ''
export const readFileSync = () => ''
export const writeFile = async () => {}
export const writeFileSync = noop
export const appendFile = async () => {}
export const appendFileSync = noop
export const mkdir = async () => {}
export const mkdirSync = noop
export const rmdir = async () => {}
export const rmdirSync = noop
export const rm = async () => {}
export const rmSync = noop
export const unlink = async () => {}
export const unlinkSync = noop
export const copyFile = async () => {}
export const copyFileSync = noop
export const rename = async () => {}
export const renameSync = noop
export const stat = async () => ({ isDirectory: () => false, isFile: () => false, mtimeMs: 0, size: 0 })
export const statSync = () => ({ isDirectory: () => false, isFile: () => false, mtimeMs: 0, size: 0 })
export const lstat = async () => ({ isDirectory: () => false, isFile: () => false, mtimeMs: 0, size: 0 })
export const lstatSync = () => ({ isDirectory: () => false, isFile: () => false, mtimeMs: 0, size: 0 })
export const existsSync = () => false
export const chmod = async () => {}
export const chmodSync = noop
export const access = async () => {}
export const accessSync = noop
export const realpath = async (p) => p
export const realpathSync = (p) => p
export const createReadStream = () => ({ on: noop, pipe: noop })
export const createWriteStream = () => ({ on: noop, write: noop, end: noop })
export const watch = () => ({ close: noop, on: noop })
export const promises = {}

// ── fs/promises ─────────────────────────────────────────────────────
export const open = async () => ({ close: noopAsync, readFile: async () => '', writeFile: noopAsync })
export const cp = async () => {}
export const chown = async () => {}
export const utimes = async () => {}
export const constants = {}

// ── path ────────────────────────────────────────────────────────────
export const join = (...a) => a.join('/')
export const resolve = (...a) => a.join('/')
export const sep = '/'
export const delimiter = ';'
export const extname = (p) => { const i = String(p).lastIndexOf('.'); return i >= 0 ? String(p).slice(i) : '' }
export const basename = (p) => String(p).split('/').pop() || ''
export const dirname = (p) => { const i = String(p).lastIndexOf('/'); return i >= 0 ? String(p).slice(0, i) : '.' }
export const relative = (a, b) => String(b)
export const normalize = (p) => String(p)
export const isAbsolute = (p) => String(p).startsWith('/')
export const parse = (p) => ({ root: '', dir: '', base: String(p), ext: '', name: String(p) })
export const format = (o) => String(o?.base ?? '')
export const toNamespacedPath = (p) => String(p)

// ── child_process ───────────────────────────────────────────────────
export const spawn = () => ({ on: noop, kill: noop, stdout: null, stderr: null })
export const spawnSync = () => ({ status: 0, stdout: '', stderr: '' })
export const exec = (_c, cb) => { if (typeof cb === 'function') cb(null, '', ''); return { on: noop } }
export const execSync = () => ''
export const execFile = (_f, _a, cb) => { if (typeof cb === 'function') cb(null, '', ''); return { on: noop } }
export const execFileSync = () => ''

// ── crypto ──────────────────────────────────────────────────────────
// host 半区专用；browser 半区不会真正调用，返回占位对象即可。
const fakeHash = () => ({ update: () => fakeHash(), digest: () => '' })
export const randomBytes = (n) => new Uint8Array(n)
export const randomUUID = () => '00000000-0000-4000-8000-000000000000'
export const createHash = () => fakeHash()
export const createHmac = () => fakeHash()
export const createCipheriv = () => ({ update: () => Buffer?.alloc?.(0) ?? new Uint8Array(0), final: () => new Uint8Array(0), getAuthTag: () => new Uint8Array(0) })
export const createDecipheriv = () => ({ update: () => new Uint8Array(0), final: () => new Uint8Array(0), setAuthTag: noop })
export const hkdfSync = () => new Uint8Array(32)
export const pbkdf2Sync = () => new Uint8Array(32)
export const timingSafeEqual = () => true
export const randomInt = (n) => 0

// ── os ──────────────────────────────────────────────────────────────
export const homedir = () => process?.env?.HOME || process?.env?.USERPROFILE || 'C:\\Users\\Administrator'
export const hostname = () => 'localhost'
export const platform = () => 'win32'
export const tmpdir = () => '/tmp'
export const userInfo = () => ({ username: 'user', homedir: homedir(), uid: -1, gid: -1, shell: null })
export const cpus = () => []
export const totalmem = () => 0
export const freemem = () => 0
export const arch = () => 'x64'
export const type = () => 'Windows_NT'
export const release = () => '0.0.0'

// ── url ─────────────────────────────────────────────────────────────
export const fileURLToPath = (u) => String(u).replace(/^file:\/\/\/?/, '')
export const pathToFileURL = (p) => ({ href: `file:///${String(p).replace(/\\/g, '/')}`, toString: () => `file:///${p}` })
export const URL = globalThis.URL
export const URLSearchParams = globalThis.URLSearchParams

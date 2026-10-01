// Browser-side stub for Node.js built-in modules.
// These modules are used by credential-store.ts and skill-service.ts
// which only run in the host half-zone. In the browser bundle they are no-ops.

export default {}

// fs stubs
export const readdir = () => Promise.resolve([])
export const readFile = () => Promise.resolve('')
export const writeFile = () => Promise.resolve()
export const stat = () => Promise.resolve({ isDirectory: () => false })
export const existsSync = () => false
export const readdirSync = () => []
export const readFileSync = () => ''
export const writeFileSync = () => {}
export const mkdirSync = () => {}
export const copyFileSync = () => {}
export const renameSync = () => {}
export const unlinkSync = () => {}

// path stubs
export const join = (...a) => a.join('/')
export const resolve = (...a) => a.join('/')
export const sep = '/'
export const delimiter = ';'
export const extname = (p) => { const i = String(p).lastIndexOf('.'); return i >= 0 ? String(p).slice(i) : '' }
export const basename = (p) => String(p).split('/').pop() || ''
export const dirname = (p) => { const i = String(p).lastIndexOf('/'); return i >= 0 ? String(p).slice(0, i) : '.' }

// child_process stubs
export const spawn = () => ({ on() {}, kill() {} })
export const execSync = () => ''

// crypto stubs
export const randomBytes = (n) => new Uint8Array(n)

// os stubs
export const homedir = () => process?.env?.HOME || process?.env?.USERPROFILE || 'C:\\Users\\Administrator'
export const hostname = () => 'localhost'
export const platform = () => 'win32'

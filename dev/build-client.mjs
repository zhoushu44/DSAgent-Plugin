/**
 * 使用 esbuild 将 src/client.ts 打包为 DSH ModuleLoader 工厂格式
 *
 * 输出格式：
 * window.__ModuleLoader__.load({
 *   id: "@dsagent/dsagent-plugin",
 *   factory: (require) => {
 *     var module = { exports: {} };
 *     var exports = module.exports;
 *     ...bundle code...
 *     return module.exports;
 *   }
 * });
 *
 * ★ 实现说明：优先直接调用原生 esbuild 可执行文件。
 *   esbuild 的 JS API 需要用管道 stdio spawn 出子进程，在受限沙箱 / 部分受管环境下
 *   会被拦下报 `spawn EPERM`（与 DSH Desktop 里 pnpm 报的 -4048/EPERM 同源）。
 *   原生二进制 + `stdio: 'inherit'` 不经过管道，两个环境下都能构建。
 *   找不到原生二进制时自动回退到 esbuild 的 JS API。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const PLUGIN_ID = '@dsagent/dsagent-plugin'

const BANNER = `window.__ModuleLoader__.load({
\tid: "${PLUGIN_ID}",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
\t\tlet react = require("react");
\t\tvar React = react;
`

const FOOTER = `
\t\treturn module.exports;
\t}
});
`

/** node:* 内置模块映射到空 stub（这些模块仅在 host 半区使用） */
const NODE_ALIASES = [
  'node:fs/promises',
  'node:fs',
  'node:path',
  'node:crypto',
  'node:child_process',
  'node:os',
  'node:url',
]

const entry = resolve(root, 'src/client.ts')
const outPath = resolve(root, 'lib/client.js')
const stub = resolve(root, 'dev/node-stub.js')
/** 构建先落到临时文件，自检通过后才原子替换正式产物（避免半成品被 HMR 下发） */
const tmpFile = resolve(root, 'lib/client.js.building')
let wroteToTmp = false

/** 定位随 esbuild 一起装的原生可执行文件。 */
function findNativeEsbuild() {
  const candidates = [
    resolve(root, 'node_modules/@esbuild/win32-x64/esbuild.exe'),
    resolve(root, 'node_modules/@esbuild/win32-arm64/esbuild.exe'),
    resolve(root, 'node_modules/@esbuild/linux-x64/bin/esbuild'),
    resolve(root, 'node_modules/@esbuild/darwin-arm64/bin/esbuild'),
    resolve(root, 'node_modules/@esbuild/darwin-x64/bin/esbuild'),
  ]
  return candidates.find((c) => existsSync(c)) ?? null
}

function esbuildArgs(outputFile) {
  return [
    entry,
    '--bundle',
    '--format=cjs',
    '--target=es2022',
    '--platform=browser',
    '--external:react',
    '--legal-comments=none',
    ...NODE_ALIASES.map((m) => `--alias:${m}=${stub}`),
    `--outfile=${outputFile}`,
    '--log-level=warning',
  ]
}

/** 原生二进制路径：用 node 的 require 拿到 fs.readdirSync（顶层是 ESM，这里需要显式引入）。 */
async function buildWithNative() {
  const { execPath, platform, arch } = process
  const binName = platform === 'win32' ? 'esbuild.exe' : 'esbuild'
  const pkgByPlatform = {
    win32: { x64: 'win32-x64', arm64: 'win32-arm64' },
    linux: { x64: 'linux-x64', arm64: 'linux-arm64' },
    darwin: { x64: 'darwin-x64', arm64: 'darwin-arm64' },
  }
  const sub = pkgByPlatform[platform]?.[arch]
  if (!sub) return false

  // pnpm 把原生包放在 .pnpm/<pkg>@<ver>/node_modules/... 下，先找常规位置再扫 .pnpm
  const direct = [
    resolve(root, `node_modules/@esbuild/${sub}/${binName}`),
    resolve(root, `node_modules/@esbuild/${sub}/bin/${binName}`),
  ].find((p) => existsSync(p))

  let exe = direct
  if (!exe) {
    const pnpmDir = resolve(root, 'node_modules/.pnpm')
    if (existsSync(pnpmDir)) {
      const { readdirSync } = await import('node:fs')
      const hit = readdirSync(pnpmDir).find((d) => d.startsWith(`@esbuild+${sub}@`))
      if (hit) {
        const cand = [
          resolve(pnpmDir, hit, `node_modules/@esbuild/${sub}/${binName}`),
          resolve(pnpmDir, hit, `node_modules/@esbuild/${sub}/bin/${binName}`),
        ].find((p) => existsSync(p))
        if (cand) exe = cand
      }
    }
  }
  if (!exe) return false

  // stdio: 'inherit' 不走管道，受限环境下不会 EPERM
  // ★ 先写到临时文件：构建失败时 esbuild 可能留下半个文件，若直接写 lib/client.js，
  //   dsh-client-hmr 会在 500ms 内把这个残缺 bundle 推给页面（插件 UI 当场消失）。
  const res = spawnSync(exe, esbuildArgs(tmpFile), { stdio: 'inherit' })
  if (res.error) {
    rmSync(tmpFile, { force: true })
    throw res.error
  }
  if (res.status !== 0) {
    rmSync(tmpFile, { force: true })
    throw new Error(`esbuild exited with status ${res.status}`)
  }
  wroteToTmp = true
  return true
}

async function buildWithJsApi() {
  const { build } = await import('esbuild')
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'cjs',
    target: 'es2022',
    platform: 'browser',
    write: false,
    sourcemap: false,
    legalComments: 'none',
    treeShaking: true,
    external: ['react'],
    alias: Object.fromEntries(NODE_ALIASES.map((m) => [m, stub])),
    banner: { js: '' },
    footer: { js: '' },
    logLevel: 'warning',
  })
  writeFileSync(tmpFile, result.outputFiles[0].text, 'utf-8')
  wroteToTmp = true
}

async function main() {
  let used = 'native esbuild binary'
  const ok = await buildWithNative()
  if (!ok) {
    used = 'esbuild JS API'
    await buildWithJsApi()
  }
  if (!wroteToTmp) throw new Error('no build output produced')

  // 统一套上 ModuleLoader 工厂外壳（仍在临时文件里完成）
  const body = readFileSync(tmpFile, 'utf-8')
  const wrapped = body.startsWith('window.__ModuleLoader__.load(') ? body : BANNER + body + FOOTER

  // ★ 产物自检：确认是可用的 ModuleLoader bundle，而不是被 tsc/失败构建写进去的裸源码。
  //   裸 ESM 源码（如 `import ... from './ui/...'`）不含注册外壳，会直接让插件静默失效。
  if (!wrapped.startsWith('window.__ModuleLoader__.load(')) {
    throw new Error('bundle self-check failed: missing ModuleLoader envelope')
  }
  if (!wrapped.includes(`id: "${PLUGIN_ID}"`)) {
    throw new Error(`bundle self-check failed: missing plugin id ${PLUGIN_ID}`)
  }
  if (wrapped.length < 50_000) {
    throw new Error(`bundle self-check failed: suspiciously small bundle (${wrapped.length} bytes)`)
  }

  // 校验通过才原子替换正式产物，避免半成品被 HMR 下发
  writeFileSync(tmpFile, wrapped, 'utf-8')
  renameSync(tmpFile, outPath)

  console.log(`✅ Client bundle written to ${outPath} (via ${used}, ${wrapped.length} bytes)`)
}

main().catch((err) => {
  try {
    rmSync(tmpFile, { force: true })
  } catch {}
  console.error(err)
  process.exit(1)
})

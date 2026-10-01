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
 */

import { build } from 'esbuild'
import { writeFile } from 'node:fs/promises'
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

async function main() {
  const result = await build({
    entryPoints: [resolve(root, 'src/client.ts')],
    bundle: true,
    format: 'cjs',
    target: 'es2022',
    platform: 'browser',
    write: false,
    sourcemap: false,
    legalComments: 'none',
    treeShaking: true,
    // react 由 DSH ModuleLoader 的 require() 提供
    external: ['react'],
    // node:* 内置模块映射到空 stub（skill-service.ts 仅在 host 半区使用，browser bundle 中不会实际调用）
    alias: {
      'node:fs/promises': resolve(root, 'dev/node-stub.js'),
      'node:fs': resolve(root, 'dev/node-stub.js'),
      'node:path': resolve(root, 'dev/node-stub.js'),
      'node:crypto': resolve(root, 'dev/node-stub.js'),
      'node:child_process': resolve(root, 'dev/node-stub.js'),
      'node:os': resolve(root, 'dev/node-stub.js'),
      'node:url': resolve(root, 'dev/node-stub.js'),
    },
    banner: { js: '' },
    footer: { js: '' },
    logLevel: 'info',
  })

  let code = result.outputFiles[0].text

  // 移除 esbuild CJS 的 "use strict" 声明（已在工厂函数内）
  // esbuild format:cjs 会生成 `module.exports = __toCommonJS(client_exports);`
  // 这正是我们需要的——它设置 exports 然后 FOOTER 中的 return module.exports 返回它

  const fullOutput = BANNER + code + FOOTER

  const outPath = resolve(root, 'lib/client.js')
  await writeFile(outPath, fullOutput, 'utf-8')
  console.log(`✅ Client bundle written to ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

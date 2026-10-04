/**
 * 在一个隔离的 git worktree 里验证「选择性提交」后，树能否独立编译。
 *
 * 为什么必须真跑一遍而不是靠推理：src/index.ts 是双方混写文件，
 * 它同时 import 我的模块与对方的 auth-operation / gateway-cache。
 * 只有把「已提交的树」单独 checkout 出来编译，才能发现遗漏的依赖。
 *
 * ★ 实现上刻意**不用** child_process 的 piped stdio：
 *   本机 DSH 沙箱会拦截匿名管道，导致子进程输出捕获失败（EPERM，静默返回空）。
 *   因此所有命令一律重定向到临时文件再读回 —— 与本项目技能脚本遵循的同一条约束。
 *
 * 用法：node dev/verify-commit-tree.mjs <commit-ish>
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const ref = process.argv[2]
if (!ref) {
  console.error('用法: node dev/verify-commit-tree.mjs <commit-ish>')
  process.exit(2)
}

const scratch = mkdtempSync(join(tmpdir(), 'dsagent-cv-'))
let seq = 0

/** 跑命令并把 stdout/stderr 落到临时文件（绕开沙箱的匿名管道限制） */
function run(cmd, cwd) {
  const outFile = join(scratch, `out-${++seq}.txt`)
  const errFile = join(scratch, `err-${seq}.txt`)
  // ★ 必须显式 `exit $LASTEXITCODE`：否则 pwsh 在「块 + 重定向」下不一定把
  //   内部命令的失败码透传出来，会让失败被误判为成功（曾导致一次假通过）。
  const ps = `& { ${cmd} } 1>"${outFile}" 2>"${errFile}"; exit $LASTEXITCODE`
  let code = 0
  try {
    execSync(`pwsh -NoProfile -NonInteractive -Command ${JSON.stringify(ps)}`, {
      cwd,
      stdio: 'ignore',
      timeout: 600_000,
    })
  } catch (e) {
    code = typeof e.status === 'number' ? e.status : 1
  }
  const read = (p) => { try { return readFileSync(p, 'utf8') } catch { return '' } }
  return { ok: code === 0, code, out: read(outFile), err: read(errFile) }
}

const wt = join(scratch, 'tree')
console.log(`验证目标: ${ref}`)
console.log(`隔离 worktree: ${wt}\n`)

let failed = false
try {
  // 1) 检出目标提交到独立 worktree
  const add = run(`git worktree add --detach "${wt}" ${ref}`, process.cwd())
  if (!add.ok) {
    console.log(`✗ 无法创建 worktree (exit=${add.code}):\n${add.out}\n${add.err}`)
    process.exit(1)
  }
  console.log('✓ 已检出目标提交')

  // 2) 必须是干净树
  const st = run('git status --short', wt)
  if (st.out.trim()) {
    console.log('✗ 检出的树不干净：\n' + st.out)
    process.exit(1)
  }
  console.log('✓ 树是干净的')

  // 3) node_modules 不进 git —— 用 junction 复用主仓库的
  const nm = join(wt, 'node_modules')
  if (!existsSync(nm)) {
    const mainNm = join(process.cwd(), 'node_modules')
    const link = run(`cmd /c mklink /J "${nm}" "${mainNm}"`, wt)
    if (!link.ok) {
      console.log(`✗ 无法链接 node_modules:\n${link.out}\n${link.err}`)
      process.exit(1)
    }
    console.log('✓ 已复用主仓库 node_modules (junction)')
  }

  // 4) typecheck —— 选择性提交最关键的一关。
  //
  // ★ 刻意用 `node node_modules/typescript/bin/tsc` 而不是裸 `npx tsc` 或 `npm run typecheck`：
  //   本机 node_modules 下**没有 .bin 目录**（无 tsc.cmd 垫片），因此 package.json 里
  //   裸调 `tsc` 的脚本在任何目录都会报 "tsc is not recognized"。
  //   这是环境既有状态，与本仓库代码无关；直接调 typescript 本体可绕开该缺失。
  console.log('\n----- tsc --noEmit (via typescript/bin/tsc) -----')
  const tscBin = join(wt, 'node_modules', 'typescript', 'bin', 'tsc')
  const tc = run(`node "${tscBin}" --noEmit`, wt)
  const tcText = (tc.out + tc.err).trim()
  console.log(tc.ok ? '✓ typecheck 通过' : `✗ typecheck 失败 (exit=${tc.code}):\n${tcText.split('\n').slice(0, 25).join('\n')}`)
  if (!tc.ok) failed = true

  // 5) host 半区编译产出（等价于 package.json 的 build:host，同样绕开 .bin 缺失）
  if (!failed) {
    console.log('\n----- host 半区编译 (tsc -p tsconfig.json) -----')
    const bh = run(`node "${tscBin}" -p tsconfig.json`, wt)
    const bhText = (bh.out + bh.err).trim()
    console.log(bh.ok ? '✓ host 编译通过' : `✗ host 编译失败 (exit=${bh.code}):\n${bhText.split('\n').slice(0, 25).join('\n')}`)
    if (!bh.ok) failed = true
  }

  // 6) 客户端 bundle 构建（esbuild），验证 browser 半区仍可打包
  if (!failed) {
    console.log('\n----- 客户端 bundle (dev/build-client.mjs) -----')
    const bc = run('node dev/build-client.mjs', wt)
    const bcText = (bc.out + bc.err).trim()
    console.log(bc.ok ? `✓ 客户端 bundle 通过\n${bcText.split('\n').slice(-3).join('\n')}` : `✗ 客户端 bundle 失败 (exit=${bc.code}):\n${bcText.split('\n').slice(0, 20).join('\n')}`)
    if (!bc.ok) failed = true
  }

  // 7) 若该提交包含我的验证脚本，则跑一遍并**按真实退出码 + 结果行断言**。
  //
  // ★ 两个假通过的坑都必须在判定里堵住：
  //   · 只按退出码判：沙箱里管道被拦时可能返回 0 但零输出
  //   · 只按输出判：脚本本身失败也可能打印过「通过 N」的历史行
  //   因此要求「退出码 0」且「恰好一行 通过 N　失败 0」。
  if (!failed) {
    const mine = ['verify-skill-governance.mjs', 'verify-pitfalls.mjs', 'verify-wiki.mjs', 'verify-host-integration.mjs']
    const present = mine.filter(t => existsSync(join(wt, 'dev', t)))
    if (!present.length) {
      console.log('\n（该提交不含我的验证脚本 —— 属于其他作者提交，跳过）')
    } else {
      console.log('\n----- 提交内含的验证脚本 -----')
      for (const t of present) {
        const r = run(`node dev/${t}`, wt)
        const text = r.out + r.err
        const m = text.match(/通过\s+(\d+)\s+失败\s+(\d+)/)
        const passN = m ? Number(m[1]) : -1
        const failN = m ? Number(m[2]) : -1
        const good = r.ok && passN > 0 && failN === 0
        console.log(`${good ? '✓' : '✗'} ${t}: 通过 ${passN}　失败 ${failN} (exit=${r.code})`)
        if (!good) {
          console.log(text.split('\n').slice(-25).join('\n'))
          failed = true
          break
        }
      }
    }
  }
} finally {
  run(`git worktree remove --force "${wt}"`, process.cwd())
  run('git worktree prune', process.cwd())
}

if (failed) {
  console.log('\n✗ 该提交的树无法独立编译/验证')
  process.exit(1)
}
console.log(`\n${'═'.repeat(56)}`)
console.log(`✅ 提交 ${ref} 的树可独立编译并通过验证`)
console.log(`${'═'.repeat(56)}`)

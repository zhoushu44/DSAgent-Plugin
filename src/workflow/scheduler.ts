/**
 * ★ 工作流定期执行调度器（按间隔）
 *
 * 只有一种模式：每 N 分钟触发一次。
 * 时段开始/结束属于业务参数，由模板 inputs 传给技能，调度器不管。
 *
 * 设计：
 *   1. 轮询式（60 秒一次），零依赖
 *   2. 判据：now - lastRunAt >= intervalMinutes
 *   3. 幂等：同一次触发只跑一个任务
 *   4. lastRunAt / nextRunAt 写回模板 YAML，进程重启可恢复
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import type { WorkflowSchedule } from './types.ts'

/** 轮询间隔（毫秒） */
const TICK_MS = 60_000
/** 间隔下限（分钟） */
const MIN_INTERVAL = 5

/**
 * 计算下次触发时刻
 * @param sc schedule 配置
 * @param from 从何时算起
 */
export function computeNextRun(sc: WorkflowSchedule | undefined, from: Date = new Date()): Date | null {
  if (!sc || !sc.enabled) return null
  const stepMin = Math.max(MIN_INTERVAL, Number(sc.intervalMinutes) || 60)
  return new Date(from.getTime() + stepMin * 60_000)
}

/**
 * 创建调度器
 */
export function createWorkflowScheduler(deps: {
  workflowService: {
    runTemplate: (name: string, inputs?: Record<string, string>) => Promise<{ taskId: string }>
  }
  workflowDir: string
  log?: (msg: string) => void
}) {
  const { workflowService, workflowDir, log = () => {} } = deps
  let timer: ReturnType<typeof setInterval> | null = null
  let ticking = false
  /** 已触发指纹，防同一分钟内重复 */
  const fired = new Set<string>()

  async function listTemplateFiles(): Promise<string[]> {
    if (!existsSync(workflowDir)) return []
    const files = await readdir(workflowDir)
    return files.filter((f) => /\.ya?ml$/i.test(f)).map((f) => join(workflowDir, f))
  }

  async function readRaw(file: string): Promise<Record<string, any> | null> {
    const txt = await readFile(file, 'utf8')
    const obj = parse(txt)
    return obj && typeof obj === 'object' ? (obj as Record<string, any>) : null
  }

  /** 只改 schedule 的时间戳，其余字段原样保留 */
  async function stampSchedule(file: string, patch: Record<string, unknown>): Promise<void> {
    const obj = await readRaw(file)
    if (!obj || !obj.schedule) return
    obj.schedule = { ...obj.schedule, ...patch }
    await writeFile(file, stringify(obj), 'utf8')
  }

  /** 查所有已启用的计划 */
  async function list(): Promise<Array<{ name: string; file: string; schedule: WorkflowSchedule; nextRunAt: string | null }>> {
    const out = []
    for (const file of await listTemplateFiles()) {
      try {
        const obj = await readRaw(file)
        if (!obj?.schedule?.enabled) continue
        const sc = obj.schedule as WorkflowSchedule
        out.push({
          name: String(obj.name ?? ''),
          file,
          schedule: sc,
          nextRunAt: sc.nextRunAt ?? computeNextRun(sc)?.toISOString() ?? null,
        })
      } catch {
        /* 坏文件跳过 */
      }
    }
    return out
  }

  /** 单次轮询 */
  async function tick(): Promise<void> {
    if (ticking) return
    ticking = true
    try {
      const now = new Date()
      for (const file of await listTemplateFiles()) {
        let obj: Record<string, any> | null = null
        try {
          obj = await readRaw(file)
        } catch {
          continue
        }
        if (!obj) continue
        const sc = obj.schedule as WorkflowSchedule | undefined
        if (!sc?.enabled) continue

        const stepMin = Math.max(MIN_INTERVAL, Number(sc.intervalMinutes) || 60)
        const last = sc.lastRunAt ? new Date(sc.lastRunAt) : null
        const dueAt = last ? new Date(last.getTime() + stepMin * 60_000) : now
        // 未到时间
        if (now.getTime() < dueAt.getTime()) continue

        const name = String(obj.name ?? '')
        const key = `${name}@${Math.floor(now.getTime() / 60_000)}`
        if (fired.has(key)) continue

        try {
          const inputs: Record<string, string> = {}
          log(`[schedule] 触发「${name}」（间隔 ${stepMin} 分钟）`)
          await workflowService.runTemplate(name, inputs)
          fired.add(key)
          if (fired.size > 200) fired.clear()
          const next = computeNextRun({ ...sc, enabled: true }, now)
          await stampSchedule(file, {
            lastRunAt: now.toISOString(),
            nextRunAt: next ? next.toISOString() : null,
          })
          log(`[schedule] 「${name}」已提交，下次 ${next ? next.toISOString() : '无'}`)
        } catch (e) {
          log(`[schedule] 「${name}」触发失败：${e instanceof Error ? e.message : String(e)}`)
        }
      }
    } finally {
      ticking = false
    }
  }

  function start(): { ok: boolean; already?: boolean } {
    if (timer) return { ok: true, already: true }
    // 启动时先算一遍 nextRunAt，让界面立刻有值
    void (async () => {
      for (const file of await listTemplateFiles()) {
        try {
          const obj = await readRaw(file)
          if (!obj?.schedule?.enabled) continue
          const next = computeNextRun(obj.schedule as WorkflowSchedule)
          await stampSchedule(file, { nextRunAt: next ? next.toISOString() : null })
        } catch {
          /* ignore */
        }
      }
    })()
    timer = setInterval(() => {
      void tick()
    }, TICK_MS)
    if (typeof timer.unref === 'function') timer.unref()
    log(`[schedule] 调度器已启动，轮询 ${TICK_MS / 1000}s`)
    return { ok: true }
  }

  function stop(): { ok: boolean } {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    return { ok: true }
  }

  /** 立刻按计划配置跑一次（补跑/调试） */
  async function runNow(name: string, inputs: Record<string, string> = {}): Promise<{ taskId: string }> {
    return workflowService.runTemplate(name, inputs)
  }

  return { start, stop, list, tick, runNow, computeNextRun }
}

export { computeNextRun as computeNextRunStandalone }

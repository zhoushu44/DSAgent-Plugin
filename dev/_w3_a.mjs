/**
 * 验收门禁：mqs 技能 ↔ 宿主实现一致性（skills/*-publish-mqs/SKILL.md vs src/）
 *
 * 与 dev/verify-mqs-skills.mjs 互补：那个门禁只看文档质量（frontmatter / 章节槽位 / L2 门禁 /
 * 悬空路径），本门禁看「文档有没有吹牛」——技能里声明的工具、发布域、锚点配置，宿主里到底有没有。
 * 专门用来暴露「只写了文档、没落实现」的真实缺口（如 jd / 1688 / 抖店 mqs 工具尚未注册）。
 *
 * 逐平台校验 4 件事：
 *   (1) 技能声明的 dsagent_<platform>_publish* 工具是否在 src/*.ts 真实注册（name: 'dsagent_xxx'）
 *   (2) 技能声明的发布域名是否在 src/ 有实现证据（发布类文件 > 仅绑定/代理文件 > 完全没有）
 *   (3) 技能引用的 publish-config/*.json 锚点集是否存在且可解析
 *   (4) 工具未实现时，技能是否给了「降级指令型」路径（有降级 → warn，没降级 → error）
 *
 * 默认模式（warn 不阻断，可直接进 CI）：只把「结构性错误」当 error。
 * --strict：把所有 warn 一并升为 error，缺口清单立刻变成红灯（当前 jd/1688/抖店会红）。
 *
 * 零依赖（不 import lib/，无需先 build）。
 *
 * 用法：
 *   node dev/verify-mqs-tools.mjs                 # 扫 skills/ + src/，只报结构性 error
 *   node dev/verify-mqs-tools.mjs --strict        # 缺技能 / 工具未实现 / 域名无实现 全部算 error
 *   node dev/verify-mqs-tools.mjs --dir <path>    # 指定技能根目录（写草稿时自检）
 *   node dev/verify-mqs-tools.mjs --src <path>    # 指定源码根目录
 *   node dev/verify-mqs-tools.mjs --json          # 机器可读输出
 *   node dev/verify-mqs-tools.mjs --selftest      # 只跑内置正反样例自测
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const LF = String.fromCharCode(10)
const BOM = String.fromCharCode(0xfeff)
const BT = String.fromCharCode(96)
const CR = String.fromCharCode(13)

/** 期望存在的 5 个 mqs 技能 + 平台词 + 平台域名（域名用于查 src/ 实现证据）。 */
export const EXPECTED = [
  { id: '1688-publish-mqs', platform: '1688', domains: ['1688.com'], words: ['1688', '阿里巴巴'] },
  { id: 'douyin-publish-mqs', platform: 'douyin', domains: ['douyin.com'], words: ['抖音', 'douyin'] },
  { id: 'jd-publish-mqs', platform: 'jd', domains: ['jd.com', 'jd.hk'], words: ['京东', 'jd'] },
  { id: 'taobao-publish-mqs', platform: 'taobao', domains: ['taobao.com'], words: ['淘宝', 'taobao'] },
  { id: 'tmall-publish-mqs', platform: 'tmall', domains: ['tmall.com'], words: ['天猫', 'tmall'] },
]

/** 只有这些文件才算「发布实现」；bindings / gateway-proxy / browser-login 只算「登录态证据」。 */
const PUBLISH_FILE_RE = /publish/i
const AUTH_FILE_RE = /(bindings|browser-login|gateway-proxy|tools-platform)/i

/** 降级路径关键词：工具未实现时，技能必须告诉模型「改用人工步骤，不要假装已提交」。 */
const FALLBACK_RE = /(降级|指令型|人工上架|人工发布|手动发布|不要假装|未注册)/

function splitLines(text) {
  return text.split(LF).map((l) => (l.endsWith(CR) ? l.slice(0, -1) : l))
}

/** 拆分 frontmatter / 正文（与 verify-mqs-skills.mjs 同规则）。 */
export function splitSkillMarkdown(raw) {
  const text = raw.startsWith(BOM) ? raw.slice(1) : raw
  const lines = splitLines(text)
  if (!lines.length || lines[0].trim() !== '---') return { hasFrontmatter: false, frontmatter: '', body: text }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      return { hasFrontmatter: true, frontmatter: lines.slice(1, i).join(LF), body: lines.slice(i + 1).join(LF) }
    }
  }
  return { hasFrontmatter: false, frontmatter: '', body: text }
}

/** 抽取正文里所有 dsagent_* 工具名（反引号内外都算），保序去重。 */
export function extractToolRefs(body) {
  const out = []
  const seen = new Set()
  const re = /dsagent_[a-z0-9_]+/g
  let m
  while ((m = re.exec(body)) !== null) {
    if (!seen.has(m[0])) {
      seen.add(m[0])
      out.push(m[0])
    }
  }
  return out
}

/** 抽取技能引用的 publish-config/*.json 锚点集路径。 */
export function extractConfigRefs(body) {
  const out = []
  const seen = new Set()
  const re = /publish-config\/[A-Za-z0-9_.-]+\.json/g
  let m
  while ((m = re.exec(body)) !== null) {
    if (!seen.has(m[0])) {
      seen.add(m[0])
      out.push(m[0])
    }
  }
  return out
}

/** 该平台「自己的」发布工具名：dsagent_<platform>_publish 前缀。 */
export function isPlatformTool(tool, platform) {
  return tool.indexOf('dsagent_' + platform + '_publish') === 0
}

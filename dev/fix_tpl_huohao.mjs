import * as fs from 'node:fs'
const f = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin/skills/pdd-publish-http/scripts/attr-template-direct.mjs'
let s = fs.readFileSync(f, 'utf8')

const OLD = `  // 合并：用户值优先
  const merged = new Map()
  for (const a of templateAttrs || []) {
    const n = String(a.name || '').replace(/\\s+/g, '')
    const v = String(a.value || '').trim()
    if (n && v) merged.set(n, { name: a.name, value: v })
  }
  for (const a of userAttrs || []) {
    const n = String(a.name || '').replace(/\\s+/g, '')
    const v = String(a.value || '').trim()
    if (n && v) merged.set(n, { name: a.name, value: v })   // 覆盖模板值
  }`

const NEW = `  // 合并：用户值优先
  const merged = new Map()
  for (const a of templateAttrs || []) {
    const n = String(a.name || '').replace(/\\s+/g, '')
    const v = String(a.value || '').trim()
    if (n && v) merged.set(n, { name: a.name, value: v })
  }
  for (const a of userAttrs || []) {
    const n = String(a.name || '').replace(/\\s+/g, '')
    const v = String(a.value || '').trim()
    if (n && v) merged.set(n, { name: a.name, value: v })   // 覆盖模板值
  }
  // ★ 2026-11-03：货号只接受纯 ASCII（模板里可能存了中文货号）
  //   实测睡衣：模板货号「MHJ-拼接袖莫代尔套装」→ 平台报「商品货号格式不正确」
  for (const [k, item] of [...merged]) {
    if (/货号|商品编码/.test(k) || /货号|商品编码/.test(String(item.name || ''))) {
      const ascii = item.value.replace(/[^A-Za-z0-9_\\-]/g, '')
      if (ascii) merged.set(k, { ...item, value: ascii })
      else merged.delete(k)
    }
  }`

if (s.includes(OLD)) {
  s = s.replace(OLD, NEW)
  fs.writeFileSync(f, s, 'utf8')
  console.log('OK: 模板直填货号过滤已加')
} else {
  console.log('NOT FOUND')
}

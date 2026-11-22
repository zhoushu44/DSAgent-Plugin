/**
 * find-cats3.mjs — 正确解析 cat_info_v2_lists
 */
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
const P = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const { callApi } = await import(pathToFileURL(P + '/skills/_shared/pdd-request.mjs').href)
const { CredentialStore } = await import(pathToFileURL(P + '/lib/services/credential-store.js').href)

const s = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
const all = s.listAccounts().filter(x => x.platform === 'pdd_mms')
const ckOf = x => { const v = x.cookies; if (!v) return 0; if (typeof v === 'object') return Object.keys(v).length; if (typeof v === 'string') return v.split(';').filter(Boolean).length; return 0 }
const acc = all.filter(x => ckOf(x) > 0 && x.status === 'valid')[0] || all.filter(x => ckOf(x) > 0)[0]
console.log('账号:', acc.shop_key)

const CASES = [
  { name: '刀柄', kws: ['数控刀柄', '刀柄', 'CNC刀柄', '机床刀柄', '刀杆', '铣刀'] },
  { name: '蕾丝衬衫', kws: ['女式衬衫', '衬衫', '雪纺衫', '上衣'] },
  { name: '涌泉蜜桔', kws: ['蜜桔', '橘子', '新鲜水果', '柑橘', '桔子', '水果'] },
]

const found = {}

for (const C of CASES) {
  console.log(`\n${'='.repeat(55)}`)
  console.log(`  ${C.name}`)
  console.log('='.repeat(55))

  for (const kw of C.kws) {
    const r = await callApi('mms.categorySearch', { keyword: kw }, { account: acc, shopKey: acc.shop_key }).catch(e => ({ ok: false, error: e.message }))
    if (!r.ok) { console.log(`  「${kw}」❌`); continue }

    const lists = r.data?.cat_info_v2_lists || []
    if (!lists.length) { console.log(`  「${kw}」空`); continue }

    console.log(`  「${kw}」→ ${lists.length} 个叶子类目`)
    const items = []
    for (const c of lists.slice(0, 12)) {
      // 叶子类目：取最深的非 null cat_id
      const ids = [c.cat_id_1, c.cat_id_2, c.cat_id_3, c.cat_id_4].filter(x => x != null)
      const names = [c.cat_name_1, c.cat_name_2, c.cat_name_3, c.cat_name_4].filter(x => x)
      const leafId = ids[ids.length - 1]
      const pathStr = names.join(' > ')
      items.push({ catId: leafId, path: pathStr, staple: c.staple_name })
      console.log(`    ${String(leafId).padEnd(8)} ${pathStr}`)
    }
    found[C.name] = items
    break
  }

  if (!found[C.name]) console.log('  ❌ 没找到')
}

fs.writeFileSync(P + '/tmp/cats.json', JSON.stringify(found, null, 2), 'utf8')
console.log('\n=== 写入 tmp/cats.json ===')

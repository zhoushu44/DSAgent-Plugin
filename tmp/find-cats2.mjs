/**
 * find-cats2.mjs — 用 mms.categorySearch 找 3 个商品的类目
 */
import path from 'node:path'
import os from 'node:os'
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
  { name: '刀柄', kws: ['数控刀柄', '刀柄', 'CNC刀柄', '机床刀柄', '刀杆'] },
  { name: '蕾丝衬衫', kws: ['衬衫', '女式衬衫', '雪纺衬衫', '长袖衬衫'] },
  { name: '涌泉蜜桔', kws: ['蜜桔', '橘子', '新鲜水果', '柑橘', '桔子'] },
]

const found = {}

for (const C of CASES) {
  console.log(`\n=== ${C.name} ===`)
  for (const kw of C.kws) {
    const r = await callApi('mms.categorySearch', { keyword: kw, q: kw }, { account: acc, shopKey: acc.shop_key }).catch(e => ({ ok: false, error: e.message }))
    if (!r.ok) { console.log(`  「${kw}」❌ ${(r.error || r.hint || '').slice(0, 70)}`); continue }

    const j = r.data || {}
    const list = j.result?.cat_list || j.cat_list || j.result?.list || j.list || j.result?.cats || []
    if (!list.length) { console.log(`  「${kw}」空（keys=${Object.keys(j).slice(0, 6)}）`); continue }

    console.log(`  「${kw}」→ ${list.length} 个`)
    for (const c of list.slice(0, 10)) {
      const id = c.cat_id ?? c.catId ?? c.id
      const nm = c.cat_name ?? c.catName ?? c.name
      const leaf = c.is_leaf ?? c.isLeaf
      console.log(`    ${String(id).padEnd(8)} ${nm}${leaf ? ' [叶子]' : ''}`)
    }
    found[C.name] = list.slice(0, 10).map(c => ({
      catId: c.cat_id ?? c.catId ?? c.id,
      name: c.cat_name ?? c.catName ?? c.name,
      leaf: c.is_leaf ?? c.isLeaf,
      path: c.cat_path ?? c.path ?? '',
    }))
    break
  }
}

console.log('\n=== 汇总 ===')
console.log(JSON.stringify(found, null, 2))

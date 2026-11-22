/**
 * find-cats.mjs — 为 3 个商品找拼多多类目，然后拉模板
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
const P = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const T = await import(pathToFileURL(P + '/skills/pdd-publish-http/templates/index.mjs').href)

const KEYWORDS = [
  { name: '刀柄', kws: ['数控刀柄', '刀柄', '机床刀具', 'CNC刀柄', '刀杆'] },
  { name: '蕾丝衬衫', kws: ['衬衫', '女式衬衫', '雪纺衫', '上衣'] },
  { name: '涌泉蜜桔', kws: ['蜜桔', '橘子', '新鲜水果', '柑橘'] },
]

// 用类目搜索接口
const { callApi } = await import(pathToFileURL(P + '/skills/_shared/pdd-request.mjs').href)
const { CredentialStore } = await import(pathToFileURL(P + '/lib/services/credential-store.js').href)
const os = await import('node:os')
const s = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
const all = s.listAccounts().filter(x => x.platform === 'pdd_mms')
const ckOf = x => { const v = x.cookies; if (!v) return 0; if (typeof v === 'object') return Object.keys(v).length; if (typeof v === 'string') return v.split(';').filter(Boolean).length; return 0 }
const acc = all.filter(x => ckOf(x) > 0 && x.status === 'valid')[0] || all.filter(x => ckOf(x) > 0)[0]
console.log('账号:', acc.shop_key)

for (const K of KEYWORDS) {
  console.log(`\n=== ${K.name} ===`)
  for (const kw of K.kws) {
    const r = await callApi('pdd.catSearch', { keyword: kw }, { account: acc, shopKey: acc.shop_key }).catch(e => ({ ok: false, error: e.message }))
    if (r.ok) {
      const list = r.data?.cat_list || r.data?.list || r.data?.cats || []
      console.log(`  「${kw}」→ ${list.length} 个类目`)
      for (const c of list.slice(0, 8)) {
        console.log(`    ${c.cat_id || c.catId}  ${c.cat_name || c.catName}  (${c.level || '?'}级)`)
      }
      if (list.length) break
    } else {
      console.log(`  「${kw}」❌ ${(r.error || '').slice(0, 60)}`)
    }
  }
}

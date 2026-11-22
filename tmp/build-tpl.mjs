/**
 * build-templates.mjs — 拉 3 个类目的模板
 */
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
const P = 'E:/360MoveData/Users/Administrator/Desktop/DSAgent-Plugin'
const T = await import(pathToFileURL(P + '/skills/pdd-publish-http/templates/index.mjs').href)
const { CredentialStore } = await import(pathToFileURL(P + '/lib/services/credential-store.js').href)

const s = new CredentialStore(path.join(os.homedir(), '.dsh', 'dsagent-accounts.json'))
const all = s.listAccounts().filter(x => x.platform === 'pdd_mms')
const ckOf = x => { const v = x.cookies; if (!v) return 0; if (typeof v === 'object') return Object.keys(v).length; if (typeof v === 'string') return v.split(';').filter(Boolean).length; return 0 }
const acc = all.filter(x => ckOf(x) > 0 && x.status === 'valid')[0] || all.filter(x => ckOf(x) > 0)[0]

const CATS = [
  { catId: 22896, name: '刀柄/刀杆', product: '刀柄' },
  { catId: 8466, name: '衬衫', product: '蕾丝衬衫' },
  { catId: 26228, name: '蜜桔', product: '涌泉蜜桔' },
]

for (const C of CATS) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`  ${C.product}  catId=${C.catId}  ${C.name}`)
  console.log('='.repeat(60))
  try {
    const tpl = await T.buildTemplate({
      catId: C.catId,
      account: acc,
      shopKey: acc.shop_key,
      save: true,
      log: (...a) => console.log('  ', ...a),
    })
    const attrs = tpl.attributes || []
    console.log(`  ✅ 属性 ${attrs.length} 个`)
    attrs.slice(0, 25).forEach(a => {
      const req = a.required ? '*' : ' '
      const opt = a.options?.length || 0
      console.log(`   ${req} ${a.label}${opt ? ' (' + opt + ' 项)' : ''}`)
    })
    const dims = tpl.specs?.dimensions || []
    console.log(`  规格维度 ${dims.length} 个: ${dims.map(d => d.name).join(' / ')}`)
  } catch (e) {
    console.log(`  ❌ ${String(e.message || e).slice(0, 150)}`)
  }
}

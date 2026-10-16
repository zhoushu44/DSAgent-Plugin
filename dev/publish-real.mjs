/**
 * 真实上架脚本：1688 摇粒绒童装家居服套装 → 拼多多
 *
 * 用法：
 *   node dev/publish-real.mjs            # dry-run（只出预览，不执行）
 *   node dev/publish-real.mjs --confirm  # 真实提交（会弹出 Chrome、实际发布商品）
 *
 * 账号显式指定为 pdd_mms_1-eSLJh8bo...（v8 真机验证段 1-3 走通、有 PASS_ID、Profile 有环境）。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

const CONFIRM = process.argv.includes('--confirm')

const { CredentialStore } = await import('../lib/services/credential-store.js')
const { pddPublish } = await import('../lib/pdd-publish.js')

const SRC = join('e:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin', 'skills', 'pdd-link-matrix', 'assets', 'src')
const img = (n) => join(SRC, n)

const result = await pddPublish(
  new CredentialStore(join(homedir(), '.dsh', 'dsagent-accounts.json')),
  {
    title: '秋冬新款儿童宽松睡衣秋季摇粒绒卡通糖果男童女童家居服套装开衫',
    category: '童装',
    price: '79.9',          // 商品参考价（须 > 最大单买价 50.9）
    stock: '1000',
    images: [
      img('main_06.jpg'),   // 格蕾灰
      img('main_07.jpg'),   // 奶油黄
      img('main_08.jpg'),   // 银河蓝
      img('main_09.jpg'),   // 迷雾紫
      img('main_10.jpg'),   // 星光粉
    ],
    detailImages: [
      'detail_10.jpg', 'detail_11.jpg', 'detail_12.jpg', 'detail_13.jpg',
      'detail_14.jpg', 'detail_15.jpg', 'detail_16.jpg', 'detail_17.jpg',
      'detail_18.jpg', 'detail_19.jpg', 'detail_20.jpg', 'detail_21.jpg',
    ].map(img),
    skus: [
      { name: '格蕾灰', image: img('main_06.jpg'), price: '49.9', stock: '1000' },
      { name: '奶油黄', image: img('main_07.jpg'), price: '49.9', stock: '1000' },
      { name: '银河蓝', image: img('main_08.jpg'), price: '49.9', stock: '1000' },
      { name: '迷雾紫', image: img('main_09.jpg'), price: '49.9', stock: '1000' },
      { name: '星光粉', image: img('main_10.jpg'), price: '49.9', stock: '1000' },
    ],
    account: 'pdd_mms_1-eSLJh8boXfOooWozRRaJtxit9Ge0C51kkuF224B1xHqhDtLV90iBBQVzyvdg52',
    confirm: CONFIRM,
  },
)

console.log(`\n===== 结果（confirm=${CONFIRM}） =====`)
console.log(JSON.stringify(result, null, 2))
process.exit(result.ok ? 0 : (result.needConfirm ? 2 : 1))

import fs from 'node:fs'
const s = fs.readFileSync('E:/360MoveData/Users/Administrator/Desktop/觅千手/source/pageHooks.js', 'utf8')
// 找 detailData / hook_slice 的写入与读取、loadStoredJsonDocument、applyStickyMovePayload 全貌
for (const k of ['kdds_taobao_detailData', 'function loadStoredJsonDocument', 'applyStickyMovePayloadToJsonTarget', 'isShopMoveCollectSource', 'function buildMoveJsonDocument', 'collect_source']) {
  let i = s.indexOf(k)
  if (i === -1) { console.log(`\n===== ${k}: NOT FOUND =====`); continue }
  console.log(`\n===== ${k} @${i} =====`)
  console.log(s.slice(Math.max(0, i - 200), i + 1200).replace(/\n/g, ' '))
}

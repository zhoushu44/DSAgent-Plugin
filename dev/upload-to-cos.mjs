// 把本地素材图上传到腾讯云 COS，输出公网 URL 清单（JSON）
// 用法：node dev/upload-to-cos.mjs
// 产物：dev/.ui-shots/cos-urls.json  { main: [...5], detail: [...12] }
import COS from 'cos-nodejs-sdk-v5'
import fs from 'node:fs'
import path from 'node:path'

const COS_CONF = {
  SecretId: '<COS_SECRET_ID>',
  SecretKey: '<COS_SECRET_KEY>',
  Bucket: 'sub2api-1318449123',
  Region: 'ap-guangzhou',
}
const PREFIX = 'backups/'
const SRC = path.join('e:', '360MoveData', 'Users', 'Administrator', 'Desktop', 'DSAgent-Plugin', 'skills', 'pdd-link-matrix', 'assets', 'src')
const MAIN = ['main_06.jpg', 'main_07.jpg', 'main_08.jpg', 'main_09.jpg', 'main_10.jpg']
const DETAIL = ['detail_10.jpg', 'detail_11.jpg', 'detail_12.jpg', 'detail_13.jpg', 'detail_14.jpg',
  'detail_15.jpg', 'detail_16.jpg', 'detail_17.jpg', 'detail_18.jpg', 'detail_19.jpg', 'detail_20.jpg', 'detail_21.jpg']

const cos = new COS({ SecretId: COS_CONF.SecretId, SecretKey: COS_CONF.SecretKey })

function put(filePath, key) {
  return new Promise((resolve, reject) => {
    cos.putObject({
      Bucket: COS_CONF.Bucket,
      Region: COS_CONF.Region,
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentType: 'image/jpeg',
    }, (err, data) => {
      if (err) return reject(err)
      // 强制路径风格 + 公网读 URL
      const url = `https://${COS_CONF.Bucket}.cos.${COS_CONF.Region}.myqcloud.com/${key}`
      resolve({ url, data })
    })
  })
}

async function up(name) {
  const fp = path.join(SRC, name)
  if (!fs.existsSync(fp)) throw new Error(`缺素材 ${fp}`)
  const key = PREFIX + 'taobao/' + name
  const { url } = await put(fp, key)
  console.log(`✓ ${name} -> ${url}`)
  return url
}

const main = []
for (const n of MAIN) main.push(await up(n))
const detail = []
for (const n of DETAIL) detail.push(await up(n))

const out = { main, detail }
fs.mkdirSync(path.join('dev', '.ui-shots'), { recursive: true })
fs.writeFileSync(path.join('dev', '.ui-shots', 'cos-urls.json'), JSON.stringify(out, null, 2))
console.log('\n已写入 dev/.ui-shots/cos-urls.json')
console.log('主图 ' + main.length + ' 张，详情图 ' + detail.length + ' 张')

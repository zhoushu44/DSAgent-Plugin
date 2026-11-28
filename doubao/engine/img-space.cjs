// 淘宝图片空间上传 —— 照搬正式引擎 src/taobao-image-space.ts 的「逆向 HTTP 上传」（觅千手 v5.61 同链路），不碰页面文件控件。
// POST https://stream-upload.taobao.com/api/upload.api?_input_charset=utf-8&appkey=tu&folderId=0&picCompress=false&watermark=false
// multipart: name=<文件名>（必须单独给）+ file=<二进制>。只需 .taobao.com 域登录 Cookie，无 mtop 签名。
const fs = require('fs'); const path = require('path');
const UPLOAD_URL = 'https://stream-upload.taobao.com/api/upload.api';
const REFERER = 'https://qn.taobao.com/home.htm/material-center/mine-material/sucai-tu', ORIGIN = 'https://qn.taobao.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
const MAX_BYTES = 20 * 1024 * 1024;
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.heic': 'image/heic' };
// 页面 Cookie 列表 → {名: 值}，只留 .taobao.com 域
function cookieMap(list) { const m = {}; for (const c of list || []) { if (!/\btaobao\.com$/.test(c.domain || '')) continue; if (c.value == null || c.value === '' || c.value === 'undefined') continue; m[c.name] = c.value; } return m; }
async function uploadToSpace(file, cookies) {
  const base = { local: file, ok: false };
  if (!file || !fs.existsSync(file)) return { ...base, error: '文件不存在' };
  const st = fs.statSync(file); if (!st.isFile() || st.size === 0) return { ...base, error: '文件为空' }; if (st.size > MAX_BYTES) return { ...base, error: '超过 20MB' };
  if (!(cookies.cookie2 || cookies.cookie17 || cookies.unb)) return { ...base, error: 'Cookie 缺登录态（cookie2/cookie17/unb）' };
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  const filename = path.basename(file);
  const qs = new URLSearchParams({ _input_charset: 'utf-8', appkey: 'tu', folderId: '0', picCompress: 'false', watermark: 'false' });
  const form = new FormData(); form.append('name', filename);
  form.append('file', new Blob([fs.readFileSync(file)], { type: MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' }), filename);
  let resp; try { resp = await fetch(`${UPLOAD_URL}?${qs}`, { method: 'POST', headers: { 'User-Agent': UA, Referer: REFERER, Origin: ORIGIN, Accept: 'application/json, text/plain, */*', 'Accept-Language': 'zh-CN,zh;q=0.9', Cookie: cookieHeader }, body: form, signal: AbortSignal.timeout(180000) }); } catch (e) { return { ...base, error: `上传请求失败：${e.message}` }; }
  const raw = await resp.text().catch(() => ''); let json = null; try { json = JSON.parse(raw); } catch {}
  if (!json) return { ...base, error: `响应非 JSON（HTTP ${resp.status}）：${raw.slice(0, 200)}` };
  const obj = json.object || {};
  if (json.success === true && obj.url) return { local: file, ok: true, fileId: String(obj.fileId), url: String(obj.url), pix: obj.pix ? String(obj.pix) : undefined, size: String(obj.size || st.size) };
  return { ...base, error: `上传被拒（HTTP ${resp.status}）${json.errorCode ? `[${json.errorCode}] ` : ''}${json.message || ''}` };
}
module.exports = { uploadToSpace, cookieMap };

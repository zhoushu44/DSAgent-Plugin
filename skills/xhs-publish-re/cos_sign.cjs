/*
 * cos_sign.js — 腾讯云 COS v5 签名算法复现（小红书 ROS 上传用）
 * =============================================================
 * 算法来源：chunks/eeddec12375cb942e53c6cf32e8a2258.js 第 12134-12139 行
 * （cos-js-sdk-v5 的 getAuth 实现）
 *
 * 签名串构造：
 *   KeyTime    = "start;end"                     （秒级时间戳，end = start + expires）
 *   SignKey    = HMAC-SHA1(KeyTime, SecretKey)
 *   HttpString = method \n pathname \n params \n headers \n ""     （params/headers 已排序编码）
 *   StringToSign = "sha1\n" + KeyTime + "\n" + SHA1(HttpString) + "\n" + ""
 *   Signature  = HMAC-SHA1(StringToSign, SignKey)
 *
 * 最终 Authorization 头：
 *   q-sign-algorithm=sha1&q-ak=<SecretId>&q-sign-time=<KeyTime>
 *   &q-key-time=<KeyTime>&q-header-list=<h1;h2>&q-url-param-list=<p1;p2>&q-signature=<Signature>
 *
 * 小红书 ROS 特殊性（见 sign_service.js 的 getAuthorization 构造）：
 *   - permit 只返回 SecurityToken（l.token），secretId/secretKey 用字符串 "null" 占位；
 *   - AppId = 1251524319（bucket === "unknown" 时硬编码）；
 *   - 所以 ak = "null"，sk = "null"。
 *
 * 用法：
 *   node cos_sign.js --key spectrum/xxx --method PUT --secret-id null --secret-key null \
 *                    --token <SecurityToken> --start 1792515061 --end 1792602069 \
 *                    --bucket unknown --region unknown --domain ros-upload.xiaohongshu.com
 */
'use strict';

const crypto = require('crypto');

function hmacSHA1(key, data) {
  return crypto.createHmac('sha1', key).update(data).digest();
}

// cos-js-sdk 的 B()：encodeURIComponent 后再处理四个保留字符
function cosEncode(s) {
  return encodeURIComponent(s)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

// cos-js-sdk 的 obj2str：键值对排序 + 编码后用 & 连接
function obj2str(obj, useLow) {
  const list = Object.keys(obj).sort((a, b) => {
    a = a.toLowerCase(); b = b.toLowerCase();
    return a === b ? 0 : (a > b ? 1 : -1);
  });
  const out = [];
  for (const k of list) {
    const v = obj[k] === undefined || obj[k] === null ? '' : String(obj[k]);
    const kk = useLow ? cosEncode(k).toLowerCase() : cosEncode(k);
    const vv = cosEncode(v) || '';
    out.push(`${kk}=${vv}`);
  }
  return out.join('&');
}

// cos-js-sdk 的 N()：只取键名，排序，可选小写
function keyList(obj, useLow) {
  return Object.keys(obj)
    .map((k) => (useLow ? cosEncode(k).toLowerCase() : k))
    .sort((a, b) => {
      a = a.toLowerCase(); b = b.toLowerCase();
      return a === b ? 0 : (a > b ? 1 : -1);
    });
}

// cos-js-sdk 的 v()：只保留 x-cos-* / x-ci-* 和部分标准头
// ★ 注意：实测小红书 ROS 上传时 SDK 只签 content-length;host（见 capture_put.js），
//   cache-control 虽在白名单里但 SDK 未放入 Headers 参与签名。
//   为严格对齐 SDK 行为，默认不签 cache-control / content-type / x-cos-security-token。
const SIGNED_HEADER_WHITELIST = [
  'cache-control', 'content-disposition', 'content-encoding', 'content-length',
  'content-md5', 'expect', 'expires', 'host', 'if-match', 'if-modified-since',
  'if-none-match', 'if-unmodified-since', 'origin', 'range', 'transfer-encoding', 'pic-operations',
];
function filterHeaders(headers) {
  const out = {};
  for (const k of Object.keys(headers || {})) {
    const lk = k.toLowerCase();
    if (lk.indexOf('x-cos-') > -1 || lk.indexOf('x-ci-') > -1 || SIGNED_HEADER_WHITELIST.indexOf(lk) > -1) {
      out[k] = headers[k];
    }
  }
  return out;
}

// 只签 SDK 实际会签的头（严格对齐小红书 ROS 上传行为）
function filterHeadersStrict(headers) {
  const out = {};
  for (const k of Object.keys(headers || {})) {
    const lk = k.toLowerCase();
    if (lk === 'host' || lk === 'content-length') out[k] = headers[k];
  }
  return out;
}

/**
 * 生成 COS Authorization 头
 * @param {object} opt
 *   method, pathname(Key), query{}, headers{}, SecretId, SecretKey, KeyTime("s;e"),
 *   expires, SystemClockOffset, ForceSignHost, Bucket, Region
 */
function getAuth(opt) {
  const SecretId = opt.SecretId;
  const SecretKey = opt.SecretKey;
  const KeyTime = opt.KeyTime;
  const Method = (opt.method || opt.Method || 'get').toLowerCase();
  const Query = opt.Query || opt.params || {};
  const rawHeaders = opt.Headers || opt.headers || {};
  // strict=true 时只签 host + content-length（对齐小红书 ROS 上传实测行为）
  const Headers = opt.strict ? filterHeadersStrict(rawHeaders) : filterHeaders(rawHeaders);
  const Key = opt.Key || '';

  let pathname;
  if (opt.UseRawKey) {
    pathname = opt.Pathname || opt.pathname || '/' + Key;
  } else {
    pathname = opt.Pathname || opt.pathname || Key;
    if (pathname.indexOf('/') !== 0) pathname = '/' + pathname;
  }

  const forceSignHost = opt.ForceSignHost !== false;
  if (!Headers.Host && !Headers.host && opt.Bucket && opt.Region && forceSignHost) {
    Headers.Host = `${opt.Bucket}.cos.${opt.Region}.myqcloud.com`;
  }
  if (!SecretId) throw new Error('missing param SecretId');
  if (!SecretKey) throw new Error('missing param SecretKey');

  const now = Math.round((opt.SystemClockOffset || 0) / 1000) - 1;
  const StartTime = now;
  let EndTime;
  if (opt.Expires === undefined || opt.expires === undefined) EndTime = StartTime + 900;
  else EndTime = StartTime + (opt.Expires || opt.expires) * 1 || 0;

  const keyTime = KeyTime || `${StartTime};${EndTime}`;
  const SignKey = hmacSHA1(keyTime, SecretKey);
  const HeaderList = keyList(Headers, true).join(';').toLowerCase();
  const ParamList = keyList(Query, true).join(';').toLowerCase();

  const HttpString = [
    Method,
    pathname,
    obj2str(Query, true),
    obj2str(Headers, true),
    '',
  ].join('\n');

  const StringToSign = ['sha1', keyTime, crypto.createHash('sha1').update(HttpString).digest('hex'), ''].join('\n');
  const Signature = hmacSHA1(StringToSign, SignKey).toString('hex');

  return [
    `q-sign-algorithm=sha1`,
    `q-ak=${SecretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${HeaderList}`,
    `q-url-param-list=${ParamList}`,
    `q-signature=${Signature}`,
  ].join('&');
}

/* ---------------------- CLI ---------------------- */
if (require.main === module) {
  const argv = process.argv.slice(2);
  const get = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };

  const opt = {
    method: get('--method', 'PUT'),
    Key: get('--key', ''),
    Query: get('--query') ? JSON.parse(get('--query')) : {},
    Headers: get('--headers') ? JSON.parse(get('--headers')) : {},
    SecretId: get('--secret-id', 'null'),
    SecretKey: get('--secret-key', 'null'),
    KeyTime: get('--key-time', ''),
    Bucket: get('--bucket', 'unknown'),
    Region: get('--region', 'unknown'),
  };
  if (!opt.Key) { console.error('缺少 --key'); process.exit(1); }
  if (!opt.KeyTime) { console.error('缺少 --key-time（格式 "start;end"，来自 permit 的 startTime/expireTime，秒级）'); process.exit(1); }

  const auth = getAuth(opt);
  console.log(JSON.stringify({ authorization: auth }, null, 2));
}

module.exports = { getAuth, obj2str, keyList, filterHeaders, filterHeadersStrict, cosEncode };

// 终版抽取：sanitizePddSpecWhitelist 全文（补正则字面量跳过）
import fs from 'node:fs';

const src = fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/rea-gm-modules/m_042_8087.js', 'utf8');

function skipStr(s, k) { const q = s[k]; k++; while (k < s.length && s[k] !== q) { if (s[k] === '\\') k++; k++; } return k; }
function skipTpl(s, k) { k++; while (k < s.length && s[k] !== '`') { if (s[k] === '\\') { k += 2; continue; } if (s[k] === '$' && s[k+1] === '{') { k = balance(s, k+1, '{', '}'); k++; continue; } k++; } return k; }
function skipLine(s, k) { while (k < s.length && s[k] !== '\n') k++; return k; }
function skipBlock(s, k) { k += 2; while (k < s.length && !(s[k] === '*' && s[k+1] === '/')) k++; return k + 2; }
function skipRe(s, k) {
  // k 指向 '/'，跳到正则闭合 '/'（在字符类内不认 '/'）
  let inCls = false, i = k + 1;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { i += 2; continue; }
    if (inCls) { if (c === ']') inCls = false; i++; continue; }
    if (c === '[') { inCls = true; i++; continue; }
    if (c === '/') return i; // 闭合（后面的 flags 由调用方跳过）
    if (c === '\n') return k; // 不是正则，回退
    i++;
  }
  return k;
}
function isReStart(s, k) {
  // prev 非 ( , = : [ ! & | ? { } ; return typeof => 是正则字面量
  let p = k - 1;
  while (p >= 0 && /\s/.test(s[p])) p--;
  if (p < 0) return true;
  const c = s[p];
  if ('(,=:[!&|?{;+-*%~^'.includes(c)) return true;
  const kw = s.slice(Math.max(0, p - 7), p + 1);
  if (/\b(return|typeof|case|in|of|new|delete|void|instanceof)$/.test(kw)) return true;
  return false;
}
function balance(s, from, open, close) {
  let k = from, depth = 0;
  while (k < s.length) {
    const c = s[k];
    if (c === '"' || c === "'") { k = skipStr(s, k); k++; continue; }
    if (c === '`') { k = skipTpl(s, k); k++; continue; }
    if (c === '/' && s[k+1] === '/') { k = skipLine(s, k); continue; }
    if (c === '/' && s[k+1] === '*') { k = skipBlock(s, k); continue; }
    if (c === '/' && isReStart(s, k)) { const end = skipRe(s, k); if (end !== k) { k = end + 1; while (k < s.length && /[a-z]/.test(s[k])) k++; continue; } }
    if (c === open) depth++;
    if (c === close) { depth--; if (depth === 0) return k; }
    k++;
  }
  return -1;
}

const start = 120747;
const pOpen = start + 'sanitizePddSpecWhitelist'.length;
const pClose = balance(src, pOpen, '(', ')');
const bodyStart = pClose + 1;
const bodyEnd = balance(src, bodyStart, '{', '}');
console.log('bodyEnd @', bodyEnd, 'total len', bodyEnd + 1 - start);
console.log('===');
console.log(src.slice(start, bodyEnd + 1));

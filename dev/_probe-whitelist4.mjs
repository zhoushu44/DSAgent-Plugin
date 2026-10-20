// 抽取 sanitizePddSpecWhitelist 定义全文（hit#1 @120747），先定位 body 起点再配平
import fs from 'node:fs';

const src = fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/rea-gm-modules/m_042_8087.js', 'utf8');

function skipStr(s, k) { const q = s[k]; k++; while (k < s.length && s[k] !== q) { if (s[k] === '\\') k++; k++; } return k; }
function skipTpl(s, k) { k++; while (k < s.length && s[k] !== '`') { if (s[k] === '\\') { k += 2; continue; } if (s[k] === '$' && s[k+1] === '{') { k = balance(s, k+1, '{', '}'); k++; continue; } k++; } return k; }
function skipLine(s, k) { while (k < s.length && s[k] !== '\n') k++; return k; }
function skipBlock(s, k) { k += 2; while (k < s.length && !(s[k] === '*' && s[k+1] === '/')) k++; return k + 2; }
function balance(s, from, open, close) {
  let k = from, depth = 0;
  while (k < s.length) {
    const c = s[k];
    if (c === '"' || c === "'") { k = skipStr(s, k); k++; continue; }
    if (c === '`') { k = skipTpl(s, k); k++; continue; }
    if (c === '/' && s[k+1] === '/') { k = skipLine(s, k); continue; }
    if (c === '/' && s[k+1] === '*') { k = skipBlock(s, k); continue; }
    if (c === open) depth++;
    if (c === close) { depth--; if (depth === 0) return k; }
    k++;
  }
  return -1;
}

const start = 120747; // sanitizePddSpecWhitelist(
const pOpen = start + 'sanitizePddSpecWhitelist'.length;
const pClose = balance(src, pOpen, '(', ')');
const bodyStart = pClose + 1;
const bodyEnd = balance(src, bodyStart, '{', '}');
console.log('pClose @', pClose, 'bodyStart @', bodyStart, 'bodyEnd @', bodyEnd, 'total len', bodyEnd + 1 - start);
console.log('===');
console.log(src.slice(start, bodyEnd + 1));

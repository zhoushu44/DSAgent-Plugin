import fs from 'node:fs';
import path from 'node:path';
const skip = new Set(['.git','node_modules','dist','.swarm4']);
function walk(d, out) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f, out); else out.push(f);
  }
  return out;
}
const re = /MQS|觅千手|mqs/i;
let n = 0;
for (const f of walk('.', [])) {
  let t;
  try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
  if (!re.test(t)) continue;
  console.log('== ' + f);
  const lines = t.split(/\r?\n/);
  lines.forEach((l, i) => { if (re.test(l)) console.log('   ' + (i + 1) + ': ' + l.slice(0, 220)); });
  if (++n > 30) break;
}
console.log('files matched: ' + n);

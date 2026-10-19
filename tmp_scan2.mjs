import fs from 'fs';
import path from 'path';
const root = 'C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/rea-gm-modules';
const needles = ['1688', 'iframeHandler', 'winport', 'work.1688.com', 'air.1688.com'];
const out = {};
for (const f of fs.readdirSync(root)) {
  if (!f.endsWith('.js')) continue;
  const t = fs.readFileSync(path.join(root, f), 'utf8');
  for (const n of needles) {
    const c = t.split(n).length - 1;
    if (c) { out[f] = out[f] || {}; out[f][n] = c; }
  }
}
console.log(JSON.stringify(out, null, 1));

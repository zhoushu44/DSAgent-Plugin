import fs from 'fs';
const root = 'C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/';
const files = ['scripts/_gm.js'];
for (const f of files) {
  let t;
  try { t = fs.readFileSync(root + f, 'utf8'); } catch (e) { console.log('MISS', f); continue; }
  console.log('#####', f, 'len=', t.length);
  for (const n of ['iframeHandler', '1688', 'work.1688', 'offer-new', 'winport', 'shelfMethod']) {
    let c = 0, i = -1;
    const pos = [];
    while ((i = t.indexOf(n, i + 1)) !== -1) { c++; if (pos.length < 20) pos.push(i); }
    console.log(n, 'count=', c, 'pos=', pos.join(','));
  }
}

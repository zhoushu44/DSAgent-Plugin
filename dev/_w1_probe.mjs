import fs from 'node:fs';
const GM = 'C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/scripts/_gm.js';
const RC = 'C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/scripts/_remote-config.json';
const gm = fs.readFileSync(GM, 'utf8');
const rc = fs.readFileSync(RC, 'utf8');
const needles = process.argv.slice(2);
for (const n of needles) {
  let i = gm.indexOf(n);
  const hits = [];
  while (i >= 0 && hits.length < 6) { hits.push(i); i = gm.indexOf(n, i + 1); }
  const rcI = rc.indexOf(n);
  console.log(JSON.stringify({ needle: n, gmLen: gm.length, gmHits: hits, rcHit: rcI }));
}

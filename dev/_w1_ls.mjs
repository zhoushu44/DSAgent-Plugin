import fs from 'node:fs';
const dirs = [
  'C:/Users/Administrator/mqs-swarm-docs-result',
  'C:/Users/Administrator/AppData/Local/Temp/mqs-swarm',
  'C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/scripts',
  'C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/src-mirror',
];
for (const d of dirs) {
  console.log('### ' + d);
  try {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      let sz = '';
      if (e.isFile()) { try { sz = fs.statSync(d + '/' + e.name).size; } catch {} }
      console.log('  ' + (e.isDirectory() ? 'DIR ' : '    ') + e.name + ' ' + sz);
    }
  } catch (err) { console.log('  ERR ' + err.message); }
}

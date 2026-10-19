import fs from 'node:fs';
const GM = 'C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/scripts/_gm.js';
const buf = fs.readFileSync(GM);
const gm = buf.toString('utf8');
console.log('bytes=' + buf.length + ' chars=' + gm.length);
console.log('bom=' + (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf));
console.log('crlf=' + gm.includes('\r\n') + ' lf=' + gm.includes('\n'));
console.log('tail=' + JSON.stringify(gm.slice(-20)));
const anchors = process.argv.slice(2);
for (const a of anchors) {
  const i = gm.indexOf(a);
  console.log('--- ' + a + ' => ' + i);
  if (i >= 0) console.log(JSON.stringify(gm.slice(Math.max(0, i - 60), i + 160)));
}

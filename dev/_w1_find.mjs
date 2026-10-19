import fs from 'node:fs';
const needle = process.argv[2];
const out = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === '.dsagent') continue;
    const p = d + '/' + e.name;
    if (e.isDirectory()) walk(p);
    else if (/\.(md|ts|json|yml|mjs)$/.test(e.name)) {
      const t = fs.readFileSync(p, 'utf8');
      if (t.includes(needle)) out.push(p + '  hits=' + (t.split(needle).length - 1));
    }
  }
}
walk('.');
console.log(out.join('\n'));

import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
const re = new RegExp(process.argv[3], 'i');
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|mjs|js|json|md)$/.test(e.name)) {
      const s = fs.readFileSync(p, 'utf8');
      const lines = s.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) console.log(p + ':' + (i + 1) + ': ' + lines[i].slice(0, 200));
      }
    }
  }
}
walk(root);

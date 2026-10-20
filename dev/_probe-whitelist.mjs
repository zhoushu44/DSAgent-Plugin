// 探测 sanitizePddSpecWhitelist 在哪个模块定义（8087 清单中缺席，疑似 m_040_6169.js）
import fs from 'node:fs';
import path from 'node:path';

const dir = 'C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/rea-gm-modules';
const files = fs.readdirSync(dir).filter(f => /^m_\d+_.*\.js$/.test(f));
const target = 'sanitizePddSpecWhitelist';

for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const hits = [];
  let idx = 0;
  while ((idx = src.indexOf(target, idx)) !== -1) {
    const prev = idx > 0 ? src[idx - 1] : '';
    const next = src[idx + target.length] || '';
    hits.push({ off: idx, prev, next, isDef: !/[._$A-Za-z0-9]/.test(prev) && next === '(' });
    idx += target.length;
  }
  if (hits.length) {
    const defs = hits.filter(h => h.isDef);
    console.log(`${f}: ${hits.length} refs, ${defs.length} defs @ ${defs.map(d => d.off).join(',')}`);
  }
}

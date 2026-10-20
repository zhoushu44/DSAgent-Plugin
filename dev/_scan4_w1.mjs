import fs from 'node:fs';
import path from 'node:path';
const pats = ['item.upload.taobao.com', 'sell.publish.tmall.com', 'wares-jdm.jd.com', 'work.1688.com', 'haohuo.jinritemai.com', 'mms.pinduoduo.com', 'sale.1688.com', 'fxg.jinritemai.com', 'creator.douyin.com'];
function walk(d) {
  for (const f of fs.readdirSync(d)) {
    if (f === '.git' || f === 'node_modules' || f.startsWith('.commit-verify')) continue;
    const p = path.join(d, f);
    let s;
    try { s = fs.statSync(p); } catch { continue; }
    if (s.isDirectory()) walk(p);
    else if (/\.(md|ts|mjs|json|yml)$/.test(f)) {
      const t = fs.readFileSync(p, 'utf8');
      const lines = t.split(/\r?\n/);
      lines.forEach((l, i) => {
        for (const pat of pats) if (l.includes(pat)) { console.log(`${p}:${i + 1}: ${l.trim().slice(0, 160)}`); break; }
      });
    }
  }
}
walk('.');

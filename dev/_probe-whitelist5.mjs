// 直接 dump bodyStart 起点后 2000 字符原文，人工定位方法体结束与配平失败原因
import fs from 'node:fs';
const src = fs.readFileSync('C:/Users/Administrator/AppData/Local/Temp/mqs-swarm/rea-gm-modules/m_042_8087.js', 'utf8');
console.log(JSON.stringify(src.slice(120774, 120774 + 2000)));

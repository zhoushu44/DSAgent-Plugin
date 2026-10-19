import fs from 'node:fs'
const list = [
  'skills/pdd-publish-2/SKILL.md',
  'skills/douyin-crawl/SKILL.md',
  'skills/douyin-publish/SKILL.md',
  'skills/taobao-publish/SKILL.md',
  'skills/xianyu-publish/SKILL.md',
  'skills/ali1688-pick/SKILL.md',
  'src/taobao-publish.ts',
  'src/douyin-publish.ts',
  'src/pdd-publish.ts',
  'dev/verify-mqs-skills.mjs',
  'publish-config/taobao.json',
  'skills/image-prompt-guide/references/platform-specs-china.md',
  'docs/mqs-publish-platform-matrix.md',
]
for (const p of list) console.log((fs.existsSync(p) ? 'OK   ' : 'MISS ') + p)

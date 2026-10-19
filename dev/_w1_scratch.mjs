import { execSync } from 'node:child_process'

const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean)
const scratch = /(^|\/)(tmp_|probe\.|probe_|debug_|_scan|_p3\.|_dirs\.|w2files|mqs_hits|probe_out|ifiles|dev_tmp|_w1_|_read_ext|_tools_tmp)/i
const hits = files.filter((f) => scratch.test(f))
console.log('tracked files: ' + files.length)
console.log('scratch candidates: ' + hits.length)
for (const h of hits) console.log('  ' + h)

import { readFileSync } from 'node:fs'
const [file, ...pats] = process.argv.slice(2)
const lines = readFileSync(file, 'utf8').split(/\r?\n/)
lines.forEach((l, i) => {
  if (pats.some((p) => l.toLowerCase().includes(p.toLowerCase()))) console.log(`${i + 1}: ${l}`)
})

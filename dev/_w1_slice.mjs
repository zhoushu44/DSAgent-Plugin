import { readFileSync } from 'node:fs'
const [file, a, b] = process.argv.slice(2)
const lines = readFileSync(file, 'utf8').split(/\r?\n/)
const start = Number(a || 1) - 1
const end = Number(b || lines.length)
lines.slice(start, end).forEach((l, i) => console.log(`${start + i + 1}: ${l}`))

#!/usr/bin/env node
// 归档 r3 逆向证据文件（extracted/）到项目 docs/pdd-publish-mode2/evidence/
// 防止 Temp 清理导致证据丢失。幂等：重复执行只同步差异。
import { copyFileSync, mkdirSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = String.raw`C:\Users\Administrator\AppData\Local\Temp\mqs-swarm\extracted`;
const DST = fileURLToPath(new URL("./evidence/", import.meta.url));

mkdirSync(DST, { recursive: true });
const files = readdirSync(SRC).filter((f) => f.endsWith(".js"));
const manifest = [];
let copied = 0, skipped = 0;
for (const f of files) {
  const s = join(SRC, f), d = join(DST, f);
  const same = existsSync(d) && statSync(d).size === statSync(s).size;
  if (!same) { copyFileSync(s, d); copied++; } else skipped++;
  manifest.push({ file: f, bytes: statSync(s).size });
}
manifest.sort((a, b) => a.file.localeCompare(b.file));
writeFileSync(join(DST, "_manifest.json"), JSON.stringify({ archivedAt: new Date().toISOString(), count: manifest.length, files: manifest }, null, 2));
console.log(`archived: ${copied} copied, ${skipped} skipped, ${manifest.length} total -> ${DST}`);

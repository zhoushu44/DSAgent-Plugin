import fs from 'node:fs';
import path from 'node:path';
import { validateSkill, scoreSkill, parseToolTriggers, detectYamlHazards, splitSkillMarkdown } from '../lib/services/skill-quality.js';

const root = process.argv[2] || 'skills';
const dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);

const rows = [];
for (const d of dirs) {
  const p = path.join(root, d, 'SKILL.md');
  if (!fs.existsSync(p)) continue;
  const raw = fs.readFileSync(p, 'utf8');
  const v = validateSkill(raw);
  const { frontmatter } = splitSkillMarkdown(raw);
  rows.push({
    id: d,
    score: v.score.score,
    ok: v.ok,
    errors: v.issues.filter(i => i.severity === 'error'),
    warns: v.issues.filter(i => i.severity === 'warn'),
    triggers: parseToolTriggers(frontmatter).length,
    hazards: detectYamlHazards(frontmatter),
    breakdown: v.score.breakdown,
  });
}

console.log(`TOTAL SKILLS: ${rows.length}`);
const dist = { '1.00': 0, '0.85-0.99': 0, '0.70-0.84': 0, '<0.70': 0 };
for (const r of rows) {
  if (r.score >= 1) dist['1.00']++;
  else if (r.score >= 0.85) dist['0.85-0.99']++;
  else if (r.score >= 0.70) dist['0.70-0.84']++;
  else dist['<0.70']++;
}
console.log('\n=== SCORE DISTRIBUTION (bilingual slots) ===');
for (const [k, v] of Object.entries(dist)) console.log(`  ${k.padEnd(10)} ${v}`);
const avg = rows.reduce((a, r) => a + r.score, 0) / rows.length;
console.log(`  average: ${avg.toFixed(3)}   (was 0.600 with Accio's English-only rubric)`);

console.log('\n=== SLOT COVERAGE ===');
const cnt = (f) => rows.filter(f).length;
console.log(`  has workflow slot      ${cnt(r => r.breakdown.hasWorkflow)} / ${rows.length}`);
console.log(`  has error-handling     ${cnt(r => r.breakdown.hasErrorHandling)} / ${rows.length}`);
console.log(`  has precondition       ${cnt(r => r.breakdown.hasPrecondition)} / ${rows.length}`);
console.log(`  body >= 200 chars      ${cnt(r => r.breakdown.bodyLongEnough)} / ${rows.length}`);
console.log(`  has ## section         ${cnt(r => r.breakdown.hasSection)} / ${rows.length}`);

console.log('\n=== REMAINING ISSUES ===');
const issueCounts = {};
for (const r of rows) for (const i of [...r.errors, ...r.warns]) issueCounts[i.code] = (issueCounts[i.code] ?? 0) + 1;
for (const [k, v] of Object.entries(issueCounts).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(26)} ${v}`);

console.log('\n=== SKILLS STILL BELOW 1.00 ===');
for (const r of rows.filter(r => r.score < 1).sort((a, b) => a.score - b.score)) {
  console.log(`  ${r.id.padEnd(36)} ${r.score.toFixed(2)}  ` + r.errors.map(e => e.code).join(','));
}

console.log('\n=== YAML HAZARDS ===');
let hazardTotal = 0;
for (const r of rows) {
  if (!r.hazards.length) continue;
  hazardTotal += r.hazards.length;
  console.log(`  ${r.id}: ` + r.hazards.map(h => `${h.key}=${h.char}`).join(', '));
}
console.log(`  total hazards: ${hazardTotal}`);

console.log('\n=== tool_triggers DECLARED ===');
console.log(`  skills with tool_triggers: ${cnt(r => r.triggers > 0)} / ${rows.length}`);

// Files a tailoring result produced outside the app (e.g. in a Claude chat) into the archive.
// usage: node scripts/import-result.js <job.json> <result.json> [notes]
import fs from 'node:fs';
import { typeset } from '../server/render.js';
import * as store from '../server/store.js';

const [jobFile, resultFile, notes = ''] = process.argv.slice(2);
if (!jobFile || !resultFile) {
  console.error('usage: node scripts/import-result.js <job.json> <result.json> [notes]');
  process.exit(1);
}
const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
const t = await typeset(result.cv, { title: `${result.cv.name} — CV — ${result.file_label}` });
if (t.overflowLines > 0) {
  console.error(`Doesn't fit: over by ~${t.overflowLines} lines.`);
  process.exit(1);
}
const now = new Date().toISOString();
const run = {
  id: store.newRunId(result.file_label || job.company),
  createdAt: now,
  updatedAt: now,
  job,
  notes,
  result,
  render: { scale: t.scale, fill: t.fill },
  engine: 'import',
  model: 'imported',
  versions: [],
};
store.saveRun(run, t.pdf);
console.log(`Filed ${run.id} · scale ${t.scale} · ${Math.round(t.fill * 100)}% full`);

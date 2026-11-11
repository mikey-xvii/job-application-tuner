// Tiny file-based store: the baseline CV lives in data/base-cv.md, each tailored CV in data/runs/<id>/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = path.join(ROOT, 'data');
const RUNS = path.join(DATA, 'runs');
const BASE = path.join(DATA, 'base-cv.md');
const HISTORY = path.join(DATA, 'base-history');
const KEEP = 30;
fs.mkdirSync(RUNS, { recursive: true });
fs.mkdirSync(HISTORY, { recursive: true });

const versions = () =>
  fs
    .readdirSync(HISTORY)
    .filter((f) => f.endsWith('.md'))
    .sort();

export function readBase() {
  const versionsKept = versions().length;
  if (!fs.existsSync(BASE)) return { markdown: '', updatedAt: null, versionsKept };
  return { markdown: fs.readFileSync(BASE, 'utf8'), updatedAt: fs.statSync(BASE).mtime.toISOString(), versionsKept };
}

/** Saves the baseline, keeping the previous version in data/base-history/ (last 30). */
export function writeBase(markdown) {
  if (fs.existsSync(BASE)) {
    const old = fs.readFileSync(BASE, 'utf8');
    if (old === markdown) return readBase();
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
    fs.writeFileSync(path.join(HISTORY, `${stamp}.md`), old);
    for (const f of versions().slice(0, -KEEP)) fs.rmSync(path.join(HISTORY, f));
  }
  fs.writeFileSync(BASE, markdown);
  return readBase();
}

/** Restores the most recent saved version (and drops it from history). */
export function undoBase() {
  const last = versions().at(-1);
  if (!last) throw new Error('No earlier version to go back to.');
  const f = path.join(HISTORY, last);
  fs.writeFileSync(BASE, fs.readFileSync(f, 'utf8'));
  fs.rmSync(f);
  return readBase();
}

const slug = (s = '') =>
  s
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40) || 'job';

export function newRunId(label) {
  const d = new Date();
  const stamp = d.toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2');
  return `${stamp}-${slug(label).toLowerCase()}`;
}

const dir = (id) => {
  if (!/^[\w-]+$/.test(id)) throw new Error('Bad run id');
  return path.join(RUNS, id);
};

export function saveRun(run, pdf) {
  const d = dir(run.id);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'run.json'), JSON.stringify(run, null, 2));
  if (pdf) fs.writeFileSync(path.join(d, 'cv.pdf'), pdf);
  return run;
}

export function getRun(id) {
  const f = path.join(dir(id), 'run.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

export function pdfPath(id) {
  const f = path.join(dir(id), 'cv.pdf');
  return fs.existsSync(f) ? f : null;
}

export function deleteRun(id) {
  fs.rmSync(dir(id), { recursive: true, force: true });
}

export function listRuns() {
  return fs
    .readdirSync(RUNS)
    .filter((id) => fs.existsSync(path.join(RUNS, id, 'run.json')))
    .map((id) => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(RUNS, id, 'run.json'), 'utf8'));
        return {
          id: r.id,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          company: r.result?.analysis?.company || r.job?.company || '',
          role: r.result?.analysis?.role || r.job?.title || '',
          location: r.result?.analysis?.location || r.job?.location || '',
          fit: r.result?.analysis?.fit_score ?? null,
          keywords: (r.result?.analysis?.keywords || []).slice(0, 6),
          url: r.job?.url || '',
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

/** Set a value by dotted path ("sections.0.entries.1.bullets.2") — used by the in-preview editor. */
export function setPath(obj, p, value) {
  const keys = p.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    o = o?.[keys[i]];
    if (o == null) throw new Error(`Unknown field ${p}`);
  }
  const last = keys.at(-1);
  if (!(last in o)) throw new Error(`Unknown field ${p}`);
  o[last] = value;
}

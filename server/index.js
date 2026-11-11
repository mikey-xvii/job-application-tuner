// CV Tuner — local server.  npm start → http://localhost:4321
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrapeJob, jobFromText } from './scrape.js';
import { tailor, digestIntoBase, engineInfo, DIGEST_EFFORT } from './claude.js';
import { typeset, chromePath } from './render.js';
import { cvHtml } from './template.js';
import * as store from './store.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 4321);
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

/* ───────────────────────────── helpers ───────────────────────────── */

function ndjson(res) {
  res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('cache-control', 'no-cache');
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders();
  let open = true;
  res.on('close', () => (open = false));
  return (o) => open && res.write(JSON.stringify(o) + '\n');
}

const stage = (send, id, state, extra = {}) => send({ type: 'stage', id, state, at: Date.now(), ...extra });

/** Last-resort shave: drop the final bullet of the longest entry until it fits. */
function shaveOne(cv) {
  let best = null;
  cv.sections.forEach((s) =>
    (s.entries || []).forEach((e) => {
      if ((e.bullets?.length || 0) > 1 && (!best || e.bullets.length >= best.bullets.length)) best = e;
    }),
  );
  if (!best) return false;
  best.bullets.pop();
  return true;
}

function pdfTitle(cv, label) {
  return `${cv.name} — CV${label ? ` — ${label}` : ''}`;
}

/** Typeset, asking Claude to trim (twice at most) if the page overflows. */
async function fitToPage({ send, out, base, job, notes }) {
  let result = out.result;
  let t = await typeset(result.cv, { title: pdfTitle(result.cv, result.file_label) });
  let trimmed = false;
  for (let attempt = 1; t.overflowLines > 0 && attempt <= 2; attempt++) {
    trimmed = true;
    stage(send, 'trim', 'active', { detail: `Over by ~${t.overflowLines} line${t.overflowLines > 1 ? 's' : ''} — asking Claude to tighten` });
    const again = await tailor({ base, job, notes, currentCv: result.cv, overflowLines: t.overflowLines }, send);
    result = { ...again.result, changes: [...new Set([...(result.changes || []), ...(again.result.changes || [])])].slice(0, 6) };
    t = await typeset(result.cv, { title: pdfTitle(result.cv, result.file_label) });
  }
  let shaved = 0;
  if (t.overflowLines > 0 && !trimmed) stage(send, 'trim', 'active', { detail: 'Dropping the lowest-priority bullets' });
  while (t.overflowLines > 0 && shaveOne(result.cv) && shaved < 8) {
    shaved++;
    t = await typeset(result.cv, { title: pdfTitle(result.cv, result.file_label) });
  }
  if (t.overflowLines > 0) throw new Error('Could not fit the CV on one page.');
  if (shaved) result.changes = [...(result.changes || []), `Trimmed ${shaved} lower-priority bullet${shaved > 1 ? 's' : ''} to keep it to one page`];
  if (trimmed || shaved) stage(send, 'trim', 'done');
  return { result, t };
}

function runSummaryFor(run) {
  return { ...run, pdfUrl: `/runs/${run.id}/cv.pdf`, previewUrl: `/runs/${run.id}/preview` };
}

/* ────────────────────────────── routes ────────────────────────────── */

app.get('/api/status', (_req, res) => {
  const base = store.readBase();
  res.json({ ...engineInfo(), chrome: Boolean(chromePath()), hasBase: Boolean(base.markdown.trim()) });
});

app.get('/api/base', (_req, res) => res.json(store.readBase()));
app.put('/api/base', (req, res) => {
  const md = String(req.body?.markdown ?? '');
  if (!md.trim()) return res.status(400).json({ error: 'The baseline is empty.' });
  res.json(store.writeBase(md));
});

app.post('/api/base/undo', (_req, res) => {
  try {
    res.json(store.undoBase());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Claude folds a free-text note into the baseline; returns a proposal (not saved until accepted).
app.post('/api/base/digest', async (req, res) => {
  const send = ndjson(res);
  try {
    const note = String(req.body?.note || '').trim();
    if (note.length < 3) throw new Error('Write something to add first.');
    const saved = store.readBase().markdown;
    // Follow-up notes (e.g. answers to Claude's questions) refine the pending, unsaved draft.
    const draft = typeof req.body?.draft === 'string' && req.body.draft.trim() ? req.body.draft : saved;
    stage(send, 'digest', 'active', { engine: { ...engineInfo(), effort: DIGEST_EFFORT } });
    const { proposal } = await digestIntoBase({ base: draft, note }, send);
    stage(send, 'digest', 'done');
    send({ type: 'proposal', proposal, base: saved });
  } catch (e) {
    console.error(e);
    send({ type: 'error', message: e.message });
  }
  res.end();
});

app.post('/api/job', async (req, res) => {
  try {
    res.json(await scrapeJob(String(req.body?.url || '').trim()));
  } catch (e) {
    res.status(422).json({ error: e.message });
  }
});

app.post('/api/tailor', async (req, res) => {
  const send = ndjson(res);
  const { url = '', text = '', notes = '', job: prefetched } = req.body || {};
  try {
    const base = store.readBase().markdown;
    if (!base.trim()) throw new Error('Add your baseline CV first.');

    stage(send, 'read', 'active');
    // The UI previews the posting as soon as a link is pasted; reuse that instead of fetching twice.
    const job = text.trim()
      ? jobFromText(text)
      : prefetched?.description && prefetched.url
        ? prefetched
        : await scrapeJob(url.trim());
    send({ type: 'job', job });
    stage(send, 'read', 'done');

    stage(send, 'think', 'active', { engine: engineInfo() });
    const out = await tailor({ base, job, notes }, send);
    stage(send, 'think', 'done');

    stage(send, 'set', 'active');
    const { result, t } = await fitToPage({ send, out, base, job, notes });
    stage(send, 'set', 'done', { detail: `Type at ${(9.12 * t.scale).toFixed(2)}pt · page ${Math.round(t.fill * 100)}% full` });

    stage(send, 'print', 'active');
    const now = new Date().toISOString();
    const run = {
      id: store.newRunId(result.file_label || result.analysis.company || job.company),
      createdAt: now,
      updatedAt: now,
      job,
      notes,
      result,
      render: { scale: t.scale, fill: t.fill },
      engine: out.engine,
      model: out.servedBy,
      versions: [],
    };
    store.saveRun(run, t.pdf);
    stage(send, 'print', 'done');
    send({ type: 'done', run: runSummaryFor(run) });
  } catch (e) {
    console.error(e);
    send({ type: 'error', message: e.message });
  }
  res.end();
});

app.post('/api/runs/:id/refine', async (req, res) => {
  const send = ndjson(res);
  try {
    const run = store.getRun(req.params.id);
    if (!run) throw new Error('That CV no longer exists.');
    const instruction = String(req.body?.instruction || '').trim();
    if (!instruction) throw new Error('Tell Claude what to change.');
    const base = store.readBase().markdown;

    stage(send, 'think', 'active', { engine: engineInfo() });
    const out = await tailor({ base, job: run.job, notes: run.notes, currentCv: run.result.cv, instruction }, send);
    stage(send, 'think', 'done');

    stage(send, 'set', 'active');
    const { result, t } = await fitToPage({ send, out, base, job: run.job, notes: run.notes });
    stage(send, 'set', 'done', { detail: `Type at ${(9.12 * t.scale).toFixed(2)}pt · page ${Math.round(t.fill * 100)}% full` });

    stage(send, 'print', 'active');
    run.versions = [...(run.versions || []), { at: run.updatedAt, result: run.result, instruction }].slice(-10);
    run.result = result;
    run.render = { scale: t.scale, fill: t.fill };
    run.updatedAt = new Date().toISOString();
    store.saveRun(run, t.pdf);
    stage(send, 'print', 'done');
    send({ type: 'done', run: runSummaryFor(run) });
  } catch (e) {
    console.error(e);
    send({ type: 'error', message: e.message });
  }
  res.end();
});

// Direct text edits made in the preview.
app.put('/api/runs/:id/cv', async (req, res) => {
  try {
    const run = store.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Not found' });
    const cv = structuredClone(run.result.cv);
    for (const { path: p, text } of req.body?.edits || []) store.setPath(cv, p, String(text));
    // Emptied bullets / details disappear.
    for (const s of cv.sections)
      for (const e of s.entries || []) {
        e.bullets = (e.bullets || []).filter((b) => b.trim());
        e.details = (e.details || []).filter((d) => d.trim());
      }
    const t = await typeset(cv, { title: pdfTitle(cv, run.result.file_label) });
    if (t.overflowLines > 0)
      return res.status(422).json({ error: `That pushes the CV past one page by ~${t.overflowLines} line(s). Shorten something and save again.` });
    run.versions = [...(run.versions || []), { at: run.updatedAt, result: run.result, instruction: 'manual edit' }].slice(-10);
    run.result = { ...run.result, cv };
    run.render = { scale: t.scale, fill: t.fill };
    run.updatedAt = new Date().toISOString();
    store.saveRun(run, t.pdf);
    res.json(runSummaryFor(run));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/runs', (_req, res) => res.json(store.listRuns()));
app.get('/api/runs/:id', (req, res) => {
  const run = store.getRun(req.params.id);
  run ? res.json(runSummaryFor(run)) : res.status(404).json({ error: 'Not found' });
});
app.delete('/api/runs/:id', (req, res) => {
  store.deleteRun(req.params.id);
  res.json({ ok: true });
});

app.get('/runs/:id/preview', (req, res) => {
  const run = store.getRun(req.params.id);
  if (!run) return res.status(404).send('Not found');
  res.type('html').send(cvHtml(run.result.cv, { editable: req.query.edit === '1', title: 'Preview' }));
});

app.get('/runs/:id/cv.pdf', (req, res) => {
  const run = store.getRun(req.params.id);
  const f = run && store.pdfPath(run.id);
  if (!f) return res.status(404).send('Not found');
  const who = (run.result.cv.name || 'CV')
    .split(/\s+/)
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join('_');
  const label = (run.result.file_label || '').replace(/[^\w-]+/g, '_');
  const name = `${who}_CV${label ? `_${label}` : ''}.pdf`;
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${name}"`);
  fs.createReadStream(f).pipe(res);
});

app.listen(PORT, '127.0.0.1', () => {
  const e = engineInfo();
  console.log(`\n  CV Tuner  →  http://localhost:${PORT}`);
  console.log(`  Claude    →  ${e.label}${e.engine ? ` · ${e.model} · effort ${e.effort}` : ' (add ANTHROPIC_API_KEY to .env or log in to Claude Code)'}`);
  console.log(`  Chrome    →  ${chromePath() || 'NOT FOUND (set CHROME_PATH)'}\n`);
});

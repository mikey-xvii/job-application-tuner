// CV Tuner — front end. No framework, no build step.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  status: null,
  base: '',
  job: null, // last fetched job (for the current URL)
  jobUrl: '',
  run: null,
  runs: [],
  busy: false,
  edits: new Map(),
  editing: false,
  lockTarget: null,
};

/* ─────────────────────────── small UI helpers ─────────────────────────── */

function toast(msg, err = false) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = `toast${err ? ' err' : ''}`;
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), err ? 6000 : 3200);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

const fmtDate = (iso, opts) => new Date(iso).toLocaleDateString('en-GB', opts);
function ago(iso) {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} days ago`;
  return fmtDate(iso, { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ─────────────────────────── masthead ─────────────────────────── */

function setName(name) {
  const el = $('#name');
  el.setAttribute('aria-label', name);
  el.innerHTML = [...name]
    .map((c, i) => (c === ' ' ? `<span class="ch sp" style="--i:${i}"> </span>` : `<span class="ch" style="--i:${i}">${esc(c)}</span>`))
    .join('');
}

// Every few seconds a letter gets "re-struck" like a typewriter key.
setInterval(() => {
  if (reduced || document.hidden) return;
  const chars = [...document.querySelectorAll('.name .ch:not(.sp)')];
  const c = chars[Math.floor(Math.random() * chars.length)];
  if (!c) return;
  c.classList.remove('strike');
  void c.offsetWidth;
  c.classList.add('strike');
}, 2300);

// Live clock in the "contact" line.
function tickClock() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const city = tz.split('/').pop().replace(/_/g, ' ');
  const d = new Date();
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { hour12: false });
  $('#clock').textContent = `${city} · ${day} · ${time}`;
}
tickClock();
setInterval(tickClock, 1000);

// Typewriter: "tailored for ____", cycling through targets (or locked to the current job).
const DEFAULT_TARGETS = ['BlackRock', 'Goldman Sachs', 'the HKMA', 'McKinsey & Company', 'J.P. Morgan', 'HKEX', 'your next role'];
async function typewriter() {
  const el = $('#target-text');
  const wrap = $('#target');
  let i = 0;
  for (;;) {
    const pool = [...new Set([...state.runs.map((r) => r.company).filter(Boolean), ...DEFAULT_TARGETS])];
    const word = state.lockTarget || pool[i++ % pool.length];
    wrap.classList.remove('inked');
    for (let k = 1; k <= word.length; k++) {
      el.textContent = word.slice(0, k);
      await sleep(55 + Math.random() * 70);
    }
    void wrap.offsetWidth;
    wrap.classList.add('inked');
    // Hold; if locked, stay until the lock changes.
    const held = word;
    for (let t = 0; t < 26 || (state.lockTarget && state.lockTarget === held); t++) await sleep(100);
    for (let k = word.length; k >= 0; k--) {
      el.textContent = word.slice(0, k);
      await sleep(28);
    }
    await sleep(280);
  }
}

/* ─────────────────────────── glyph field (always moving) ─────────────────────────── */

function glyphField() {
  const cv = $('#glyphs');
  const ctx = cv.getContext('2d');
  const G = ['§', '¶', '†', '‡', '•', '&', '⁂', '❦', '※', '“', '”', '«', '»', '∴', '◊', 'ℓ', '№'];
  let W, H, dpr;
  const mouse = { x: -999, y: -999 };
  const parts = [];
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = cv.width = innerWidth * dpr;
    H = cv.height = innerHeight * dpr;
  }
  resize();
  addEventListener('resize', resize);
  addEventListener('pointermove', (e) => ((mouse.x = e.clientX * dpr), (mouse.y = e.clientY * dpr)));
  const N = Math.round(Math.min(70, (innerWidth * innerHeight) / 26000));
  for (let i = 0; i < N; i++) {
    parts.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: 0,
      vy: 0,
      s: (14 + Math.random() * 38) * dpr,
      r: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.004,
      a: 0.05 + Math.random() * 0.1,
      red: Math.random() < 0.08,
      g: G[Math.floor(Math.random() * G.length)],
      sp: 0.12 + Math.random() * 0.3,
    });
  }
  function frame() {
    ctx.clearRect(0, 0, W, H);
    const speed = state.busy ? 3.2 : 1;
    for (const p of parts) {
      const dx = p.x - mouse.x;
      const dy = p.y - mouse.y;
      const d2 = dx * dx + dy * dy;
      const R = 150 * dpr;
      if (d2 < R * R) {
        const d = Math.sqrt(d2) || 1;
        const f = (1 - d / R) * 0.9;
        p.vx += (dx / d) * f;
        p.vy += (dy / d) * f;
      }
      p.vx *= 0.93;
      p.vy *= 0.93;
      p.x += p.vx + Math.sin((p.y + p.s) / (90 * dpr)) * 0.15 * dpr;
      p.y += p.vy - p.sp * speed * dpr;
      p.r += p.vr * speed;
      if (p.y < -60 * dpr) ((p.y = H + 40 * dpr), (p.x = Math.random() * W));
      if (p.x < -60 * dpr) p.x = W + 40 * dpr;
      if (p.x > W + 60 * dpr) p.x = -40 * dpr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.font = `italic ${p.s}px "Instrument Serif", Georgia, serif`;
      ctx.fillStyle = p.red ? `rgba(181,48,28,${p.a * 1.4})` : `rgba(21,19,15,${p.a})`;
      ctx.textAlign = 'center';
      ctx.fillText(p.g, 0, 0);
      ctx.restore();
    }
    if (!reduced) requestAnimationFrame(frame);
  }
  frame();
}

/* ─────────────────────────── confetti of typographic marks ─────────────────────────── */

function burst(x, y, n = 38) {
  if (reduced) return;
  const G = ['•', '§', '¶', '✓', '†', '‡', '❦', '&'];
  for (let i = 0; i < n; i++) {
    const b = document.createElement('span');
    b.className = 'bit';
    b.textContent = G[i % G.length];
    b.style.left = `${x}px`;
    b.style.top = `${y}px`;
    b.style.color = Math.random() < 0.35 ? 'var(--red)' : 'var(--ink)';
    b.style.fontFamily = Math.random() < 0.5 ? 'var(--display)' : 'var(--serif)';
    b.style.fontSize = `${14 + Math.random() * 22}px`;
    document.body.append(b);
    const ang = Math.random() * Math.PI * 2;
    const v = 120 + Math.random() * 240;
    const dx = Math.cos(ang) * v;
    const dy = Math.sin(ang) * v - 120;
    const rot = (Math.random() - 0.5) * 720;
    b.animate(
      [
        { transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx * 0.6}px), calc(-50% + ${dy * 0.6}px)) rotate(${rot * 0.6}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 260}px)) rotate(${rot}deg)`, opacity: 0 },
      ],
      { duration: 1300 + Math.random() * 900, easing: 'cubic-bezier(.2,.7,.4,1)' },
    ).onfinish = () => b.remove();
  }
}

/* ─────────────────────────── ticker ─────────────────────────── */

function renderTicker() {
  const items = [];
  for (const r of state.runs.slice(0, 12)) {
    if (r.company) items.push(`${esc(r.company)} <i>${r.fit ?? '–'} ▲</i>`);
    for (const k of r.keywords.slice(0, 3)) items.push(esc(k));
  }
  if (items.length < 6)
    items.push('Paste a link', 'Get a page', 'One page, always', 'Times New Roman 9.12pt', 'Nothing invented', 'Written by Claude', 'References available on request');
  const html = items.map((x) => `<span class="item">${x}</span><span class="sep">✦</span>`).join('');
  $('#ticker').innerHTML = html + html; // doubled for a seamless loop
  $('#ticker').style.animationDuration = `${Math.max(40, items.length * 5)}s`;
}

/* ─────────────────────────── status ─────────────────────────── */

async function loadStatus() {
  try {
    const s = (state.status = await api('/api/status'));
    const pretty = s.model.replace(/^claude-/, 'Claude ').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-(\d+)$/, ' $1').replace(/\b(opus|sonnet|haiku|fable)\b/i, (m) => m[0].toUpperCase() + m.slice(1));
    $('#engine-text').textContent = s.engine ? `${pretty} · via ${s.label}` : 'Claude not connected';
    $('#engine').classList.toggle('off', !s.engine);
    const problems = [];
    if (!s.engine)
      problems.push('Claude isn’t connected. Add <code>ANTHROPIC_API_KEY=…</code> to <code>.env</code> and restart, or log in to the Claude Code CLI (<code>claude</code>, then <code>/login</code>).');
    if (!s.chrome) problems.push('Google Chrome wasn’t found — it’s needed to print the PDF. Set <code>CHROME_PATH</code> in <code>.env</code>.');
    $('#notice').hidden = !problems.length;
    $('#notice').innerHTML = problems.join('<br>');
  } catch {
    $('#engine-text').textContent = 'server unreachable';
    $('#engine').classList.add('off');
  }
}

/* ─────────────────────────── I. baseline ─────────────────────────── */

function analyseBase(md) {
  const lines = md.split('\n').map((l) => l.trim());
  const name = (lines.find((l) => l && !l.startsWith('#')) || '').replace(/[*_#]/g, '').trim();
  const roles = lines.filter((l) => /^\*[^*].*\*$/.test(l)).map((l) => l.replace(/^\*|\*$/g, ''));
  const degrees = lines.filter((l) => /^_[^_].*_$/.test(l)).map((l) => l.replace(/^_|_$/g, ''));
  const bullets = lines.filter((l) => /^[-*•] /.test(l)).length;
  const words = md.split(/\s+/).filter(Boolean).length;
  return { name, roles, degrees, bullets, words };
}

function renderBase(b) {
  state.base = b.markdown;
  const a = analyseBase(b.markdown);
  if (a.name && a.name.length < 40) setName(a.name.toUpperCase());
  $('#base-when').textContent = b.updatedAt ? `Updated ${ago(b.updatedAt)}` : 'Not set';
  $('#base-stats').textContent = b.markdown.trim()
    ? `${a.roles.length} roles · ${a.degrees.length} degrees · ${a.bullets} bullets`
    : 'empty';
  $('#base-sub').textContent = b.markdown.trim()
    ? `${a.words.toLocaleString()} words of raw material. Claude picks from this every time — keep everything in it.`
    : 'Add your master CV in Markdown: every role, project, award and skill — relevant or not.';
  $('#base-toc').innerHTML = [
    ...a.roles.map((r) => `<li>${esc(r)}</li>`),
    ...a.degrees.map((d) => `<li class="deg">${esc(d)}</li>`),
  ].join('');
  $('#base-undo').hidden = !b.versionsKept;
  if (!b.markdown.trim()) openBaseEditor();
}

function openBaseEditor() {
  $('#base-editor').hidden = false;
  $('#base-text').value = state.base;
  $('#base-text').focus();
}

async function saveBase(markdown, msg = 'Baseline saved.') {
  try {
    renderBase(await api('/api/base', { method: 'PUT', body: { markdown } }));
    $('#base-editor').hidden = true;
    toast(msg);
    loadStatus();
  } catch (e) {
    toast(e.message, true);
  }
}

$('#base-edit').onclick = () => ($('#base-editor').hidden ? openBaseEditor() : ($('#base-editor').hidden = true));
$('#base-cancel').onclick = () => ($('#base-editor').hidden = true);
$('#base-save').onclick = () => saveBase($('#base-text').value);
$('#base-file').onchange = async (e) => {
  const f = e.target.files[0];
  if (f) saveBase(await f.text());
  e.target.value = '';
};

/* ── add to the record: Claude digests a note into the baseline ── */

const NOTE_EXAMPLES = [
  'Built a Claude Code prototype of a reconciliation dashboard for a client team in Oct 2026…',
  'Passed CFA Level 1 in August 2026',
  'Add SQL (Intermediate) to my technical skills',
  'Spoke on a university FinTech society panel about AI in banking, March 2025…',
  'In my internship I also covered the consumer sector for 12 weeks…',
];
(async function notePlaceholder() {
  const el = $('#note');
  for (let i = 0; ; i++) {
    const ex = `e.g. ${NOTE_EXAMPLES[i % NOTE_EXAMPLES.length]}`;
    for (let k = 1; k <= ex.length; k++) {
      if (document.activeElement !== el && !el.value) el.placeholder = ex.slice(0, k);
      await sleep(38);
    }
    await sleep(2600);
  }
})();

/** Line diff (LCS) → [{t:'='|'+'|'-', s}] */
function diffLines(a, b) {
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) (out.push({ t: '=', s: a[i] }), i++, j++);
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: '-', s: a[i++] });
    else out.push({ t: '+', s: b[j++] });
  }
  while (i < n) out.push({ t: '-', s: a[i++] });
  while (j < m) out.push({ t: '+', s: b[j++] });
  return out;
}

/** Renders the diff as a redline with a line of context around each change. */
function redline(before, after) {
  const ops = diffLines(before.split('\n'), after.split('\n'));
  // Track bold blocks (the baseline's date/organisation blocks span lines) for nicer display.
  let bold = false;
  const fmt = (line) => {
    const starts = bold;
    const toggles = (line.match(/\*\*/g) || []).length;
    if (toggles % 2) bold = !bold;
    let h = esc(line.replace(/\*\*/g, ''))
      .replace(/^- /, '• ')
      .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$)/g, '$1<i>$2</i>');
    return { h: h || '&nbsp;', b: starts || toggles > 0 };
  };
  const show = ops.map((o, k) => o.t !== '=' || ops[k - 1]?.t !== '=' && ops[k - 1] || ops[k + 1]?.t !== '=' && ops[k + 1]);
  let html = '';
  let skipped = 0;
  ops.forEach((o, k) => {
    const f = fmt(o.s);
    if (!show[k]) return skipped++;
    if (skipped) ((html += `<div class="ln skip">⋯ ${skipped} unchanged line${skipped > 1 ? 's' : ''}</div>`), (skipped = 0));
    const cls = o.t === '+' ? 'add' : o.t === '-' ? 'del' : '';
    html += `<div class="ln ${cls}${f.b ? ' b' : ''}${o.s.trim() ? '' : ' blank'}">${f.h}</div>`;
  });
  if (skipped) html += `<div class="ln skip">⋯ ${skipped} unchanged line${skipped > 1 ? 's' : ''}</div>`;
  const changed = ops.filter((o) => o.t !== '=').length;
  return { html, changed };
}

const digest = { proposal: null, saved: '', busy: false, t0: 0, timer: 0 };

async function fileNote() {
  const note = $('#note').value.trim();
  if (digest.busy) return;
  if (note.length < 3) return toast('Write something to add first.', true), $('#note').focus();
  digest.busy = true;
  $('#note-go').disabled = true;
  $('#digest-status').hidden = false;
  $('#digest-label').textContent = digest.proposal ? 'Claude is updating the draft…' : 'Claude is filing it…';
  digest.t0 = performance.now();
  clearInterval(digest.timer);
  digest.timer = setInterval(() => ($('#digest-t').textContent = fmtT(performance.now() - digest.t0)), 100);
  state.busy = true; // the desk gets busy too
  try {
    const res = await fetch('/api/base/digest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note, draft: digest.proposal?.markdown }),
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let got = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.type === 'progress') $('#digest-label').textContent = `${ev.label}…`;
        if (ev.type === 'stage' && ev.state === 'active' && ev.engine) $('#digest-label').textContent = `Claude is reading your record · ${ev.engine.model} · effort ${ev.engine.effort}`;
        if (ev.type === 'error') throw new Error(ev.message);
        if (ev.type === 'proposal') got = ev;
      }
    }
    if (!got) throw new Error('The connection closed before Claude finished.');
    digest.proposal = got.proposal;
    digest.saved = got.base;
    $('#note').value = '';
    renderProposal();
  } catch (e) {
    toast(e.message, true);
  } finally {
    digest.busy = false;
    state.busy = false;
    clearInterval(digest.timer);
    $('#note-go').disabled = false;
    $('#digest-status').hidden = true;
  }
}

function renderProposal() {
  const p = digest.proposal;
  const box = $('#proposal');
  if (!p) return (box.hidden = true);
  const { html, changed } = redline(digest.saved, p.markdown);
  const mark = { added: '+', edited: '~', removed: '−' };
  box.hidden = false;
  box.style.animation = 'none';
  void box.offsetWidth;
  box.style.animation = '';
  box.innerHTML = `
    <span class="tab">Proposed amendment</span>
    <p class="summary">${esc(p.summary)}</p>
    <ul class="chg">${p.changes
      .map((c, i) => `<li class="${esc(c.kind)}" style="--i:${i}"><span class="mk">${mark[c.kind] || '·'}</span><div><span class="where">${esc(c.where)}</span><span class="txt">${esc(c.text)}</span></div></li>`)
      .join('')}</ul>
    ${p.questions.length ? `<div class="asks"><b>Claude asks</b><ul>${p.questions.map((q) => `<li data-q="${esc(q)}">${esc(q)}</li>`).join('')}</ul></div>` : ''}
    <details class="redline-wrap"${p.changes.length > 3 ? '' : ' open'}><summary>The redline · ${changed} line${changed === 1 ? '' : 's'} changed</summary><div class="redline">${html}</div></details>
    <div class="actions">
      <button class="btn small" id="prop-accept">Accept &amp; save</button>
      <button class="link" id="prop-edit">tweak it by hand first</button>
      <button class="link danger" id="prop-discard">discard</button>
    </div>
    ${p.questions.length ? '<p class="note-hint" style="margin:10px 0 0">Answer in the box above and file again — Claude will update this draft.</p>' : ''}`;
}

$('#proposal').addEventListener('click', async (e) => {
  const q = e.target.closest('[data-q]');
  if (q) {
    const ta = $('#note');
    ta.value = `${ta.value ? `${ta.value}\n` : ''}${q.dataset.q} → `;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    return;
  }
  if (e.target.id === 'prop-discard') {
    digest.proposal = null;
    renderProposal();
    return;
  }
  if (e.target.id === 'prop-edit') {
    openBaseEditor();
    $('#base-text').value = digest.proposal.markdown;
    toast('Loaded Claude’s draft into the editor. Save when you’re happy.');
    digest.proposal = null;
    renderProposal();
    return;
  }
  if (e.target.id === 'prop-accept') {
    const md = digest.proposal.markdown;
    digest.proposal = null;
    renderProposal();
    await saveBase(md, 'Filed. Your baseline is updated.');
  }
});
$('#note-go').onclick = fileNote;
$('#note').addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    fileNote();
  }
});
$('#base-undo').onclick = async () => {
  if (!confirm('Go back to the previous version of your baseline? The current version will be replaced.')) return;
  try {
    renderBase(await api('/api/base/undo', { method: 'POST' }));
    toast('Restored the previous version.');
  } catch (e) {
    toast(e.message, true);
  }
};

// Drop a .md anywhere.
let dragDepth = 0;
addEventListener('dragenter', (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  dragDepth++;
  $('#dropzone').hidden = false;
});
addEventListener('dragleave', () => {
  if (--dragDepth <= 0) ((dragDepth = 0), ($('#dropzone').hidden = true));
});
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('#dropzone').hidden = true;
  const f = e.dataTransfer?.files?.[0];
  if (!f) return;
  if (!/\.(md|markdown|txt)$/i.test(f.name)) return toast('Drop a Markdown (.md) file.', true);
  saveBase(await f.text());
});

/* ─────────────────────────── II. the role ─────────────────────────── */

const looksLikeUrl = (s) => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+\S*$/i.test(s.trim());

function renderJob(job, analysis) {
  if (!job) return ($('#job').innerHTML = '');
  const company = analysis?.company || job.company;
  const role = analysis?.role || job.title;
  const loc = analysis?.location || job.location;
  $('#role-when').textContent = job.posted || job.source || 'Posting';
  $('#role-small').textContent = job.applicants || (job.source === 'Pasted' ? 'pasted text' : job.source);
  const crit = (job.criteria || []).map((c) => `<span><b>${esc(c.label)}</b> ${esc(c.value)}</span>`).join('');
  const kws = (analysis?.keywords || []).map((k, i) => `<span class="kw" style="--i:${i}">${esc(k)}</span>`).join('');
  $('#job').innerHTML = `
    <div class="job-card">
      <div class="row company"><b>${esc(company || (job.source === 'Pasted' ? 'Pasted posting' : job.source || 'Posting'))}</b><span class="loc">${esc(loc || '')}</span></div>
      <div class="role">${esc(role || 'Role from pasted description')}</div>
      ${crit ? `<div class="criteria">${crit}</div>` : ''}
      ${analysis?.summary ? `<p class="read">${esc(analysis.summary)}</p>` : ''}
      ${kws ? `<div class="keywords">${kws}</div>` : ''}
      <details class="jd"><summary>The posting, as Claude reads it${job.url ? ` · <a href="${esc(job.url)}" target="_blank" rel="noopener">source ↗</a>` : ''}</summary><pre>${esc(job.description)}</pre></details>
    </div>`;
  if (company) state.lockTarget = company;
}

let fetchTimer;
async function previewJob() {
  const url = $('#url').value.trim();
  if (!looksLikeUrl(url) || url === state.jobUrl) return;
  state.jobUrl = url;
  state.job = null;
  $('#url-hint').textContent = 'reading…';
  try {
    const job = await api('/api/job', { method: 'POST', body: { url } });
    if ($('#url').value.trim() !== url) return;
    state.job = job;
    renderJob(job);
    $('#url-hint').textContent = '✓';
  } catch (e) {
    $('#url-hint').textContent = '';
    state.jobUrl = '';
    $('#job').innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}
$('#url').addEventListener('input', () => {
  clearTimeout(fetchTimer);
  fetchTimer = setTimeout(previewJob, 450);
});
$('#url').addEventListener('keydown', (e) => e.key === 'Enter' && go());
$('#notes').addEventListener('keydown', (e) => e.key === 'Enter' && go());
$('#to-text').onclick = () => (($('#mode-link').hidden = true), ($('#mode-text').hidden = false), $('#jd').focus());
$('#to-link').onclick = () => (($('#mode-text').hidden = true), ($('#mode-link').hidden = false), $('#url').focus());
$('#go').onclick = () => go();
addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') go();
});

/* ─────────────────────────── III. the edit (streaming) ─────────────────────────── */

const STAGE_TEXT = {
  read: ['Reading the posting', 'Fetching and cleaning the job description'],
  think: ['Claude is tailoring', 'Reading your baseline against the role'],
  trim: ['Tightening to one page', 'Too long — trimming the lowest-value lines'],
  set: ['Typesetting', 'Times New Roman · A4 · fitting to one page'],
  print: ['Printing the PDF', 'Headless Chrome · one page'],
};

const work = {
  order: [],
  t0: 0,
  started: {},
  ended: {},
  raf: 0,
  notesQ: '',
  sawThinking: false,
  sawDraft: false,
  lastOrg: '',
  finished: false,
};

function startWork(order) {
  Object.assign(work, { order, t0: performance.now(), started: {}, ended: {}, notesQ: '', sawThinking: false, sawDraft: false, lastOrg: '', finished: false });
  $('#sec-work').hidden = false;
  $('#sec-work').classList.add('reveal');
  $('#error').hidden = true;
  $('#work-aside').textContent = 'in progress';
  $('#marginalia').classList.remove('idle');
  $('#marginalia').innerHTML = '<div class="head">Claude’s margin notes</div><p></p>';
  $('#stages').innerHTML = order
    .map(
      (id) => `<div class="stage" id="st-${id}" ${id === 'trim' ? 'hidden' : ''}>
        <span class="t" id="tt-${id}">—</span>
        <span class="what"><b>${STAGE_TEXT[id][0]}</b><span class="detail" id="sd-${id}">${STAGE_TEXT[id][1]}</span></span>
      </div>`,
    )
    .join('');
  $('#progress').classList.add('running');
  state.busy = true;
  cancelAnimationFrame(work.raf);
  work.raf = requestAnimationFrame(workFrame);
  $('#sec-work').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
}

const fmtT = (ms) => {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

function workFrame() {
  const now = performance.now();
  // Timers in the date column.
  for (const id of work.order) {
    if (work.started[id] && !work.ended[id]) $(`#tt-${id}`).textContent = fmtT(now - work.started[id]);
  }
  // Progress rule: done stages + an easing creep inside the active one.
  const vis = work.order.filter((id) => id !== 'trim' || work.started.trim);
  const weights = { read: 1, think: 7, trim: 3, set: 1, print: 0.6 };
  const total = vis.reduce((a, id) => a + weights[id], 0);
  let done = 0;
  for (const id of vis) {
    if (work.ended[id]) done += weights[id];
    else if (work.started[id]) done += weights[id] * (1 - Math.exp(-(now - work.started[id]) / (id === 'think' ? 45000 : 4000))) * 0.92;
  }
  $('#progress i').style.width = work.finished ? '100%' : `${Math.min(100, (done / total) * 100)}%`;
  // Type out margin notes.
  if (work.notesQ) {
    let n = Math.max(1, Math.ceil(work.notesQ.length / 40));
    // Never split a run of newlines across frames, or paragraph breaks get lost.
    while (n < work.notesQ.length && (work.notesQ[n] === '\n' || work.notesQ[n - 1] === '\n')) n++;
    const chunk = work.notesQ.slice(0, n);
    work.notesQ = work.notesQ.slice(n);
    writeNote(chunk);
  }
  if (state.busy || work.notesQ) work.raf = requestAnimationFrame(workFrame);
}

function writeNote(chunk) {
  const box = $('#marginalia');
  let p = box.lastElementChild;
  const parts = chunk.split(/\n\s*\n/);
  parts.forEach((part, i) => {
    if (i > 0 || p.tagName !== 'P') {
      if (p.textContent.trim() || p.tagName !== 'P') {
        p = document.createElement('p');
        box.append(p);
      }
    }
    p.textContent += part.replace(/\n/g, ' ');
  });
  while (box.querySelectorAll('p').length > 14) box.querySelector('p').remove();
}

function note(text) {
  work.notesQ += text;
}

function onStage(ev) {
  const el = $(`#st-${ev.id}`);
  if (!el) return;
  el.hidden = false;
  if (ev.state === 'active') {
    work.started[ev.id] = performance.now();
    el.classList.add('active');
  } else {
    work.ended[ev.id] = performance.now();
    el.classList.remove('active');
    el.classList.add('done');
    if (work.started[ev.id]) $(`#tt-${ev.id}`).textContent = fmtT(work.ended[ev.id] - work.started[ev.id]);
    else $(`#tt-${ev.id}`).textContent = '✓';
  }
  if (ev.detail) $(`#sd-${ev.id}`).textContent = ev.detail;
  if (ev.id === 'think' && ev.state === 'active' && ev.engine) {
    $(`#sd-think`).textContent = `${ev.engine.model} · effort ${ev.engine.effort} · via ${ev.engine.label}`;
  }
}

function finishWork(ok, msg) {
  state.busy = false;
  $('#progress').classList.remove('running');
  $('#marginalia').classList.add('idle');
  const total = fmtT(performance.now() - work.t0);
  $('#work-aside').textContent = ok ? `done in ${total}` : 'stopped';
  work.finished = ok;
  if (ok) $('#progress i').style.width = '100%';
  if (!ok) {
    $('#error').hidden = false;
    $('#error').textContent = msg;
    for (const id of work.order) $(`#st-${id}`)?.classList.remove('active');
  }
}

async function stream(path, body, order) {
  if (state.busy) return;
  startWork(order);
  $('#go').disabled = true;
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok || !res.body) throw new Error(`Server error ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let finished = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        switch (ev.type) {
          case 'stage':
            onStage(ev);
            break;
          case 'job':
            state.job = ev.job;
            renderJob(ev.job);
            break;
          case 'thinking':
            if (ev.text.trim()) work.sawThinking = true;
            note(ev.text);
            break;
          case 'draft':
            work.sawDraft = true;
            if (ev.org !== work.lastOrg) {
              work.lastOrg = ev.org;
              note(`\n\n§ ${ev.org}\n\n`);
            }
            note(`• ${ev.text}\n\n`);
            break;
          case 'progress':
            $('#sd-think').textContent = ev.label;
            if (!work.sawThinking && !work.sawDraft && ev.label.startsWith('Reading')) note(`${ev.label}…\n\n`);
            break;
          case 'analysis':
            renderJob(state.job || state.run?.job, ev.analysis);
            note(`\n\nFirst read: ${ev.analysis.summary} Fit looks like ${ev.analysis.fit_score}/100.\n\n`);
            break;
          case 'done':
            finished = true;
            finishWork(true);
            state.run = ev.run;
            renderJob(ev.run.job, ev.run.result.analysis);
            renderResult(ev.run, { fresh: true });
            loadRuns();
            break;
          case 'error':
            finished = true;
            finishWork(false, ev.message);
            break;
        }
      }
    }
    if (!finished) finishWork(false, 'The connection closed before the CV was finished.');
  } catch (e) {
    finishWork(false, e.message);
  } finally {
    $('#go').disabled = false;
  }
}

function go() {
  if (state.busy) return;
  const textMode = !$('#mode-text').hidden;
  const url = $('#url').value.trim();
  const text = $('#jd').value.trim();
  if (textMode ? text.length < 80 : !looksLikeUrl(url)) {
    toast(textMode ? 'Paste the full job description first.' : 'Paste a job link first.', true);
    (textMode ? $('#jd') : $('#url')).focus();
    return;
  }
  if (!state.base.trim()) return toast('Add your baseline CV first (section I).', true);
  const body = { notes: $('#notes').value.trim() };
  if (textMode) body.text = text;
  else {
    body.url = url;
    if (state.job && state.jobUrl === url) body.job = state.job;
  }
  stream('/api/tailor', body, ['read', 'think', 'trim', 'set', 'print']);
}

/* ─────────────────────────── IV. the result ─────────────────────────── */

const VERDICTS = [
  [85, 'Shortlist material'],
  [70, 'A strong case'],
  [55, 'Plausible, with a story'],
  [40, 'A stretch'],
  [0, 'Long shot'],
];

function fitFrame() {
  const paper = $('#paper');
  const f = $('#frame');
  f.style.transform = `scale(${paper.clientWidth / 793.71})`;
}
new ResizeObserver(fitFrame).observe($('#paper'));

function countUp(el, to, ms = 1400) {
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderResult(run, { fresh = false } = {}) {
  state.run = run;
  stopEditing(false);
  const a = run.result.analysis || {};
  const sec = $('#sec-result');
  sec.hidden = false;
  sec.classList.remove('reveal');
  void sec.offsetWidth;
  sec.classList.add('reveal');

  const v = `?v=${encodeURIComponent(run.updatedAt)}`;
  $('#frame').src = `${run.previewUrl}${v}`;
  fitFrame();
  const paper = $('#paper');
  paper.style.animation = 'none';
  void paper.offsetWidth;
  paper.style.animation = '';

  $('#dl').href = `${run.pdfUrl}${v}&download=1`;
  $('#open-pdf').href = `${run.pdfUrl}${v}`;
  const label = run.result.file_label || a.company || '';
  $('#paper-meta-l').textContent = `${label}${a.role ? ` · ${a.role}` : ''}`;
  const pt = (9.12 * (run.render?.scale || 1)).toFixed(2);
  $('#paper-meta-r').textContent = `A4 · 1 page · ${pt}pt · ${Math.round((run.render?.fill || 0) * 100)}% full`;
  $('#result-aside').textContent = `filed ${ago(run.updatedAt)}`;

  const fit = Math.max(0, Math.min(100, a.fit_score ?? 0));
  if (fresh) countUp($('#fit'), fit);
  else $('#fit').textContent = fit;
  $('#needle').style.left = '0%';
  requestAnimationFrame(() => requestAnimationFrame(() => ($('#needle').style.left = `calc(${fit}% - 1.5px)`)));
  $('#verdict').textContent = VERDICTS.find(([min]) => fit >= min)[1];
  $('#strategy').textContent = a.strategy || '';

  const mark = { strong: '✓', partial: '~', gap: '✗' };
  $('#reqs').innerHTML = (a.requirements || [])
    .map((r, i) => `<li class="${esc(r.strength)}" style="--i:${i}"><span class="mk">${mark[r.strength] || '·'}</span><div><b>${esc(r.requirement)}</b><span>${esc(r.evidence)}</span></div></li>`)
    .join('');
  $('#changes').innerHTML = (run.result.changes || []).map((c, i) => `<li style="--i:${i}">${esc(c)}</li>`).join('');

  const stamp = $('#stamp');
  $('#stamp-date').textContent = fmtDate(run.updatedAt, { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  stamp.classList.remove('thump');
  stamp.style.opacity = fresh ? '' : '0.92';
  if (fresh) {
    void stamp.offsetWidth;
    stamp.classList.add('thump');
    setTimeout(() => {
      sec.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      setTimeout(() => {
        const r = stamp.getBoundingClientRect();
        burst(r.left + r.width / 2, r.top + r.height / 2);
      }, 700);
    }, 250);
    state.lockTarget = null;
  }
  document.querySelectorAll('.archive .entry').forEach((e) => e.classList.toggle('current', e.dataset.id === run.id));
}

// Refine with Claude.
$('#refine').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !state.run) return;
  const instruction = e.target.value.trim();
  if (!instruction) return;
  e.target.value = '';
  stream(`/api/runs/${state.run.id}/refine`, { instruction }, ['think', 'trim', 'set', 'print']);
});

// Direct edits on the page preview.
function startEditing() {
  if (!state.run) return;
  state.editing = true;
  state.edits.clear();
  $('#frame').src = `${state.run.previewUrl}?edit=1&v=${Date.now()}`;
  $('#paper').classList.add('editing');
  $('#edit-bar').hidden = false;
  $('#edit-toggle').textContent = 'stop editing';
  updateEditBar();
}
function stopEditing(reload = true) {
  if (!state.editing) return;
  state.editing = false;
  $('#paper').classList.remove('editing');
  $('#edit-bar').hidden = true;
  $('#edit-toggle').textContent = 'edit text';
  if (reload && state.run) $('#frame').src = `${state.run.previewUrl}?v=${encodeURIComponent(state.run.updatedAt)}`;
}
function updateEditBar() {
  const n = state.edits.size;
  $('#edit-count').textContent = n ? `${n} change${n > 1 ? 's' : ''} pending — the page refits on save.` : 'Click any line on the page to edit it. Empty a bullet to delete it.';
  $('#edit-save').disabled = !n;
}
$('#edit-toggle').onclick = () => (state.editing ? stopEditing() : startEditing());
$('#edit-cancel').onclick = () => stopEditing();
addEventListener('message', (e) => {
  if (e.data?.kind !== 'cv-edit' || !state.editing) return;
  state.edits.set(e.data.path, e.data.text);
  updateEditBar();
});
$('#edit-save').onclick = async () => {
  const edits = [...state.edits].map(([path, text]) => ({ path, text }));
  $('#edit-save').disabled = true;
  $('#edit-count').textContent = 'Re-typesetting…';
  try {
    const run = await api(`/api/runs/${state.run.id}/cv`, { method: 'PUT', body: { edits } });
    renderResult(run); // also leaves edit mode
    toast('Saved. The PDF is updated.');
  } catch (e) {
    toast(e.message, true);
    updateEditBar();
  }
};

/* ─────────────────────────── V. archive ─────────────────────────── */

async function loadRuns() {
  try {
    state.runs = await api('/api/runs');
  } catch {
    state.runs = [];
  }
  renderTicker();
  $('#archive-aside').textContent = state.runs.length ? `${state.runs.length} on file` : '';
  if (!state.runs.length) {
    $('#archive').innerHTML = '<p class="empty">Nothing filed yet. Your first tailored CV will be filed here.</p>';
    return;
  }
  $('#archive').innerHTML = state.runs
    .map(
      (r) => `<div class="entry${state.run?.id === r.id ? ' current' : ''}" data-id="${esc(r.id)}" tabindex="0" role="button" aria-label="Open CV for ${esc(r.company)}">
        <div class="date">${fmtDate(r.createdAt, { day: 'numeric', month: 'short' })}<small>${fmtDate(r.createdAt, { year: 'numeric' })} · ${new Date(r.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</small></div>
        <div>
          <div class="row"><b>${esc(r.company || 'Untitled')}</b><span class="fitchip">${r.fit ?? '–'}<small>/100</small></span></div>
          <div class="sub">${esc(r.role)}${r.location ? ` · ${esc(r.location)}` : ''}</div>
          <div class="kwline">${r.keywords.map(esc).join(' · ')}</div>
          <div class="acts">
            <a class="link" href="/runs/${esc(r.id)}/cv.pdf?download=1" data-stop>download</a>
            ${r.url ? `<a class="link" href="${esc(r.url)}" target="_blank" rel="noopener" data-stop>posting ↗</a>` : ''}
            <button class="link danger" data-del="${esc(r.id)}" data-stop>remove</button>
          </div>
        </div>
      </div>`,
    )
    .join('');
}

$('#archive').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    e.preventDefault();
    if (!confirm('Remove this tailored CV from the archive? This deletes its PDF.')) return;
    await api(`/api/runs/${del.dataset.del}`, { method: 'DELETE' });
    if (state.run?.id === del.dataset.del) {
      state.run = null;
      $('#sec-result').hidden = true;
    }
    return loadRuns();
  }
  if (e.target.closest('[data-stop]')) return;
  const entry = e.target.closest('.entry');
  if (entry) openRun(entry.dataset.id);
});
$('#archive').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.entry')) openRun(e.target.dataset.id);
});

async function openRun(id) {
  try {
    const run = await api(`/api/runs/${id}`);
    state.job = run.job;
    state.jobUrl = run.job.url || '';
    if (run.job.url) $('#url').value = run.job.url;
    $('#notes').value = run.notes || '';
    renderJob(run.job, run.result.analysis);
    state.lockTarget = null;
    renderResult(run);
    $('#sec-result').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  } catch (e) {
    toast(e.message, true);
  }
}

/* ─────────────────────────── boot ─────────────────────────── */

(async function boot() {
  glyphField();
  renderTicker();
  await Promise.all([
    loadStatus(),
    api('/api/base').then(renderBase).catch((e) => toast(e.message, true)),
    loadRuns(),
  ]);
  typewriter();
  const deep = new URLSearchParams(location.search).get('run');
  if (deep) openRun(deep);
})();

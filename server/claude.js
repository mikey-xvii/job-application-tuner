// The thinking part: asks Claude to tailor the baseline CV to a job posting.
//
// Two interchangeable engines:
//   • "api" — Anthropic API via the official SDK (needs ANTHROPIC_API_KEY in .env)
//   • "cli" — your logged-in Claude Code CLI (`claude -p`), no API key needed
// Both return the same JSON (validated by the same schema) and stream progress.
import Anthropic from '@anthropic-ai/sdk';
import { spawn, execFileSync } from 'node:child_process';

export const MODEL = process.env.CV_MODEL || 'claude-opus-5-5';
export const EFFORT = process.env.CV_EFFORT || 'high';

/* ───────────────────────────── schema ───────────────────────────── */

const str = { type: 'string' };
const obj = (properties) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const arr = (items) => ({ type: 'array', items });

export const RESULT_SCHEMA = obj({
  analysis: obj({
    company: str,
    role: str,
    location: str,
    summary: str,
    keywords: arr(str),
    requirements: arr(
      obj({ requirement: str, evidence: str, strength: { type: 'string', enum: ['strong', 'partial', 'gap'] } }),
    ),
    fit_score: { type: 'integer' },
    strategy: str,
  }),
  cv: obj({
    name: str,
    contact: arr(str),
    sections: arr(
      obj({
        title: str,
        kind: { type: 'string', enum: ['entries', 'skills'] },
        entries: arr(
          obj({
            date: str,
            organisation: str,
            location: str,
            subtitle: str,
            subtitle_style: { type: 'string', enum: ['bold', 'italic'] },
            details: arr(str),
            bullets: arr(str),
          }),
        ),
        skills: arr(obj({ label: str, text: str })),
      }),
    ),
  }),
  changes: arr(str),
  file_label: str,
});

/* ───────────────────────────── prompt ───────────────────────────── */

export const SYSTEM_PROMPT = `You are the engine inside a personal CV-tailoring tool. Each request gives you the candidate's BASELINE (a master document of everything they have done, relevant or not) and a JOB POSTING. You return one tailored, one-page CV as JSON; a typesetter renders it into the candidate's fixed template (A4, Times New Roman 9pt, date column on the left).

How to approach it
- Read the posting the way the hiring manager would. Identify the handful of things that will actually decide the shortlist, the seniority, and the vocabulary the team uses. Ignore boilerplate.
- Then choose, order and rewrite the candidate's material to make the strongest truthful case for this specific role. Relevance decides what stays: drop experiences, bullets, modules and skills that don't help this application.

Truthfulness (non-negotiable)
- Every claim must be traceable to the baseline. Never invent employers, titles, dates, degrees, grades, clients, numbers, tools, certifications or languages, and never make a claim more specific than the baseline supports.
- You may re-word, re-order, merge or split bullets, drop bullets or whole entries, foreground the part of an experience that matters for this job, and use the posting's terminology where it honestly describes what the candidate did.
- Keep metrics exactly as written in the baseline.
- Real gaps belong in analysis.requirements with strength "gap", not hidden in the CV.

Template conventions (follow exactly)
- cv.name: as in the baseline, in capitals. cv.contact: exactly the contact items in the baseline, in order.
- Sections, in this order: WORK EXPERIENCE, EDUCATION, ADDITIONAL SKILLS (uppercase titles). Only add another section (e.g. PROJECTS, LEADERSHIP & ACTIVITIES) when the baseline holds material for it that genuinely strengthens this application.
- "entries" sections: reverse-chronological. date is years only: work roles "2024 - Present" for a current role, a single year ("2023") when it started and ended in the same year, otherwise "2021 - 2023"; education "2023 – 2024" (en dash). organisation and location as in the baseline ("Hong Kong SAR", "London, UK"). subtitle = job title with subtitle_style "bold" for work; degree with subtitle_style "italic" for education. details = plain lines under the subtitle such as "Graduated with Merit" (usually empty for work). skills = [] for entries sections.
- Bullets: no trailing full stop; open with a strong past-tense verb (also for the current role, matching the baseline); British spelling as in the baseline; no first person; no markdown or bold. Each bullet runs 1–3 printed lines; a printed line holds about 100 characters. Don't leave a last line of only one or two words — tighten the wording instead. One achievement per bullet: never split one piece of work into several bullets or restate the same work twice to fill space.
- "skills" section (ADDITIONAL SKILLS): entries = []; skills = groups with the baseline's labels (Technical, Languages, Certifications, Hobbies/Interests). Lead each group with what matters for this job. You may drop irrelevant tools from Technical; keep Languages and Certifications complete.

Page budget
- The page holds about 76 printed lines; name, contact and section headings with their spacing cost about 12. Aim for 72–76 lines by your own count — drafts consistently come out shorter than estimated, and if you overshoot slightly the typesetter shrinks the type a touch to fit. Typically 4–5 bullets for the most relevant role, 2–3 for the others, at most 2 bullets per degree.
- Spend spare room on the most relevant work (fuller detail, an extra relevant bullet from the baseline). Never add content that doesn't help this application just to fill space; a little white space at the bottom is better than filler.
- If the request contains <overflow>, the previous version did not fit at the smallest permitted font size: return the complete CV again, cut by at least the number of lines stated, removing the lowest-value content first.

Analysis fields
- company, role, location: from the posting.
- summary: one plain sentence on what this team really wants.
- keywords: 8–14 short terms (1–3 words each) the posting cares about, most important first.
- requirements: the 5–8 decisive requirements; evidence says where the CV shows it (max 18 words, or what is missing); strength is strong, partial or gap.
- fit_score: an honest 0–100. 85+ means shortlisted at a glance; 60–75 plausible with a good story; under 50 a stretch.
- strategy: two sentences on the angle you took, addressed to the candidate as "you" (they are the reader).
- changes: 3–6 concrete editor's margin notes on what you changed versus the baseline and why (max 20 words each), addressed to the candidate as "you" where needed.
- file_label: a short label for the file name, usually the company (e.g. "BlackRock").`;

function jobBlock(job) {
  const lines = [
    job.title && `Title: ${job.title}`,
    job.company && `Company: ${job.company}`,
    job.location && `Location: ${job.location}`,
    ...(job.criteria || []).map((c) => `${c.label}: ${c.value}`),
    job.url && `URL: ${job.url}`,
    '',
    job.description,
  ].filter((l) => l !== undefined && l !== null && l !== false);
  return `<job_posting>\n${lines.join('\n')}\n</job_posting>`;
}

function buildUserContent({ base, job, notes, currentCv, instruction, overflowLines }) {
  const parts = [{ type: 'text', text: `<baseline_cv>\n${base}\n</baseline_cv>`, cache_control: { type: 'ephemeral' } }];
  let tail = jobBlock(job);
  if (notes?.trim()) tail += `\n\n<candidate_notes>\n${notes.trim()}\n</candidate_notes>`;
  if (currentCv) tail += `\n\n<current_cv>\n${JSON.stringify(currentCv)}\n</current_cv>`;
  if (instruction?.trim())
    tail += `\n\n<revision_request>\nRevise the current CV as follows, keeping everything else that works: ${instruction.trim()}\n</revision_request>`;
  if (overflowLines)
    tail += `\n\n<overflow>The current CV overflowed the page by about ${overflowLines} printed lines. Cut at least ${overflowLines + 2} lines.</overflow>`;
  tail += currentCv
    ? '\n\nReturn the full result JSON (analysis, cv, changes, file_label). In "changes", describe what changed in this revision.'
    : '\n\nTailor the CV for this posting and return the result JSON.';
  parts.push({ type: 'text', text: tail });
  return parts;
}

/* ───────────────────────── streaming helpers ───────────────────────── */

/** Watches the JSON as it streams so the UI can show what's being written. */
/** Pulls finished bullet strings out of the partial JSON (so the UI can show them as they're written). */
function completedBullets(buf) {
  const out = [];
  const re = /"bullets"\s*:\s*\[/g;
  let m;
  while ((m = re.exec(buf))) {
    const before = buf.slice(0, m.index);
    const org = [...before.matchAll(/"organisation"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].at(-1)?.[1] || '';
    let i = re.lastIndex;
    for (;;) {
      while (i < buf.length && /[\s,]/.test(buf[i])) i++;
      if (i >= buf.length || buf[i] !== '"') break;
      let j = i + 1;
      while (j < buf.length && buf[j] !== '"') j += buf[j] === '\\' ? 2 : 1;
      if (j >= buf.length) break; // string still streaming
      try {
        out.push({ org: JSON.parse(`"${org}"`), text: JSON.parse(buf.slice(i, j + 1)) });
      } catch {}
      i = j + 1;
    }
  }
  return out;
}

function makeProgressTracker(onEvent) {
  let buf = '';
  let analysisSent = false;
  let lastLabel = '';
  let drafted = 0;
  return (delta) => {
    buf += delta;
    if (delta.includes('"')) {
      const done = completedBullets(buf);
      for (; drafted < done.length; drafted++) onEvent({ type: 'draft', ...done[drafted] });
    }
    if (!analysisSent) {
      const m = buf.match(/,\s*"cv"\s*:/);
      if (m) {
        try {
          const partial = JSON.parse(buf.slice(0, m.index) + '}');
          if (partial.analysis) {
            analysisSent = true;
            onEvent({ type: 'analysis', analysis: partial.analysis });
          }
        } catch {}
      }
    }
    const orgs = [...buf.matchAll(/"(organisation|title)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)];
    const bullets = (buf.match(/"bullets"\s*:/g) || []).length;
    const last = orgs.at(-1);
    let label = '';
    if (!analysisSent) label = 'Reading between the lines of the posting';
    else if (last) label = last[1] === 'title' ? `Setting the ${titleCase(last[2])} section` : `Rewriting ${last[2]}`;
    else label = 'Drafting the page';
    if (/"changes"\s*:/.test(buf)) label = 'Writing editor’s notes';
    if (label !== lastLabel) {
      lastLabel = label;
      onEvent({ type: 'progress', label, bullets, chars: buf.length });
    }
  };
}
const titleCase = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

function parseResult(text) {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error('Claude returned something that was not valid JSON.');
  }
}

/* ─────────────────────────────── engines ─────────────────────────────── */
// Each engine runs one "spec": { system, schema, content: [text parts], effort, onText }.

let _client;
async function runApi(spec, onEvent) {
  _client ||= new Anthropic();
  const stream = _client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    // Opt into server-side fallback in case a safety classifier declines the request.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort: spec.effort, format: { type: 'json_schema', schema: spec.schema } },
    system: [{ type: 'text', text: spec.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: spec.content }],
  });
  for await (const ev of stream) {
    if (ev.type === 'content_block_delta') {
      if (ev.delta.type === 'thinking_delta') ev.delta.thinking && onEvent({ type: 'thinking', text: ev.delta.thinking });
      else if (ev.delta.type === 'text_delta') spec.onText?.(ev.delta.text);
    }
  }
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined this request.');
  if (msg.stop_reason === 'max_tokens') throw new Error('Claude ran out of room before finishing — try again.');
  const text = msg.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return { result: parseResult(text), usage: msg.usage, servedBy: msg.model };
}

function runCli(spec, onEvent) {
  return new Promise((resolve, reject) => {
    const userText = spec.content.map((p) => p.text).join('\n\n');
    const args = [
      '-p',
      '--model', MODEL,
      '--effort', spec.effort,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--json-schema', JSON.stringify(spec.schema),
      '--system-prompt', spec.system,
      '--tools', '',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--no-session-persistence',
    ];
    const child = spawn(process.env.CLAUDE_BIN || 'claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.env.TMPDIR || '/tmp',
    });
    let out = '';
    let err = '';
    let final = null;
    child.stdout.on('data', (d) => {
      out += d;
      let nl;
      while ((nl = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, nl).trim();
        out = out.slice(nl + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.type === 'stream_event' && msg.event?.type === 'content_block_delta') {
          const d = msg.event.delta;
          if (d.type === 'thinking_delta') d.thinking && onEvent({ type: 'thinking', text: d.thinking });
          else if (d.type === 'text_delta') spec.onText?.(d.text);
          else if (d.type === 'input_json_delta') spec.onText?.(d.partial_json);
        } else if (msg.type === 'result') {
          final = msg;
        }
      }
    });
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => reject(new Error(`Couldn't start the Claude CLI: ${e.message}`)));
    child.on('close', (code) => {
      if (!final) return reject(new Error(`Claude CLI exited (${code}). ${err.trim().slice(-400)}`));
      if (final.is_error) return reject(new Error(`Claude CLI: ${final.result || final.subtype}`));
      try {
        const result = final.structured_output ?? parseResult(final.result || '');
        resolve({ result, usage: final.usage, servedBy: MODEL });
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.end(userText);
  });
}

/** Dev engine: streams a canned result through the same events, to test the UI without spending tokens. */
async function runReplay(spec, onEvent) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const result = await spec.replay();
  for (const t of spec.replayThoughts || []) {
    for (const w of t.split(/(?<= )/)) {
      onEvent({ type: 'thinking', text: w });
      await wait(35);
    }
    onEvent({ type: 'thinking', text: '\n\n' });
    await wait(400);
  }
  const json = JSON.stringify(result);
  for (let i = 0; i < json.length; i += 40) {
    spec.onText?.(json.slice(i, i + 40));
    await wait(12);
  }
  return { result: structuredClone(result), usage: null, servedBy: 'replay' };
}

/* ────────────────────────────── public API ────────────────────────────── */

let _cliOk;
function cliAvailable() {
  if (_cliOk !== undefined) return _cliOk;
  try {
    execFileSync(process.env.CLAUDE_BIN || 'claude', ['--version'], { stdio: 'ignore', timeout: 8000 });
    _cliOk = true;
  } catch {
    _cliOk = false;
  }
  return _cliOk;
}

export function engineInfo() {
  const forced = process.env.CV_ENGINE;
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  let engine = null;
  if (forced === 'api' || forced === 'cli' || forced === 'replay') engine = forced;
  else if (hasKey) engine = 'api';
  else if (cliAvailable()) engine = 'cli';
  return {
    engine,
    model: MODEL,
    effort: EFFORT,
    label: { api: 'Anthropic API', cli: 'Claude Code', replay: 'replay (test mode)' }[engine] || 'not connected',
  };
}

async function run(spec, onEvent) {
  const { engine } = engineInfo();
  if (!engine)
    throw new Error('No Claude engine found. Add ANTHROPIC_API_KEY to .env, or install and log in to the Claude Code CLI.');
  const out = await { api: runApi, cli: runCli, replay: runReplay }[engine](spec, onEvent);
  return { ...out, engine };
}

/**
 * Tailor (or revise) the CV. onEvent receives {type:'thinking'|'progress'|'analysis'|'draft', ...}.
 * input: { base, job, notes?, currentCv?, instruction?, overflowLines? }
 */
export async function tailor(input, onEvent = () => {}) {
  const out = await run(
    {
      system: SYSTEM_PROMPT,
      schema: RESULT_SCHEMA,
      content: buildUserContent(input),
      effort: EFFORT,
      onText: makeProgressTracker(onEvent),
      replay: async () => {
        const fs = await import('node:fs');
        const file = process.env.CV_REPLAY_FILE || new URL('../test/sample-result.json', import.meta.url);
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      },
      replayThoughts: [
        'Reading the posting first. They want someone who maps processes into controls and exceptions, then prototypes fixes quickly.',
        'The strongest match in the baseline is the settlement-process mapping: it is exactly that kind of controls-and-exceptions work.',
      ],
    },
    onEvent,
  );
  validate(out.result);
  return out;
}

/* ───────────────────── digesting a note into the baseline ───────────────────── */

export const DIGEST_EFFORT = process.env.CV_DIGEST_EFFORT || 'medium';

export const DIGEST_SCHEMA = obj({
  markdown: str,
  summary: str,
  changes: arr(obj({ kind: { type: 'string', enum: ['added', 'edited', 'removed'] }, where: str, text: str })),
  questions: arr(str),
});

export const DIGEST_PROMPT = `You keep the candidate's master CV — the BASELINE — a Markdown record of everything they have done, relevant to any particular job or not. A separate step later tailors it to specific postings, so the baseline should be complete and well-kept rather than short.

The candidate gives you a NOTE in their own words: something new (a role, project, achievement, skill, award, course, language, interest), extra detail on something already there, or a correction. Fold it into the baseline.

Rules
- Return the complete baseline in "markdown" with the note integrated. Everything the note doesn't touch stays exactly as it was: same order, wording, spacing and markup.
- Match the baseline's existing conventions precisely: the bold date / organisation / location block, italic job titles, "- " bullets, section headings in bold capitals, British spelling, bullets opening with a past-tense verb and no trailing full stop, the "Label" + line format in ADDITIONAL SKILLS.
- Put it where it belongs: a bullet under the matching role or degree; a new entry in reverse-chronological position; an item appended to the right skills line (Technical, Languages, Certifications, Hobbies/Interests); or a new section (e.g. PROJECTS, LEADERSHIP & ACTIVITIES, AWARDS) only if nothing existing fits.
- Only facts from the note or the baseline. Polish the note into CV wording, but never add numbers, outcomes, tools, dates, employers or scope the note doesn't state. Keep every concrete detail the note gives.
- If the note overlaps an existing bullet, enrich that bullet instead of duplicating it. If the note asks for a change or removal, make exactly that change.
- If the format needs something the note doesn't give (e.g. dates or location for a new role), integrate what you can with a visible placeholder like [dates?] and ask for it in "questions".
- summary: one sentence, to the candidate ("you"), saying what you filed and where.
- changes: one item per change — kind (added / edited / removed), where (e.g. "Acme Bank · bullets", "Additional skills · Technical"), and the new text (or the removed text for removals).
- questions: zero to three short questions, only when an answer would genuinely improve the entry.`;

/** Fold a free-text note into the baseline markdown. Returns { proposal, engine }. */
export async function digestIntoBase({ base, note }, onEvent = () => {}) {
  const out = await run(
    {
      system: DIGEST_PROMPT,
      schema: DIGEST_SCHEMA,
      effort: DIGEST_EFFORT,
      content: [
        { type: 'text', text: `<baseline_cv>\n${base}\n</baseline_cv>`, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `<note>\n${note.trim()}\n</note>\n\nFold the note into the baseline and return the JSON.` },
      ],
      onText: (() => {
        let buf = '';
        let sent = false;
        return (d) => {
          buf += d;
          if (!sent && /"summary"\s*:/.test(buf)) ((sent = true), onEvent({ type: 'progress', label: 'Writing up what changed' }));
        };
      })(),
      replay: async () => ({
        markdown: `${base.trimEnd()}\n\n**PROJECTS**\n- ${note.trim().replace(/\.$/, '')}\n`,
        summary: 'You asked for this in replay mode, so it was filed as-is under a new PROJECTS section.',
        changes: [{ kind: 'added', where: 'Projects · bullets', text: note.trim() }],
        questions: ['Replay mode: no real Claude was used. When did this happen?'],
      }),
      replayThoughts: ['Looking for where this note belongs in the record.'],
    },
    onEvent,
  );
  const p = out.result;
  if (!p?.markdown?.trim()) throw new Error('Claude returned an empty baseline.');
  // Keep the file's own leading/trailing whitespace so the redline only shows real changes.
  p.markdown = base.match(/^\s*/)[0] + p.markdown.trim() + base.match(/\s*$/)[0];
  p.changes ||= [];
  p.questions ||= [];
  return { proposal: p, engine: out.engine };
}

function validate(r) {
  if (!r?.cv?.sections?.length) throw new Error('Claude returned a CV with no sections.');
  for (const s of r.cv.sections) {
    s.entries ||= [];
    s.skills ||= [];
    for (const e of s.entries) {
      e.details ||= [];
      e.bullets ||= [];
    }
  }
  r.changes ||= [];
  r.analysis ||= {};
  r.analysis.keywords ||= [];
  r.analysis.requirements ||= [];
}

# CV Tuner

Paste a job link → Claude rewrites your master CV for that role → you get a one-page PDF in your exact template.

## Run it

```bash
npm install
npm start            # → http://localhost:4321
```

**Claude connection** (one of):

- **Anthropic API** — copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`. Uses `claude-opus-5-5`, adaptive thinking, effort `high`, structured JSON output, and streams Claude's thinking summary into the page as margin notes.
- **Claude Code CLI** — no key needed: if `claude` is installed and logged in (`claude` → `/login`), the app shells out to `claude -p` with the same prompt and schema.

First run: add your master CV in section I (paste it, drop a `.md`, or start from `cp examples/base-cv.example.md data/base-cv.md`). It stays on your machine: your CV, its history and every generated PDF are git-ignored.

Google Chrome must be installed (it typesets and prints the PDF headlessly). Override with `CHROME_PATH` in `.env`.

## How it works

| Step | Where |
|---|---|
| Your master CV (everything, relevant or not) | `data/base-cv.md` (edit or drop a new `.md` in section I; see `examples/base-cv.example.md` for the format) |
| Fetch the posting (LinkedIn guest endpoint, JSON-LD, or page text; or paste the text) | `server/scrape.js` |
| Claude picks, reorders and rewrites — never invents — and returns JSON + a fit analysis | `server/claude.js` (prompt + schema) |
| HTML template measured off your original PDF (Times New Roman 9.12pt, 72pt date column, 396pt location tab, 0.72pt rules) | `server/template.js` |
| Fit to one A4 page: shrinks type down to ~8.2pt if needed; if it still overflows, asks Claude to cut, then drops lowest-priority bullets as a last resort | `template.js` (in-page fitter) + `server/index.js` |
| PDF + archive | `data/runs/<id>/` |

**Adding to your baseline:** type a note in your own words under *Add to the record* in section I ("passed CFA L1 in Aug 2026", "at my current firm I also built…"). Claude decides where it belongs, writes it in your format, and shows a tracked-changes proposal; nothing saves until you accept. It asks follow-up questions when details (dates, numbers) would help but never makes them up. Every save keeps the previous version in `data/base-history/`, and *undo last change* restores it. Direct editing still works as before.

After a run you can **edit text directly on the page preview** (it re-fits and re-prints), or **ask for a change** ("make the first role more about prototyping") and Claude revises it.

## Handy

- `npm run replay` — runs on :4322 with a fake engine that streams `test/sample-result.json`, for UI work without spending tokens.
- `node scripts/import-result.js <job.json> <result.json>` — file a result produced elsewhere into the archive.
- `.env` knobs: `CV_MODEL`, `CV_EFFORT` (`low`…`max`), `CV_DIGEST_EFFORT` (default `medium`), `CV_MIN_SCALE` (default `0.9`), `CV_ENGINE` (`api`/`cli`/`replay`), `PORT`.
- LinkedIn sometimes rate-limits (HTTP 429). The app makes one normal request and, if refused, asks you to paste the description instead.

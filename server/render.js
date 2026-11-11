// Prints the CV with your installed Chrome in headless mode (no extra downloads).
// The page fits itself to one A4 sheet (see FIT_SCRIPT in template.js); we run Chrome twice
// in parallel — once to read back the fit result, once to print the PDF.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cvHtml } from './template.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(ROOT, 'data', '.tmp');

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export function chromePath() {
  return CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

function runChrome(extraArgs, profile, { capture = false, timeoutMs = 45000 } = {}) {
  const bin = chromePath();
  if (!bin) throw new Error('No Chrome/Chromium found. Install Google Chrome or set CHROME_PATH in .env.');
  return new Promise((resolve, reject) => {
    const args = [
      '--headless',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      '--font-render-hinting=none',
      '--run-all-compositor-stages-before-draw',
      '--virtual-time-budget=3000',
      `--user-data-dir=${profile}`,
      ...extraArgs,
    ];
    const child = spawn(bin, args, { stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe'] });
    let out = '';
    let err = '';
    if (capture) child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Chrome took too long to typeset the page.'));
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) return reject(new Error(`Chrome exited with ${code}: ${err.trim().slice(-300)}`));
      resolve(out);
    });
  });
}

/**
 * Fit + print. Returns { pdf, scale, fill, overflowLines }.
 * overflowLines > 0 → doesn't fit even at the smallest scale (caller should ask Claude to trim).
 */
export async function typeset(cv, { title = 'CV', extraCss = '' } = {}) {
  fs.mkdirSync(TMP, { recursive: true });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const html = path.join(TMP, `${id}.html`);
  const pdfPath = path.join(TMP, `${id}.pdf`);
  const profA = fs.mkdtempSync(path.join(os.tmpdir(), 'cvt-a-'));
  const profB = fs.mkdtempSync(path.join(os.tmpdir(), 'cvt-b-'));
  fs.writeFileSync(html, cvHtml(cv, { title, extraCss }));
  const url = `file://${html}`;
  try {
    const [dom] = await Promise.all([
      runChrome(['--dump-dom', url], profA, { capture: true }),
      runChrome([`--print-to-pdf=${pdfPath}`, '--no-pdf-header-footer', '--print-to-pdf-no-header', url], profB),
    ]);
    const m = dom.match(/data-fit="([^"]+)"/);
    if (!m) throw new Error('Typesetting failed (no fit result from Chrome).');
    const fit = JSON.parse(m[1].replace(/&quot;/g, '"'));
    const pdf = fit.overflowLines > 0 ? null : fs.readFileSync(pdfPath);
    return { pdf, ...fit };
  } finally {
    for (const p of [html, pdfPath]) fs.rmSync(p, { force: true });
    for (const p of [profA, profB]) fs.rmSync(p, { recursive: true, force: true });
  }
}

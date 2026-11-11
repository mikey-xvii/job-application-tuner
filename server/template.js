// HTML typesetting of the CV, measured off the original Word-exported PDF:
//   A4 · Times New Roman · name 12pt bold · body 9.12pt / 10.3pt leading
//   text block x=49.7pt → 541pt · date column 72pt · location tab at 396pt
//   bullets: glyph at 72pt, text at 90pt, justified · rules 0.72pt
// One variable (--s) scales type + leading for one-page fitting; geometry stays fixed.

const esc = (s = '') =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export const CV_CSS = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
.page {
  width: 595.28pt; height: 841.89pt; position: relative; overflow: hidden; background: #fff;
  padding: 33.3pt 53.78pt 0 49.7pt;
}
.cv {
  --s: 1;
  font-family: "Times New Roman", Times, "Liberation Serif", serif;
  font-size: calc(9.12pt * var(--s)); line-height: calc(10.35pt * var(--s));
  color: #000; width: 491.8pt;
  -webkit-font-smoothing: antialiased; font-kerning: normal;
}
.cv b, .cv .b { font-weight: bold; }
.name { text-align: center; font-weight: bold; font-size: calc(12pt * var(--s)); line-height: calc(15.9pt * var(--s)); letter-spacing: .01em; }
.contact { display: flex; justify-content: space-between; padding: 0 64.5pt 0 63.9pt; margin-bottom: calc(0.9pt * var(--s)); }
.contact.one { justify-content: center; }
.contact.many { justify-content: center; gap: 0 18pt; padding: 0; flex-wrap: wrap; }
.rule { height: 0; border-top: 0.72pt solid #000; margin-left: -1.46pt; width: 492pt; }
section + section { margin-top: calc(10.8pt * var(--s)); }
.sec-title { font-weight: bold; text-transform: uppercase; padding-top: calc(5.2pt * var(--s)); margin-bottom: calc(5.15pt * var(--s)); }  /* heading centred between its rule and the first entry */
.row { position: relative; padding-left: 72pt; min-height: calc(10.35pt * var(--s)); }
.row .date { position: absolute; left: 0; top: 0; width: 70pt; font-weight: bold; white-space: nowrap; }
.row .org { font-weight: bold; display: inline-block; max-width: 318pt; }
.row .loc { position: absolute; left: 396pt; top: 0; font-weight: bold; white-space: nowrap; }
.sub { padding-left: 72pt; }
.sub.bold { font-weight: bold; }
.sub.italic { font-style: italic; }
.detail { padding-left: 72pt; }
ul { list-style: none; margin: 0; padding: 0 0 0 90pt; }
li { position: relative; padding-top: calc(0.66pt * var(--s)); text-align: justify; text-align-last: left; hyphens: manual; }
li::before { content: "\\2022"; position: absolute; left: -18.2pt; top: calc(1.7pt * var(--s)); font-family: Arial, Helvetica, sans-serif; font-size: 1.2em; line-height: calc(10.35pt * var(--s)); }
.skill-label { padding-left: 72pt; font-weight: bold; }
.skill-text { padding-left: 72pt; text-align: justify; text-align-last: left; }
[contenteditable="true"] { outline: none; border-radius: 1px; transition: background .2s; cursor: text; }
[contenteditable="true"]:hover { background: rgba(184, 50, 31, .06); }
[contenteditable="true"]:focus { background: rgba(184, 50, 31, .10); box-shadow: 0 0 0 1.5pt rgba(184, 50, 31, .35); }
`;

const ed = (path, editable) => (editable ? ` contenteditable="true" spellcheck="true" data-path="${path}"` : '');

export function cvBody(cv, { editable = false } = {}) {
  const contact = cv.contact || [];
  const cls = contact.length === 2 ? '' : contact.length === 1 ? ' one' : ' many';
  let h = `<div class="name"${ed('name', editable)}>${esc(cv.name)}</div>`;
  h += `<div class="contact${cls}">${contact
    .map((c, i) => `<span${ed(`contact.${i}`, editable)}>${esc(c)}</span>`)
    .join('')}</div>`;

  cv.sections.forEach((s, si) => {
    const P = `sections.${si}`;
    h += `<section><div class="rule"></div><div class="sec-title"${ed(`${P}.title`, editable)}>${esc(s.title)}</div>`;
    if (s.kind === 'skills') {
      (s.skills || []).forEach((g, gi) => {
        h += `<div class="skill-label"${ed(`${P}.skills.${gi}.label`, editable)}>${esc(g.label)}</div>`;
        h += `<div class="skill-text"${ed(`${P}.skills.${gi}.text`, editable)}>${esc(g.text)}</div>`;
      });
    } else {
      (s.entries || []).forEach((e, ei) => {
        const E = `${P}.entries.${ei}`;
        h += `<div class="entry"><div class="row"><span class="date"${ed(`${E}.date`, editable)}>${esc(e.date)}</span>`;
        h += `<span class="org"${ed(`${E}.organisation`, editable)}>${esc(e.organisation)}</span>`;
        if (e.location) h += `<span class="loc"${ed(`${E}.location`, editable)}>${esc(e.location)}</span>`;
        h += `</div>`;
        if (e.subtitle)
          h += `<div class="sub ${e.subtitle_style === 'italic' ? 'italic' : 'bold'}"${ed(`${E}.subtitle`, editable)}>${esc(e.subtitle)}</div>`;
        (e.details || []).forEach((d, di) => (h += `<div class="detail"${ed(`${E}.details.${di}`, editable)}>${esc(d)}</div>`));
        if (e.bullets?.length)
          h += `<ul>${e.bullets.map((b, bi) => `<li${ed(`${E}.bullets.${bi}`, editable)}>${esc(b)}</li>`).join('')}</ul>`;
        h += `</div>`;
      });
    }
    h += `</section>`;
  });
  return h;
}

// Script for the in-app editor: reports edits to the parent window by data-path.
const EDIT_SCRIPT = `
<script>
  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-path]');
    if (el) parent.postMessage({ kind: 'cv-edit', path: el.dataset.path, text: el.innerText.replace(/\\s+/g, ' ').trim() }, '*');
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
  document.addEventListener('paste', (e) => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\\s+/g, ' ')); });
</script>`;

// In-page fitter: finds the largest type scale (≤ 1) at which the CV fits one page and
// records the outcome on <html data-fit="…"> so the server can read it back.
export const MIN_SCALE = Number(process.env.CV_MIN_SCALE || 0.9); // 9.12pt → ~8.2pt at the smallest
const BOTTOM_MARGIN_PT = 26;
const FIT_SCRIPT = `
<script>
(function () {
  var MIN = ${MIN_SCALE}, PX = 4 / 3, BOTTOM = ${BOTTOM_MARGIN_PT} * PX;
  var cv = document.querySelector('.cv'), pg = document.querySelector('.page');
  function m(s) {
    cv.style.setProperty('--s', s);
    var top = cv.getBoundingClientRect().top - pg.getBoundingClientRect().top;
    return { h: cv.scrollHeight, limit: pg.clientHeight - top - BOTTOM, lh: parseFloat(getComputedStyle(cv).lineHeight) };
  }
  var r = m(1), scale = 1, overflow = 0;
  if (r.h > r.limit) {
    var lo = MIN, hi = 1, a = m(lo);
    if (a.h > a.limit) { scale = lo; overflow = Math.ceil((a.h - a.limit) / a.lh); r = a; }
    else {
      for (var i = 0; i < 10; i++) { var mid = (lo + hi) / 2; var x = m(mid); if (x.h <= x.limit) lo = mid; else hi = mid; }
      scale = Math.floor(lo * 1000) / 1000; r = m(scale);
    }
  }
  document.documentElement.setAttribute('data-fit', JSON.stringify({ scale: scale, fill: +(r.h / r.limit).toFixed(3), overflowLines: overflow }));
})();
</script>`;

export function cvHtml(cv, { editable = false, title = 'CV', extraCss = '' } = {}) {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${CV_CSS}${extraCss}</style></head><body>
<div class="page"><div class="cv">${cvBody(cv, { editable })}</div></div>
${FIT_SCRIPT}${editable ? EDIT_SCRIPT : ''}</body></html>`;
}

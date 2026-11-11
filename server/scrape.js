// Job posting extraction.
// LinkedIn: uses the public "guest" job-posting endpoint (no login needed).
// Everything else: JSON-LD JobPosting if present, otherwise readable page text.
import * as cheerio from 'cheerio';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const clean = (s = '') => s.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();

/** Turn a chunk of description HTML into readable text with bullets + paragraphs. */
function htmlToText($, el) {
  const $el = $(el).clone();
  $el.find('script,style,noscript,svg,button').remove();
  $el.find('br').replaceWith('\n');
  $el.find('li').each((_, li) => {
    $(li).prepend('• ');
    $(li).append('\n');
  });
  $el.find('p,div,h1,h2,h3,h4,h5,h6,ul,ol,section,tr').each((_, n) => {
    $(n).append('\n');
  });
  return $el
    .text()
    .split('\n')
    .map(clean)
    .filter(Boolean)
    .join('\n');
}

function linkedInJobId(url) {
  try {
    const u = new URL(url);
    if (!/linkedin\./i.test(u.hostname)) return null;
    const q = u.searchParams.get('currentJobId');
    if (q && /^\d+$/.test(q)) return q;
    const m = u.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function get(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, 'accept-language': 'en-GB,en;q=0.9', accept: 'text/html,*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`The job page answered ${res.status} ${res.statusText}`);
  return res.text();
}

async function scrapeLinkedIn(id, originalUrl) {
  // Public guest endpoint first, then the public job page itself. If LinkedIn says no
  // (e.g. 429 rate limiting), we stop and ask for a pasted description — no retries/evasion.
  let html;
  try {
    html = await get(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`);
  } catch {
    try {
      html = await get(`https://www.linkedin.com/jobs/view/${id}/`);
    } catch (e) {
      throw new Error(
        `LinkedIn wouldn't share this posting right now (${e.message.replace('The job page answered ', '')}). Paste the description text instead — or try the link again in a minute.`,
      );
    }
  }
  const $ = cheerio.load(html);
  const description = htmlToText($, $('.show-more-less-html__markup').first());
  if (!description || description.length < 80) {
    throw new Error('LinkedIn did not return a description for this job (it may be closed or region-locked).');
  }
  const criteria = [];
  $('.description__job-criteria-item').each((_, li) => {
    const k = clean($(li).find('.description__job-criteria-subheader').text());
    const v = clean($(li).find('.description__job-criteria-text').text());
    if (k && v) criteria.push({ label: k, value: v });
  });
  return {
    source: 'LinkedIn',
    url: `https://www.linkedin.com/jobs/view/${id}/`,
    originalUrl,
    title: clean($('.top-card-layout__title, .topcard__title').first().text()),
    company: clean($('.topcard__org-name-link, .topcard__flavor a').first().text()),
    location: clean($('.topcard__flavor--bullet').first().text()),
    posted: clean($('.posted-time-ago__text').first().text()),
    applicants: clean($('.num-applicants__caption, .topcard__flavor--metadata').last().text()),
    criteria,
    description,
  };
}

function findJobPosting(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findJobPosting(n);
      if (f) return f;
    }
    return null;
  }
  const t = node['@type'];
  if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) return node;
  if (node['@graph']) return findJobPosting(node['@graph']);
  return null;
}

async function scrapeGeneric(url) {
  const html = await get(url);
  const $ = cheerio.load(html);
  const host = new URL(url).hostname.replace(/^www\./, '');

  // 1. Structured data — most ATSs (Greenhouse, Lever, Workable, SmartRecruiters…) ship this.
  let posting = null;
  $('script[type="application/ld+json"]').each((_, s) => {
    if (posting) return;
    try {
      posting = findJobPosting(JSON.parse($(s).contents().text()));
    } catch {}
  });
  if (posting?.description) {
    const $d = cheerio.load(`<div id="d">${posting.description}</div>`);
    const loc = [].concat(posting.jobLocation || [])[0]?.address;
    return {
      source: host,
      url,
      originalUrl: url,
      title: clean(posting.title),
      company: clean(posting.hiringOrganization?.name || ''),
      location: clean(
        [loc?.addressLocality, loc?.addressRegion, loc?.addressCountry?.name || loc?.addressCountry]
          .filter((x) => typeof x === 'string')
          .join(', '),
      ),
      posted: posting.datePosted ? String(posting.datePosted).slice(0, 10) : '',
      applicants: '',
      criteria: posting.employmentType ? [{ label: 'Employment type', value: String(posting.employmentType) }] : [],
      description: htmlToText($d, $d('#d')),
    };
  }

  // 2. Fallback: readable text of the page.
  $('script,style,noscript,svg,nav,footer,header,iframe,form').remove();
  const main = $('main, article, [role=main], #content, .content').first();
  const text = htmlToText($, main.length ? main : $('body'));
  if (text.length < 300) {
    throw new Error(
      `Couldn't read a job description from ${host} (the page is probably rendered by JavaScript). Paste the description text instead.`,
    );
  }
  return {
    source: host,
    url,
    originalUrl: url,
    title: clean($('meta[property="og:title"]').attr('content') || $('title').text()),
    company: clean($('meta[property="og:site_name"]').attr('content') || ''),
    location: '',
    posted: '',
    applicants: '',
    criteria: [],
    description: text.slice(0, 30000),
  };
}

export async function scrapeJob(url) {
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const id = linkedInJobId(url);
  return id ? scrapeLinkedIn(id, url) : scrapeGeneric(url);
}

/** For pasted descriptions: a minimal job object; Claude fills in title/company. */
export function jobFromText(text) {
  return {
    source: 'Pasted',
    url: '',
    originalUrl: '',
    title: '',
    company: '',
    location: '',
    posted: '',
    applicants: '',
    criteria: [],
    description: text.trim().slice(0, 30000),
  };
}

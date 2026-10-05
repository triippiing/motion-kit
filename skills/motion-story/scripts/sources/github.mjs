// github.mjs -- the GitHub API client for the repo reader: read-only GETs, nothing else.
//
//   parseGithubUrl(s) -> { owner, repo } | null
//   api(path, { optional, notFound }) -> json (null on a 404 when optional)     pages(path) -> [...every page's items]
//
// A source URL is https://github.com/OWNER/REPO, with an optional www., .git and trailing slash; anything else
// (a path after the repo, a query, a user, http) is not one. Every request is a GET of
// `${MK_GITHUB_API || 'https://api.github.com'}${path}` (both env vars read per call) with Accept
// application/vnd.github+json, User-Agent motion-kit, Authorization Bearer $GITHUB_TOKEN only when it is set, and a
// 15 s timeout (MK_GITHUB_TIMEOUT_MS overrides it, for the tests) over the request and reading its body. A 404 is a
// UsageError (exit 2): notFound when the caller gives one (`no pull request #N in O/R`), else `not found (private
// repos: use a local clone)`; a 403 or 429 that
// is a rate limit (x-ratelimit-remaining 0, retry-after, or a message saying so) is an Error (`rate limited by
// GitHub: set GITHUB_TOKEN or try later`, exit 1), as is any other failure. A redirect (a renamed repo) is followed
// up to 3 times on the base's own host, never elsewhere.
// pages follows the Link header's rel="next" for up to 10 pages (a warning when a next link is left); a next link is
// always asked of the configured base (one on another host by its path and query), so no request goes anywhere else.
import { UsageError } from '../facts.mjs';

export const NOT_FOUND = 'not found (private repos: use a local clone)';
export const RATE_LIMITED = 'rate limited by GitHub: set GITHUB_TOKEN or try later';
const timeout = () => Number(process.env.MK_GITHUB_TIMEOUT_MS) || 15000;
const TIMED_OUT = () => `the GitHub API did not answer in ${timeout() / 1000} s`;
const MAX_PAGES = 10;

const NAME = /^[\w.-]+$/;

export function parseGithubUrl(s) {
  const m = /^https:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+?)(?:\.git)?\/?$/i.exec(s ?? '');
  if (!m || !NAME.test(m[1]) || !NAME.test(m[2]) || /^\.+$/.test(m[1]) || /^\.+$/.test(m[2])) return null;
  return { owner: m[1], repo: m[2] };
}

const base = () => (process.env.MK_GITHUB_API || 'https://api.github.com').replace(/\/+$/, '');

const MAX_REDIRECTS = 3;

// The response for a GET of url: a fetch failure or timeout is an Error with a sentence, not "fetch failed". A
// redirect (a renamed repo) is followed on the base's own host only, so the token never leaves it.
async function get(url) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'motion-kit' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const origin = new URL(base()).origin;
  for (let hop = 0; ; hop++) {
    let res;
    try {
      res = await fetch(url, { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(timeout()) });
    } catch (e) {
      if (e.name === 'TimeoutError') throw new Error(TIMED_OUT());
      throw new Error(`cannot reach the GitHub API at ${base()}: ${e.cause?.code ?? e.cause?.message ?? e.message}`);
    }
    const to = [301, 302, 303, 307, 308].includes(res.status) && res.headers.get('location');
    if (!to) return res;
    const next = new URL(to, url);
    if (next.origin !== origin || hop >= MAX_REDIRECTS) throw new Error(`GitHub API: a redirect away from ${base()} for ${new URL(url).pathname}`);
    url = next.href;
  }
}

// The response's JSON, after mapping its status to the errors above. The timeout also covers reading the body.
async function json(res, path, optional, notFound = NOT_FOUND) {
  let text;
  try {
    text = await res.text();
  } catch (e) {
    if (e.name === 'TimeoutError' || e.cause?.name === 'TimeoutError') throw new Error(TIMED_OUT());
    throw new Error(`GitHub API: the answer for ${path} broke off: ${e.cause?.code ?? e.cause?.message ?? e.message}`);
  }
  let body;
  try { body = JSON.parse(text); } catch { body = undefined; }
  if (res.ok) {
    if (body === undefined) throw new Error(`GitHub API: not JSON for ${path}`);
    return body;
  }
  if (res.status === 404) {
    if (optional) return null;
    throw new UsageError(notFound);
  }
  if ((res.status === 403 || res.status === 429) && (res.headers.get('x-ratelimit-remaining') === '0'
    || res.headers.has('retry-after') || /rate limit/i.test(body?.message ?? ''))) throw new Error(RATE_LIMITED);
  throw new Error(`GitHub API: HTTP ${res.status} for ${path}`);
}

// The JSON at path (which starts with /); with optional, null for a 404; with notFound, that message for a 404.
export async function api(path, { optional = false, notFound } = {}) {
  return json(await get(base() + path), path, optional, notFound);
}

// The next page's URL on the configured base, from a Link header, else null.
function nextPage(link) {
  const m = /<([^>]+)>\s*;\s*rel="?next"?/.exec(link ?? '');
  if (!m) return null;
  const b = base();
  const u = new URL(m[1], `${b}/`);
  return u.origin === new URL(b).origin ? u.href : b + u.pathname + u.search;
}

// Every item of a paginated list at path, following rel="next" for up to MAX_PAGES pages; a warning when the list
// goes on past them.
export async function pages(path) {
  const items = [];
  let url = base() + path;
  for (let i = 0; url && i < MAX_PAGES; i++) {
    const res = await get(url);
    const page = await json(res, i ? new URL(url).pathname : path, false);
    if (!Array.isArray(page)) throw new Error(`GitHub API: not a list for ${path}`);
    items.push(...page);
    url = nextPage(res.headers.get('link'));
  }
  if (url) {
    process.stderr.write(`warning: GitHub lists more than ${MAX_PAGES} pages for ${path.split('?')[0]}: only the first ${MAX_PAGES} `
      + 'were read (a local clone reads them all)\n');
  }
  return items;
}

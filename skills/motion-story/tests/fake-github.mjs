// fake-github.mjs -- a stand-in for the GitHub REST API on 127.0.0.1, for the repo reader's URL tests.
//
//   const fake = await startFake(routes); fake.base -> 'http://127.0.0.1:PORT'; fake.log -> [{ method, url, auth }]
//   await fake.close()
//
// routes maps a request path (with its query) to a response: a JSON value (200), { status: NUMBER, headers?, body } or a
// function (fake) => either. An unknown path is a 404 like GitHub's. Every request is logged (method, path, the
// Authorization header or null), so a test can check exactly what was asked for and how.
// compareJson builds what /compare (or /commits) returns for a range of a real git repo, so URL facts can be
// checked against the local reader's facts for the same history.
import { execFileSync } from 'node:child_process';
import http from 'node:http';

export async function startFake(routes) {
  const log = [];
  const fake = { log, base: '' };
  const server = http.createServer((req, res) => {
    log.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? null, accept: req.headers.accept ?? null,
      agent: req.headers['user-agent'] ?? null });
    let r = Object.hasOwn(routes, req.url) ? routes[req.url] : { status: 404, body: { message: 'Not Found' } };
    if (typeof r === 'function') r = r(fake);
    if (!r || typeof r !== 'object' || typeof r.status !== 'number' || !('body' in r)) r = { status: 200, body: r };
    res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8', ...(r.headers ?? {}) });
    res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  fake.base = `http://127.0.0.1:${server.address().port}`;
  fake.close = () => new Promise((ok) => { server.closeAllConnections(); server.close(ok); });
  return fake;
}

// The commits git lists for range in dir, oldest first, as the API shows them: { sha, commit: { author: { name },
// message }, parents: [{ sha }] }.
export function apiCommits(dir, range) {
  const out = execFileSync('git', ['-C', dir, 'log', '--reverse', '--format=%H%x1f%P%x1f%an%x1f%B%x1e', range, '--'], { encoding: 'utf8' });
  return out.split('\x1e').map((r) => r.replace(/^\n/, '')).filter(Boolean).map((r) => {
    const [sha, parents, name, message] = r.split('\x1f');
    return { sha, commit: { author: { name }, message: message.replace(/\n+$/, '') }, parents: parents.trim().split(' ').filter(Boolean).map((p) => ({ sha: p })) };
  });
}

// /compare's answer for base...head in dir.
export function compareJson(dir, base, head) {
  const commits = apiCommits(dir, `${base}..${head}`);
  return { status: 'ahead', total_commits: commits.length, commits };
}

// The sha a ref names in dir.
export const sha = (dir, ref) => execFileSync('git', ['-C', dir, 'rev-parse', `${ref}^{commit}`], { encoding: 'utf8' }).trim();

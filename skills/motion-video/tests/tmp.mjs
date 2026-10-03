// tmp.mjs -- temp directories for tests, removed when the test process ends (normally, on a crash, or on
// SIGINT/SIGTERM). node --test runs each file in its own process, so every file cleans up after itself.
// MK_KEEP_TMP=1 keeps them and lists them on stderr, for a look after a failure.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const made = [];
let installed = false;

function cleanup() {
  if (process.env.MK_KEEP_TMP === '1') {
    if (made.length) process.stderr.write(`kept temp dirs (MK_KEEP_TMP=1):\n${made.splice(0).join('\n')}\n`);
    return;
  }
  for (const d of made.splice(0)) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
}

export function tempDir(prefix = 'mk-') {
  if (!installed) {
    installed = true;
    process.on('exit', cleanup);
    // a handler replaces the default exit on these signals, so exit with the shell's code for them
    for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.on(sig, () => { cleanup(); process.exit(code); });
  }
  const d = mkdtempSync(path.join(tmpdir(), prefix));
  made.push(d);
  return d;
}

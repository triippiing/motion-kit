// is_main.mjs -- true when the module at metaUrl is the script node was started with. Compares real paths, so it
// holds through the skill symlinks; a missing or unresolvable argv[1] is "no" rather than an ENOENT crash.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function isMain(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try { return realpathSync(argv1) === realpathSync(fileURLToPath(metaUrl)); } catch { return false; }
}

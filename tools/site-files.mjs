/* What the site publishes, in ONE place: the rule GitHub Pages' Jekyll applies to
   this repository. A path is served unless one of its parts starts with "_" or
   "." (that keeps _src/ and the past versions off the web) or it is on the
   `exclude:` list of _config.yml (the guides, tools/, functions/, the Firebase
   files). tools/smoke.mjs serves the site by this rule, and the publish workflow
   copies exactly these files when it publishes the site itself:

     node tools/site-files.mjs _site      copy every published file into _site/
     node tools/site-files.mjs --list     print them

   Only files Git tracks are published, as with GitHub Pages building from the
   branch: whatever lies around untracked (node_modules/, screenshots) stays out. */
import { readFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** the `exclude:` list of _config.yml */
export function excludeList(root = ROOT) {
  const out = [];
  let inList = false;
  for (const line of readFileSync(path.join(root, '_config.yml'), 'utf8').split('\n')) {
    if (/^exclude:\s*$/.test(line)) { inList = true; continue; }
    if (!inList) continue;
    const m = line.match(/^\s+-\s*["']?([^"'#]+?)["']?\s*$/);
    if (m) out.push(m[1].replace(/\/$/, ''));
    else if (/^\S/.test(line)) inList = false;
  }
  return out;
}
/** is `rel` (a path from the repository's root, with /) served? */
export function isPublished(rel, exclude) {
  return !rel.split('/').some(s => s[0] === '.' || s[0] === '_') &&
    !exclude.some(e => rel === e || rel.startsWith(e + '/'));
}
/** every tracked file the site serves */
export function publishedFiles(root = ROOT) {
  const exclude = excludeList(root);
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 })
    .split('\0').filter(Boolean).filter(rel => isPublished(rel, exclude) && existsSync(path.join(root, rel)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  const files = publishedFiles();
  if (!arg || arg === '--list') { for (const f of files) console.log(f); process.exit(0); }
  const out = path.resolve(arg);
  if (out === ROOT || ROOT.startsWith(out + path.sep)) { console.error('site-files: refusing to write into the repository itself'); process.exit(1); }
  rmSync(out, { recursive: true, force: true });
  for (const f of files) {
    const to = path.join(out, f);
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(path.join(ROOT, f), to);
  }
  if (!files.includes('index.html') || !files.includes('404.html')) { console.error('site-files: index.html or 404.html missing'); process.exit(1); }
  console.log(`site-files: ${files.length} files in ${path.relative(process.cwd(), out) || out}`);
}

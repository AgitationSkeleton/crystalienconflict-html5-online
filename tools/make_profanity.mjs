// The profanity filter's table (src/online/profanity.js): each word of a plain list, kept outside
// the repository, as a hash of the filter's own spelling of it -- so the repository holds no word.
//
//   node tools/make_profanity.mjs LIST     -> src/online/profanity-table.js
//
// LIST has a word a line after how it is looked for: "a" anywhere in a word, "p" at a word's
// start, "w" only as the whole word; or "s", an innocent word that holds one of them, which is
// spared it (a town's name, say).  # starts a comment.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fold, runs, hash } from '../src/online/profanity.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const list = process.argv[2];
if (!list) {
  console.error('usage: node tools/make_profanity.mjs LIST');
  process.exit(2);
}
const h = {};
let max = 0;
let count = 0;
for (const raw of readFileSync(list, 'utf8').split(/\r?\n/)) {
  const line = raw.replace(/#.*/, '').trim();
  if (!line) continue;
  const m = /^([apws])\s+(\S+)$/.exec(line);
  if (!m) {
    console.error('not "a|p|w|s word": ' + JSON.stringify(line));
    process.exit(1);
  }
  // (and with its l's as i's, for a 1 written for an l: the filter does not fold l into i)
  for (const spelling of new Set([m[2], m[2].replace(/l/g, 'i')])) {
    const r = runs(fold(spelling));
    if (!r.skeleton || r.counts.some((c) => c > 9)) {
      console.error('cannot use: ' + JSON.stringify(line));
      process.exit(1);
    }
    const entry = m[1] + r.counts.join('');
    const key = hash(r.skeleton);
    const had = h[key] ? h[key].split('|') : [];
    if (!had.includes(entry)) h[key] = had.concat([entry]).join('|');
    max = Math.max(max, r.skeleton.length);
  }
  count++;
}
const keys = Object.keys(h).sort();
const body = '// Made by tools/make_profanity.mjs: the profanity filter\'s words, as hashes (see profanity.js).\n' +
  '// Do not edit by hand.\n' +
  'export const WORDS = {\n  max: ' + max + ',\n  h: {\n' + keys.map((k) => '    ' + JSON.stringify(k) + ': ' + JSON.stringify(h[k]) + ',\n').join('') + '  },\n};\n';
writeFileSync(join(root, 'src', 'online', 'profanity-table.js'), body);
console.log(count + ' words, ' + keys.length + ' hashes -> src/online/profanity-table.js');

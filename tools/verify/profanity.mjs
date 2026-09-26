// The profanity filter (src/online/profanity.js): innocent text comes through as it was; and,
// given the plain list (kept outside the repository; see tools/make_profanity.mjs), every listed
// word is starred out however it is disguised -- capitals, stand-ins, repeated or spaced-out
// letters, look-alike alphabets, inside a sentence -- while the list's words to spare are not.
//
//   node tools/verify/profanity.mjs [LIST]

import { readFileSync } from 'node:fs';
import { censor, isClean } from '../../src/online/profanity.js';

let failures = 0;
const fail = (what) => { failures++; console.log('FAIL ' + what); };

const INNOCENT = [
  'gg wp, nice base', 'Hello! Is this the lobby?', "I'm attacking your left side, hold the crystals", 'lol that was close',
  'the class passed the grass and the glass compass', 'Essex and Middlesex', 'Niger and Nigeria', 'Nigel is here',
  'a title, a titan, the Titanic, the constitution', 'cumulative cucumbers', 'the circumstances of the document',
  'analysis of the canal', 'grapes, drapes, scraped knees', 'a spicy spice', 'Mississippi', 'Arsenal', 'arsenic',
  'parse the sparse data', 'the gymnasium', 'Dido', 'shell', 'hello', 'assume, assist, assemble, asset', 'bass guitar',
  'Astro', 'Alien', 'harvester', 'Vio', 'Player', 'Computer 3', 'A s t r o', 'b a s e', 'I am a pro', 'u r a b c d',
  'the cook cooks cocoa', 'kiss', 'dice', 'cis', 'tilts', 'Bob', 'a con', 'pills and spills', 'a flag', 'the colon', 'prone',
  'the cook kissed Bob and rolled the dice', 'Pakistan', 'raccoon in a cocoon',
];
for (const t of INNOCENT) if (!isClean(t)) fail('innocent text starred: ' + JSON.stringify(t) + ' -> ' + JSON.stringify(censor(t)));

const list = process.argv[2];
if (list) {
  const LEET = { a: '4', e: '3', i: '1', o: '0', s: '$', t: '7' };
  const CYRILLIC = { a: 'а', e: 'е', o: 'о', c: 'с', p: 'р', x: 'х' };
  const fullwidth = (w) => Array.from(w, (c) => (/[a-z]/.test(c) ? String.fromCharCode(c.charCodeAt(0) + 0xfee0) : c)).join('');
  let words = 0, spared = 0;
  for (const raw of readFileSync(list, 'utf8').split(/\r?\n/)) {
    const m = /^([apws])\s+(\S+)$/.exec(raw.replace(/#.*/, '').trim());
    if (!m) continue;
    const [, mode, w] = m;
    if (mode === 's') {
      spared++;
      for (const t of [w, w[0].toUpperCase() + w.slice(1), 'we went to ' + w + ' today']) {
        if (!isClean(t)) fail('a word to spare (#' + spared + ') was starred');
      }
      continue;
    }
    words++;
    const disguises = [
      w, w.toUpperCase(), w[0].toUpperCase() + w.slice(1), w + '!', '"' + w + '"',
      Array.from(w, (c) => LEET[c] || c).join(''),
      Array.from(w, (c) => c + c).join(''),
      w.replace(/[aeiou]/, (v) => v + v + v + v),
      w.split('').join(' '), w.split('').join('.'), w.split('').join('-'),
      Array.from(w, (c) => CYRILLIC[c] || c).join(''),
      fullwidth(w),
      'you are a ' + w + ' ok',
    ];
    if (mode === 'a') disguises.push('xx' + w + 'yy', 'super' + w);
    if (mode === 'p') disguises.push(w + 'ing');
    disguises.forEach((d, i) => {
      if (isClean(d)) fail(mode + ' word #' + words + ' not caught in disguise ' + i);
    });
  }
  console.log(words + ' listed words checked, ' + spared + ' to spare');
}

// Speed: a long message, many times.
const msg = 'the quick brown fox jumps over the lazy dog while the Astros harvest crystals on Tri-Star '.repeat(2).slice(0, 200);
const t0 = performance.now();
for (let i = 0; i < 5000; i++) censor(msg);
const ms = (performance.now() - t0) / 5000;
console.log('censor of a 200-character message: ' + ms.toFixed(3) + ' ms');
if (ms > 2) fail('too slow');
console.log(failures ? failures + ' failed' : 'all passed');
process.exit(failures ? 1 : 0);

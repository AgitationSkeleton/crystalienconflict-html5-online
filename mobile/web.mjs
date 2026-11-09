// The game's files for the Android app (mobile/www/, which Capacitor puts in the app): the
// repository's index.html, src/, data/ and assets/, as the website has them.  (Not the web
// app's service worker or manifest: the app has its files already.)
//
//   node web.mjs        (npm run web; npm run sync also copies them into android/)

import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const www = join(here, 'www');
rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });
cpSync(join(root, 'index.html'), join(www, 'index.html'));
// (the page over the whole screen, the camera's cutout too -- with the system bars hidden, as
// the app has them.  Without viewport-fit=cover, Capacitor kept the cutout and the bars' room
// clear, a grey band along the screen's edge; the menus keep clear of it themselves, with
// env(safe-area-inset-*).  See capacitor.config.json: initialViewportFitValueHint.)
const page = join(www, 'index.html');
const html = readFileSync(page, 'utf8');
const fitted = html.replace('content="width=device-width, initial-scale=1"', 'content="width=device-width, initial-scale=1, viewport-fit=cover"');
if (fitted === html) throw new Error('index.html: the viewport tag was not found');
writeFileSync(page, fitted);
for (const dir of ['src', 'data', 'assets']) cpSync(join(root, dir), join(www, dir), { recursive: true });
console.log('mobile/www: index.html, src/, data/, assets/');

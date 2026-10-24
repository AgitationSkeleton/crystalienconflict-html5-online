// The game installed (the web app manifest, manifest.webmanifest) and played offline: a
// service worker that keeps all of one version of the game's files.
//
// - The site's files are not named by their contents, so a version is kept whole: every file
//   the page can load (FILES, written below by tools/stamp_offline.py as each commit is made)
//   is fetched into a cache of that version's own when the worker is installed, and the
//   caches of other versions are let go when it takes over.  A new version of the site is a
//   new sw.js (its VERSION), which the browser notices on a visit.  The page in use keeps its
//   files until it is loaded again (src/online/offline.js offers to).
// - The page itself (index.html, whatever its ?join=) comes from the network first, so that a
//   visit online has the newest; offline, or the network too slow, the kept copy.
// - Everything else of the site is answered from the cache; what is not in it, from the
//   network.  Other sites (the game's server, GitHub) are not touched.

// stamp: tools/stamp_offline.py
const VERSION = '1f890641b962';
const FILES = [
  "assets/fonts/125_NissanD.ttf",
  "assets/fonts/1641_NissanD.ttf",
  "assets/fonts/4870_Martian.ttf",
  "assets/fonts/683_NissanD.ttf",
  "assets/fonts/750_Arial Black.ttf",
  "assets/game/bitmaps.bin",
  "assets/game/sounds.bin",
  "assets/icons/apple-touch-icon.png",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/icon-maskable-512.png",
  "assets/loader/bitmaps.bin",
  "assets/loader/sounds.bin",
  "assets/online/alien.png",
  "assets/online/astro.png",
  "assets/online/horizon.jpg",
  "assets/online/icons/BJ_evil.png",
  "assets/online/icons/BK_evil.png",
  "assets/online/icons/UM_evil.png",
  "assets/online/icons/UN_evil.png",
  "assets/online/landscape.jpg",
  "assets/online/mugshots/BA_evil.png",
  "assets/online/mugshots/BA_good.png",
  "assets/online/mugshots/BB_evil.png",
  "assets/online/mugshots/BB_good.png",
  "assets/online/mugshots/BC_evil.png",
  "assets/online/mugshots/BC_good.png",
  "assets/online/mugshots/BD_evil.png",
  "assets/online/mugshots/BD_good.png",
  "assets/online/mugshots/BE_evil.png",
  "assets/online/mugshots/BE_good.png",
  "assets/online/mugshots/BF_evil.png",
  "assets/online/mugshots/BF_good.png",
  "assets/online/mugshots/BG_evil.png",
  "assets/online/mugshots/BG_good.png",
  "assets/online/mugshots/BH_evil.png",
  "assets/online/mugshots/BH_good.png",
  "assets/online/mugshots/BI_good.png",
  "assets/online/mugshots/BK_good.png",
  "assets/online/mugshots/BL_good.png",
  "assets/online/mugshots/UA_evil.png",
  "assets/online/mugshots/UA_good.png",
  "assets/online/mugshots/UB_evil.png",
  "assets/online/mugshots/UB_good.png",
  "assets/online/mugshots/UC_evil.png",
  "assets/online/mugshots/UC_good.png",
  "assets/online/mugshots/UD_evil.png",
  "assets/online/mugshots/UD_good.png",
  "assets/online/mugshots/UE_evil.png",
  "assets/online/mugshots/UE_good.png",
  "assets/online/mugshots/UF_evil.png",
  "assets/online/mugshots/UF_good.png",
  "assets/online/mugshots/UG_evil.png",
  "assets/online/mugshots/UG_good.png",
  "assets/online/mugshots/UH_evil.png",
  "assets/online/mugshots/UH_good.png",
  "assets/online/mugshots/UJ_good.png",
  "assets/online/mugshots/UK.png",
  "assets/online/mugshots/UP_evil.png",
  "assets/online/mugshots/UP_good.png",
  "assets/online/mugshots/UQ_evil.png",
  "assets/online/mugshots/UR_good.png",
  "assets/online/mugshots/back_evil.png",
  "assets/online/mugshots/back_good.png",
  "assets/online/mugshots/hive.png",
  "assets/online/mugshots/reindeer.png",
  "assets/online/mugshots/santa.png",
  "assets/online/mugshots/sleigh.png",
  "data/accents.json",
  "data/dialogue.xml",
  "data/game.json",
  "data/loader.json",
  "data/maps/cnc-scm01ea.json",
  "data/maps/cnc-scm02ea.json",
  "data/maps/cnc-scm03ea.json",
  "data/maps/cnc-scm04ea.json",
  "data/maps/cnc-scm05ea.json",
  "data/maps/cnc-scm06ea.json",
  "data/maps/cnc-scm07ea.json",
  "data/maps/cnc-scm08ea.json",
  "data/maps/cnc-scm09ea.json",
  "data/maps/cnc-scm10ea.json",
  "data/maps/cnc-scm50ea.json",
  "data/maps/cnc-scm51ea.json",
  "data/maps/cnc-scm52ea.json",
  "data/maps/cnc-scm60ea.json",
  "data/maps/cnc-scm61ea.json",
  "data/maps/cnc-scm62ea.json",
  "data/maps/cnc-scm70ea.json",
  "data/maps/cnc-scm71ea.json",
  "data/maps/cnc-scm72ea.json",
  "data/maps/cnc-scm73ea.json",
  "data/maps/cnc-scm74ea.json",
  "data/maps/cnc-scm75ea.json",
  "data/maps/cnc-scm77ea.json",
  "data/maps/cnc-scm90ea.json",
  "data/maps/cnc-scm96ea.json",
  "data/maps/cnc-scm97ea.json",
  "data/maps/cnc-scm98ea.json",
  "data/maps/cnc-scmc0ea.json",
  "data/maps/cnc-scmc1ea.json",
  "data/maps/cnc-scmc2ea.json",
  "data/maps/cnc-scmc3ea.json",
  "data/maps/cnc-scmc4ea.json",
  "data/maps/cnc-scmc5ea.json",
  "data/maps/cnc-scmc6ea.json",
  "data/maps/index.json",
  "data/maps/lego-mp01.json",
  "data/maps/lego-mp02.json",
  "data/maps/lego-mp03.json",
  "data/maps/lego-mp04.json",
  "data/maps/lego-mp05.json",
  "data/maps/lego-mp06.json",
  "data/maps/lego-mp07.json",
  "data/maps/lego-mp08.json",
  "data/maps/lego-mp09.json",
  "data/maps/lego-mp10.json",
  "data/maps/lego-mp11.json",
  "data/maps/lego-mp12.json",
  "data/maps/lego-mp13.json",
  "data/maps/lego-mp14.json",
  "data/maps/lego-mp15.json",
  "data/maps/lego-mp16.json",
  "data/maps/lego-mp17.json",
  "data/maps/lego-mp18.json",
  "data/maps/lego-mp19.json",
  "data/maps/lego-mp20.json",
  "data/maps/lego-mp21.json",
  "data/maps/lego-mp22.json",
  "data/maps/lego-mp23.json",
  "data/maps/lego-mp24.json",
  "data/maps/lego-mp25.json",
  "data/maps/lego-mp26.json",
  "data/maps/lego-mp27.json",
  "data/maps/lego-mp28.json",
  "data/maps/lego-mp29.json",
  "data/maps/lego-mp30.json",
  "data/mugshots.json",
  "data/sizes.json",
  "index.html",
  "manifest.webmanifest",
  "src/flash/as2.js",
  "src/flash/detmath.js",
  "src/flash/display.js",
  "src/flash/filters.js",
  "src/flash/geom.js",
  "src/flash/library.js",
  "src/flash/player.js",
  "src/flash/render.js",
  "src/flash/sound.js",
  "src/flash/text.js",
  "src/hiscore.js",
  "src/main.js",
  "src/online/android.js",
  "src/online/bot.js",
  "src/online/errors.js",
  "src/online/net.js",
  "src/online/offline.js",
  "src/online/profanity-table.js",
  "src/online/profanity.js",
  "src/online/settings.js",
  "src/online/spelling.js",
  "src/online/touch.js",
  "src/online/ui.css",
  "src/online/ui.js",
  "src/scripts/game.js",
  "src/scripts/loader.js"
];
// /stamp

const CACHE = 'cac-' + VERSION;
const SCOPE = self.registration.scope;
const PAGE = new URL('index.html', SCOPE).href;
const SLOW = 4000;                     // how long the page waits for the network, in ms

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // (past the server's own caching of the files: GitHub Pages keeps them ten minutes)
    await cache.addAll(FILES.map((f) => new Request(new URL(f, SCOPE).href, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('cac-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(SCOPE)) return;
  if (req.mode === 'navigate') e.respondWith(page(req));
  else e.respondWith(file(req));
});

// The page: from the network if it answers in time, else the copy kept.
async function page(req) {
  const net = fetch(req);
  const late = new Promise((resolve) => setTimeout(resolve, SLOW, null));
  try {
    const r = await Promise.race([net, late]);
    if (r && r.ok) return r;
  } catch (err) {
    // (offline)
  }
  const kept = await caches.match(PAGE, { cacheName: CACHE });
  return kept || net;
}

// A file: the copy kept, else the network's.
async function file(req) {
  const kept = await caches.match(req, { cacheName: CACHE });
  return kept || fetch(req);
}

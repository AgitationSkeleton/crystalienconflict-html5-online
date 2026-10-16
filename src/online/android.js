// The Android app (mobile/, Capacitor): its version, and whether a newer one is out on the
// repository's GitHub Releases (.github/workflows/app.yml puts each version's .apk there).  An
// app from outside a store cannot update itself: the settings say a new one is out, and its
// link opens in the phone's browser, which downloads it for the player to install.

export const RELEASES = 'https://github.com/AgitationSkeleton/crystalienconflict-html5-online/releases/latest';
export const RELEASES_API = 'https://api.github.com/repos/AgitationSkeleton/crystalienconflict-html5-online/releases/latest';

export const android = {
  version: null,        // this app's, once known
  update: null,         // {version, url} of a newer one
  listeners: [],
  changed() { for (const f of this.listeners) f(); },
};

export function isAndroidApp() {
  const C = window.Capacitor;
  return !!(C && C.isNativePlatform && C.isNativePlatform() && C.getPlatform && C.getPlatform() === 'android');
}

// Is version a newer than b?  ("1.1.12" > "1.1.9")
export function newer(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

// A page outside the game, in the phone's browser (the app's own window keeps to the game).
export function openOutside(url) {
  location.href = url;
}

export async function checkAndroid() {
  if (!isAndroidApp()) return;
  // (links that would open a new window -- the credits, the desktop app's -- open in the
  // phone's browser: a new window does nothing in the app's)
  document.addEventListener('click', (e) => {
    const a = e.target instanceof Element && e.target.closest('a[href]');
    if (!a || !/^https?:/.test(a.href) || new URL(a.href).host === location.host) return;
    e.preventDefault();
    openOutside(a.href);
  }, true);
  try {
    const info = await window.Capacitor.Plugins.App.getInfo();
    android.version = info.version;
    android.changed();
    const r = await fetch(RELEASES_API, { cache: 'no-store' });
    if (!r.ok) return;
    const rel = await r.json();
    const v = String(rel.tag_name || '').replace(/^v/, '');
    const apk = (rel.assets || []).find((a) => /\.apk$/.test(a.name));
    if (apk && newer(v, android.version)) {
      android.update = { version: v, url: apk.browser_download_url };
      android.changed();
    }
  } catch (e) {
    // (offline, or no answer: asked again next time)
  }
}

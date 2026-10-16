// The game as an installed web app that plays offline (sw.js, manifest.webmanifest): the
// service worker registered, the browser's offer to install it kept for the settings' App
// part (src/online/ui.js), and a new version, once its worker has taken over, offered there
// to be loaded.
//
// Not in the app for Windows, macOS and Linux (client/, app://), the Android app (Capacitor),
// or the tests' runs (?test): they have their files already, or want none kept.

export const offline = {
  installed: matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true,
  prompt: null,         // the browser's install offer, while it has one
  updated: false,       // a newer version kept, for when the page is loaded again
  listeners: [],
  changed() { for (const f of this.listeners) f(); },
  // Asks the browser to install it: answers whether it was.
  async install() {
    if (!this.prompt) return false;
    const p = this.prompt;
    this.prompt = null;
    p.prompt();
    const choice = await p.userChoice.catch(() => null);
    this.changed();
    return !!choice && choice.outcome === 'accepted';
  },
};

// An iPhone or iPad's Safari, which installs only from its Share menu.
export const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// The desktop app or the Android app: the game's files come with it.
export function native() {
  return location.protocol === 'app:' || !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

export function installOffline(params) {
  if (native() || params.has('test') || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    offline.prompt = e;
    offline.changed();
  });
  window.addEventListener('appinstalled', () => {
    offline.installed = true;
    offline.prompt = null;
    offline.changed();
  });
  // (a worker already in charge, replaced: a new version is kept, the page still the old one's)
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!had) return;
    offline.updated = true;
    offline.changed();
  });
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('no service worker', e));
}

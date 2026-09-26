// Online: when something goes wrong, say so, and keep what went wrong for a report.  An error in
// one of the game's scripts (the player carries on past it, as Flash did), an error in the page,
// or a promise that failed: each is noted -- its message, where it came from, and the state of
// the game at the time -- the last twenty kept in this browser, so that a report can still be
// made after the page has been closed.  A small notice says how many there have been and copies
// them all as text, for a bug report.  (In the console, copyErrorReport() does the same, and
// clearErrorReport() forgets them.)

const KEY = 'caconline.errors';
const MAX = 20;

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function save(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch (e) {
    // (private windows and full storage: kept for this page only)
  }
}

export class ErrorReporter {
  constructor(player) {
    this.player = player;
    this.list = load();
    this.seen = 0;                // noted since the page opened
    this.el = null;
    const own = player.onError;
    player.onError = (key, e) => {
      own(key, e);
      this.note('script ' + key, e);
    };
    addEventListener('error', (ev) => this.note('page', ev.error || ev.message, ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : ''));
    addEventListener('unhandledrejection', (ev) => this.note('promise', ev.reason));
    globalThis.copyErrorReport = () => this.copy();
    globalThis.clearErrorReport = () => this.clear();
  }

  note(where, e, at = '') {
    try {
      this.list.push({
        when: new Date().toISOString(),
        where,
        message: String((e && e.message) || e),
        stack: e && e.stack ? String(e.stack).split('\n').slice(0, 12).join('\n') : at,
        game: this.state(),
      });
      if (this.list.length > MAX) this.list.splice(0, this.list.length - MAX);
      save(this.list);
      this.seen++;
      this.show();
    } catch (err) {
      // (never let the reporting of an error be one)
    }
  }

  // What the game was doing: which map and mode, how far in, who was playing.
  state() {
    const p = this.player;
    const panel = p.levels[1] && p.levels[1].panel;
    const game = panel && panel.game;
    const level = game && game.level;
    const sk = panel && panel.skirmish;
    const s = { frame: p.frame, screen: panel ? panel.state : 'loading' };
    if (level) {
      s.level = level.skirmish ? 'skirmish' : level.level;
      s.count = level.count;
      s.units = level.units ? level.units.filter((u) => u && u.active).length : undefined;
      s.buildings = level.buildings ? level.buildings.filter((b) => b && b.active).length : undefined;
    }
    if (sk) {
      s.map = sk.map;
      s.mode = sk.mode;
      s.palette = sk.palette;
      s.players = (sk.players || []).map((q) => `${q.control}:${q.faction}:${q.colour}${q.difficulty ? ':' + q.difficulty : ''}`).join(' ');
    }
    return s;
  }

  report() {
    const lines = [`CrystAlien Conflict Online -- error report (${this.list.length})`, `page: ${location.href}`, `browser: ${navigator.userAgent}`, ''];
    for (const e of this.list) {
      lines.push(`${e.when}  ${e.where}`, `  ${e.message}`);
      if (e.stack) lines.push(e.stack.split('\n').map((l) => '    ' + l.trim()).join('\n'));
      lines.push('  game: ' + JSON.stringify(e.game), '');
    }
    return lines.join('\n');
  }

  async copy() {
    const text = this.report();
    try {
      await navigator.clipboard.writeText(text);
      return 'copied';
    } catch (e) {
      // (no clipboard: a window to copy it from)
      const w = open('', '_blank');
      if (w) {
        w.document.title = 'Error report';
        const pre = w.document.createElement('pre');
        pre.textContent = text;
        w.document.body.appendChild(pre);
      }
      return 'shown';
    }
  }

  clear() {
    this.list = [];
    this.seen = 0;
    save(this.list);
    if (this.el) this.el.remove();
    this.el = null;
  }

  show() {
    if (!this.el) {
      const el = this.el = document.createElement('div');
      el.className = 'errnote';
      el.innerHTML = '<span class="msg"></span> <button type="button" class="copy">Copy report</button> <button type="button" class="close" title="Dismiss">×</button>';
      el.querySelector('.copy').addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const how = await this.copy();
        el.querySelector('.copy').textContent = how === 'copied' ? 'Copied' : 'Copy report';
      });
      el.querySelector('.close').addEventListener('click', (ev) => {
        ev.stopPropagation();
        el.remove();
        this.el = null;
      });
      for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click', 'wheel']) el.addEventListener(t, (ev) => ev.stopPropagation());
      document.body.appendChild(el);
    }
    this.el.querySelector('.msg').textContent = this.seen === 1 ? 'Something went wrong.' : `Something went wrong (${this.seen} times).`;
    this.el.querySelector('.copy').textContent = 'Copy report';
  }
}

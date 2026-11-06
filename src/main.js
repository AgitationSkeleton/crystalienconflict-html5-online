// The page's equivalent of the original Launcher.html: play loader.swf with the parameters
// the launcher gave it, in a player that runs at the movie's 23 frames a second.  The
// loader, exactly as in the original, shows its PLAY button and pigeon game, then loads
// game.swf into _level1 and starts it.

import { Player } from './flash/player.js';
import { Library } from './flash/library.js';
import { OnlineUI } from './online/ui.js';
import { loadSettings, UI_SCALES, COLOUR_CSS } from './online/settings.js';
import { Bot } from './online/bot.js';
import { ErrorReporter } from './online/errors.js';
import { Net, serverRoot } from './online/net.js';
import { installTouch } from './online/touch.js';
import { scoreServer, askScoreName } from './hiscore.js';
import { american } from './online/spelling.js';
import { installOffline } from './online/offline.js';
import { checkAndroid, applyOrientation } from './online/android.js';

// serviceurl: the high-score server (src/hiscore.js), shared with the 1:1 port.  username: the
// game sends a finished Conflict run's score only for someone logged in to LEGO's site; here
// anyone may, and is asked for a name (their settings' name suggested) when a score is sent.
const FLASHVARS = { xmlurl: 'data/dialogue.xml', asseturl: '', serviceurl: scoreServer(new URLSearchParams(location.search)),
  gamename: 'CrystAlienConflict', username: 'player' };
const MOVIES = { 'game.swf': 'game' };     // loadMovieNum's file names -> converted movies
const FPS = 23;

const canvas = document.getElementById('stage');
let sizes = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('failed to load ' + src));
    document.head.appendChild(s);
  });
}

// Online: sidebar pictures the game never had, as library bitmaps under ids of their own -- the
// Alien Hive, and Santa's Sleigh, Santa and the Reindeer (tools/make_mugshots.py, from the
// pictures' sources).  And, for team-coloured icons (a player's setting), every picture drawn
// again from its sources' layers, its backdrop and the thing apart, each with the accent it is
// coloured by (data/mugshots.json): the game has them as Online.mugshots, by type.
const ICONS = { BK_evil: 990001, BJ_evil: 990002, UM_evil: 990003, UN_evil: 990004 };
async function loadIcons(lib) {
  // (and the buildings' repair sign, clip 1015 -- not exported -- for units mending in Hunt the Hero)
  if (lib.exports.onlineRepairing === undefined) lib.exports.onlineRepairing = 1015;
  const bitmap = async (id, path) => {
    const r = await fetch(path);
    if (r.ok) lib.bitmaps.set(id, await createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'default' }));
  };
  const table = await fetch('data/mugshots.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const jobs = Object.entries(ICONS).map(([type, id]) => bitmap(id, `assets/online/icons/${type}.png`));
  if (table) {
    const accents = {};
    for (const art of [...Object.values(table.backdrops), ...Object.values(table.pictures)]) {
      jobs.push(bitmap(art.id, `assets/online/mugshots/${art.file}`));
      if (art.accent) accents[art.id] = art.accent;
    }
    lib.mugshotAccents = accents;
    const types = {};
    for (const [type, t] of Object.entries(table.types)) types[type] = { picture: table.pictures[t.picture].id, backdrop: table.backdrops[t.backdrop].id };
    player.online.mugshots = types;
  }
  await Promise.all(jobs);
}

// A movie is its library (data + media) and its translated ActionScript.  The game's comes with
// the accents its art is painted in, for team colours (tools/team_accents.py).
function openMovie(name) {
  const lib = new Library(name, `assets/${name}/`);
  const ready = Promise.all([
    lib.load(`data/${name}.json`, sizes).then(() => (name === 'game' ? loadIcons(lib) : null)),
    globalThis.__scripts && globalThis.__scripts[name] ? null : loadScript(`src/scripts/${name}.js`),
    name === 'game' ? fetch('data/accents.json').then((r) => r.json()).then((a) => { lib.accents = a; }) : null,
  ]).then(() => {
    // (the sidebar pictures' accents with the rest: tools/make_mugshots.py)
    if (lib.mugshotAccents) lib.accents = Object.assign(lib.accents || {}, lib.mugshotAccents);
  });
  return { lib, ready };
}

const player = new Player(canvas, {
  flashVars: FLASHVARS,
  openMovie: (file) => (MOVIES[file] ? openMovie(MOVIES[file]) : null),
  scoreName: () => askScoreName(loadSettings().name),
});
globalThis.player = player;                // for the console and the verification harness
// The game's simulation, and random numbers that are not its (src/flash/player.js).
player.online.sim = (fn) => player.sim(fn);
player.online.fxRandom = (n) => {
  n = Math.trunc(+n);
  return n > 0 ? Math.floor(player.fxRandom() * n) : 0;
};
const errors = new ErrorReporter(player);  // (a notice, and a report to copy, when something goes wrong)
player.online.Bot = Bot;                   // the computer players (the game makes them)
player.online.icons = ICONS;
player.online.colourCss = COLOUR_CSS;       // the players' colours, for names in messages
// The game's text in the player's English (a setting: the game's dialogue asks, src/online/spelling.js).
player.online.spell = (text) => (player.online.prefs && player.online.prefs.english === 'american' ? american(text) : text);

// ?test stops the clock: frames advance only when __step() is called, so a test decides
// exactly when each click lands.  ?seed=N makes the random numbers repeatable.
const params = new URLSearchParams(location.search);
const TEST = params.has('test');
if (params.has('seed')) player.seedRandom(Number(params.get('seed')) || 0);
// ?glfilters: Flash-exact filters on the GPU even where WebGL is software-rendered.
if (params.has('glfilters')) player.renderer.forceGL = true;
globalThis.__step = (n = 1) => {
  for (let i = 0; i < n; i++) player.tick();
  player.draw();
  return player.frame;
};
// (__run() starts the clock after all, for timing the drawing as it is played: tools/verify/fps.py.)
globalThis.__run = () => requestAnimationFrame(loop);

// ---- the stage fills the window, of its shape, enlarged as far as the interface size allows --
// The game lays itself out across what it gets (Stage.width, height); the loader keeps its
// 600x400 and is centred.  (?test keeps the whole window to the game, as before.)
function setSize(size) {
  player.renderer.maxScale = TEST && !params.has('menus') ? Infinity : UI_SCALES[size] || UI_SCALES.medium;
}
// Online: upright on a phone, a match's stage may be narrower than the original's 600 (the
// sidebar and the view would otherwise be shrunk to fit a narrow screen); the menus keep theirs.
let fitChecked = 0;
function fitPortrait() {
  if (++fitChecked % 20) return;
  const g = player.levels[1];
  const inMatch = !!(g && g.panel && g.panel.game);
  const want = inMatch && innerHeight > innerWidth ? 420 : 600;
  if (player.renderer.minStageW !== want) {
    player.renderer.minStageW = want;
    resize();
  }
}
function resize() {
  const r = canvas.getBoundingClientRect();
  player.renderer.resize(r.width, r.height, window.devicePixelRatio || 1);
  centreLoader();
  player.draw();
}
function centreLoader() {
  const loader = player.levels[0];
  if (loader) {
    loader._x = Math.round((player.renderer.stageW - 600) / 2);
    loader._y = Math.round((player.renderer.stageH - 400) / 2);
  }
}
addEventListener('resize', resize);

// ---- input -----------------------------------------------------------------------------
function stagePoint(ev) {
  // (the mouse kept in the game: where the game's own pointer is, moved by the mouse's motion)
  if (locked) return [lockX, lockY];
  const r = canvas.getBoundingClientRect();
  const dpr = canvas.width / Math.max(1, r.width);
  return player.renderer.toStage((ev.clientX - r.left) * dpr, (ev.clientY - r.top) * dpr);
}

// (Online: the game reads the button once a frame, so a click's release waits until the game
// has had two frames to see the press: a touchpad's tap can be quicker than a frame.  Touch has
// its own handling, src/online/touch.js, which comes first.)
let pressedAt = 0;
let pendingUp = null;
function releaseWhenSeen() {
  if (pendingUp && player.frame >= pressedAt + 2) {
    player.pointerUp(pendingUp[0], pendingUp[1]);
    pendingUp = null;
  }
}
canvas.addEventListener('pointermove', (ev) => {
  if (ev.pointerType === 'mouse') touchMode(false);
  // (out of a match the mouse is let go: the menus need the browser's pointer)
  keepLock();
  if (locked) {
    // (the mouse's motion, in the stage's units, and the pointer kept on the stage)
    const r = canvas.getBoundingClientRect();
    const k = canvas.width / Math.max(1, r.width) / player.renderer.scale;
    lockX = Math.max(0, Math.min(player.renderer.stageW - 1, lockX + ev.movementX * k));
    lockY = Math.max(0, Math.min(player.renderer.stageH - 1, lockY + ev.movementY * k));
    player.pointerMove(lockX, lockY);
    return;
  }
  const [x, y] = stagePoint(ev);
  lastX = x;
  lastY = y;
  player.pointerMove(x, y);
});
// ---- the mouse in a match, as in C&C (the player's settings; neither is on to begin with) -------
// A browser lets the pointer go out of its window, past the edge that scrolls the view.  Either it
// is kept in -- "Keep the Mouse in the Game": the browser's Pointer Lock, from a click on the map
// in a match; the game draws its own pointer, moved by the mouse's motion and held on the stage,
// so it can be pushed at an edge; Esc (the browser's) lets it go, and it goes by itself out of a
// match -- or, gone out over an edge ("Scroll Past the Window's Edge"), the game is told it is at
// that edge, and the view scrolls that way until it comes back.
let locked = false, lockX = 0, lockY = 0, lastX = 0, lastY = 0;
const prefs = () => player.online.prefs || {};
const wantLock = () => !!prefs().mouseLock && !touching && inMatch();
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) { lockX = lastX; lockY = lastY; }
});
function keepLock() {
  if (locked && !wantLock()) document.exitPointerLock();
}
canvas.addEventListener('pointerleave', (ev) => {
  if (ev.pointerType !== 'mouse' || locked || !prefs().edgeLeave || !inMatch() || player.mouseDown) return;
  const level = player.levels[1].panel.game.level;
  const r = canvas.getBoundingClientRect();
  let [x, y] = stagePoint(ev);
  // (the map's edges: the sidebar is at the left, and the view may end above the stage's foot)
  const left = (player.levels[1].SIDEBAR || 150) + 2, right = player.renderer.stageW - 2;
  const top = 2, bottom = ((level.arena && level.arena.viewHeightPx) || player.renderer.stageH) - 2;
  if (ev.clientX <= r.left + 1) x = left;
  else if (ev.clientX >= r.right - 1) x = right;
  if (ev.clientY <= r.top + 1) y = top;
  else if (ev.clientY >= r.bottom - 1) y = bottom;
  if (x === left || x === right || y === top || y === bottom) player.pointerMove(x, y);
});
canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0) return;             // Flash only ever saw the left button
  if (!locked && ev.pointerType === 'mouse' && wantLock() && canvas.requestPointerLock) {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  }
  canvas.focus();
  // (a drag that leaves the stage still ends here -- unless the mouse is kept in the game, which
  // does that already, and where the browser refuses it)
  try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* (kept in) */ }
  if (pendingUp) player.pointerUp(pendingUp[0], pendingUp[1]);
  pendingUp = null;
  const [x, y] = stagePoint(ev);
  player.pointerDown(x, y);
  pressedAt = player.frame;
  ev.preventDefault();
});
canvas.addEventListener('pointerup', (ev) => {
  if (ev.button !== 0) return;
  const [x, y] = stagePoint(ev);
  pendingUp = [x, y];
  if (!TEST) releaseWhenSeen();
  else { player.pointerUp(x, y); pendingUp = null; }
});
// Touch (online): taps, drags, pinches, and buttons for the keys a touch screen lacks.  In touch
// mode the game's pointer is not drawn and the view does not scroll at the screen's edges.
let touching = false;
function touchMode(on) {
  if (touching === on) return;
  touching = on;
  player.online.touch = on;
  player.renderer.hidePointer = on;
}
const touch = installTouch({ player, canvas, stagePoint, onTouchMode: touchMode });
canvas.addEventListener('pointercancel', (ev) => {
  const [x, y] = stagePoint(ev);
  if (player.mouseDown) player.pointerUp(x, y);
});
// The middle and right buttons only ever reached the game as key codes (the game uses the
// middle one to deselect; online, the right one too).  Middle-clicking must not start the
// browser's autoscroll.
// (Online: over the map in a match, either held and dragged moves the view, as C&C's does --
// the map follows the pointer; let go without dragging, it is the click it was, given then and
// held for two of the game's frames so that the game sees it.)
const DRAG_VIEW = 6;                       // CSS pixels a held button moves before it drags
let heldButton = null;                     // {button, x, y, dragging}
const inMatch = () => {
  const g = player.levels[1];
  return !!(g && g.panel && g.panel.game && g.panel.game.level);
};
function clickButton(button) {
  player.mouseButton(button, true);
  const at = player.frame + 2;
  const up = () => {
    if (player.frame >= at) player.mouseButton(button, false);
    else requestAnimationFrame(up);
  };
  requestAnimationFrame(up);
}
canvas.addEventListener('mousedown', (ev) => {
  if (ev.button === 0) return;
  ev.preventDefault();
  if ((ev.button === 1 || ev.button === 2) && inMatch() && stagePoint(ev)[0] >= 150) {
    heldButton = { button: ev.button, x: ev.clientX, y: ev.clientY, dragging: false };
    return;
  }
  player.mouseButton(ev.button, true);
});
addEventListener('mousemove', (ev) => {
  const h = heldButton;
  if (!h) return;
  // (with the mouse kept in the game the pointer does not move on the screen: its motion, then)
  if (locked) { h.mx = (h.mx || 0) + ev.movementX; h.my = (h.my || 0) + ev.movementY; }
  const dx = locked ? h.mx : ev.clientX - h.x, dy = locked ? h.my : ev.clientY - h.y;
  if (!h.dragging && Math.hypot(dx, dy) < DRAG_VIEW) return;
  h.dragging = true;
  touch.panBy(dx, dy);
  if (locked) { h.mx = 0; h.my = 0; }
  h.x = ev.clientX;
  h.y = ev.clientY;
});
addEventListener('mouseup', (ev) => {
  if (ev.button === 0) return;
  const h = heldButton;
  if (h && h.button === ev.button) {
    heldButton = null;
    if (!h.dragging) clickButton(ev.button);
    return;
  }
  player.mouseButton(ev.button, false);
});
canvas.addEventListener('auxclick', (ev) => ev.preventDefault());
// The original replaced Flash's right-click menu with a single "www.lego.com" item; here
// right-click does nothing rather than show the browser's menu over the game.
canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
// Flash on Windows reported wheel movement in lines, three per notch, up positive.  A
// mouse wheel sends one event per notch; a touchpad sends a stream of small ones, which
// add up to a notch every 100 pixels so that it zooms at a similar rate.
let wheelPixels = 0;
canvas.addEventListener('wheel', (ev) => {
  const px = ev.deltaY * (ev.deltaMode === 1 ? 33 : ev.deltaMode === 2 ? 400 : 1);
  if (Math.abs(px) >= 40) {
    wheelPixels = 0;
    player.wheel(px < 0 ? 3 : -3);
  } else {
    wheelPixels += px;
    if (Math.abs(wheelPixels) >= 100) {
      player.wheel(wheelPixels < 0 ? 3 : -3);
      wheelPixels = 0;
    }
  }
  ev.preventDefault();
}, { passive: false });

// The game traps every key (fscommand trapallkeys); browser shortcuts still work, and so
// does typing into the menus.
function trapped(ev) {
  return !(ev.ctrlKey || ev.metaKey || ev.altKey || /^F\d+$/.test(ev.key));
}
function inMenus(ev) {
  const t = ev.target;
  return t && t !== canvas && t !== document.body && t.closest && t.closest('.ui, .ui-back');
}
// Control groups with C&C's keys (the player's settings): Ctrl (Cmd) and a number makes the
// selection a group, the number picks it, Shift and the number adds it, Alt and the number -- or
// the number twice -- picks it and goes to it.  Read here, and kept from the browser (whose own
// are Ctrl and Alt with a number), for the game's next frame (Control.doGroups).
function groupKey(ev) {
  if (prefs().groupKeys !== 'cnc' || !inMatch()) return false;
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(ev.code || '');
  if (!m) return false;
  ev.preventDefault();
  if (!ev.repeat) {
    (player.online.groupPresses = player.online.groupPresses || []).push({ n: Number(m[1]), assign: ev.ctrlKey || ev.metaKey,
      add: ev.shiftKey && !(ev.ctrlKey || ev.metaKey), centre: ev.altKey });
  }
  return true;
}
addEventListener('keydown', (ev) => {
  if (inMenus(ev)) return;
  if (groupKey(ev)) return;
  if (!trapped(ev)) return;
  player.keyDown(ev);
  ev.preventDefault();
});
addEventListener('keyup', (ev) => {
  if (inMenus(ev)) return;
  player.keyUp(ev);
  if (trapped(ev)) ev.preventDefault();
});
// Keys and buttons held when the window loses focus would otherwise stay down forever.
addEventListener('blur', () => {
  for (const code of [...player.keys]) player.keyUp({ keyCode: code, key: '' });
});

// ---- the frame loop ----------------------------------------------------------------------
// Fixed 23fps steps (times the game speed a skirmish chose).  Flash never skipped a frame's
// logic; after a long stall (a hidden tab) this resumes rather than racing to catch up.
let STEP = 1000 / FPS;
let last = 0;
let acc = 0;
let drawn = null;
function loop(now) {
  // (The next one asked for first: an error in a frame must not stop the game.)
  requestAnimationFrame(loop);
  releaseWhenSeen();
  keepLock();
  touch.frame(touching);
  fitPortrait();
  advance(now);
  // Drawn at every refresh of the screen, what moved part of the way to where the next frame
  // will have it, so that it moves smoothly however often the screen refreshes; the game keeps
  // its own frames.  (Not drawn again when nothing has changed: no frame since, nothing on its
  // way anywhere, and the mouse where it was.)
  // (Online: a computer that cannot draw that often in time -- its drawings slow, on average --
  // draws only the game's own frames, 23 a second as the original did, until it can again: what
  // moves is not drawn on its way between them.  The time goes to the game, and to the sound.)
  const alpha = acc / STEP;
  const smooth = !light && player.lastMove === player.frame;
  const state = player.frame + '|' + (smooth ? alpha : '') + '|' + player.mouse;
  if (state !== drawn) {
    drawn = state;
    const t0 = performance.now();
    player.draw(light ? 1 : alpha);
    drawAvg = drawAvg * 0.9 + (performance.now() - t0) * 0.1;
    if (!light && drawAvg > LIGHT_ABOVE) light = true;
    else if (light && drawAvg < LIGHT_BELOW) light = false;
  }
}
// (milliseconds a drawing takes, on average, over which only the game's frames are drawn, and
// under which every refresh is again)
const LIGHT_ABOVE = 10, LIGHT_BELOW = 5;
let drawAvg = 0, light = false;

// The game's frames due by `now`.
function advance(now) {
  if (last) acc += Math.min(now - last, STEP * 4);
  last = now;
  // Over the network (src/online/net.js), a turn is run only when everyone's orders for it are
  // here; and a page behind the others runs extra frames, a few milliseconds' worth a refresh
  // (more when far behind: joining a match under way), until it has caught up.
  const net = player.online.net && player.online.net.active ? player.online.net : null;
  while (acc >= STEP) {
    if (net && !net.ready()) {
      acc = Math.min(acc, STEP);
      break;
    }
    acc -= STEP;
    if (net) net.beforeTick();
    player.tick();
  }
  if (net) {
    const t0 = performance.now();
    const budget = net.behind() > 60 ? 40 : 8;
    while (net.active && net.behind() > net.slack() && net.ready() && performance.now() - t0 < budget) {
      net.beforeTick();
      player.tick();
    }
  }
}

// A hidden page (alt-tabbed away from, another window over it, minimized) has no animation
// frames.  Alone, the game waits for it; but in a match online the others play on, and it
// would come back far behind, to seconds of catching up at a few frames a second.  So while
// hidden in a match, its frames go on from a worker's clock (a hidden page's own timers are
// slowed to once a second; a worker's are not), and nothing is drawn.
let hiddenClock = null;
function watchHidden() {
  const hidden = document.visibilityState === 'hidden';
  if (hidden && !hiddenClock) {
    try {
      const src = 'let t = null; onmessage = (e) => { clearInterval(t); t = e.data ? setInterval(() => postMessage(0), e.data) : null; };';
      hiddenClock = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      hiddenClock.onmessage = () => {
        if (document.visibilityState === 'hidden' && player.online.net && player.online.net.active) advance(performance.now());
      };
    } catch (e) {
      hiddenClock = false;      // (no workers here: as before, it catches up when shown)
    }
  }
  if (hiddenClock) hiddenClock.postMessage(hidden ? 25 : 0);
}
document.addEventListener('visibilitychange', watchHidden);

// ---- start ---------------------------------------------------------------------------------
// Online: the skirmish maps made from other games' (tools/convert_maps.py), for the game to
// play and the menus to list.  None is fine: Eclipse is the game's own.
async function loadMaps() {
  const maps = {};
  try {
    const index = await fetch('data/maps/index.json').then((r) => (r.ok ? r.json() : []));
    await Promise.all(index.map(async (m) => {
      const r = await fetch(`data/maps/${m.id}.json`);
      if (r.ok) maps[m.id] = await r.json();
    }));
  } catch (e) {
    console.warn('no skirmish maps', e);
  }
  player.online.maps = maps;
}

async function start() {
  // (installed as a web app, it plays offline; the Android app looks for a newer version)
  installOffline(params);
  checkAndroid();
  applyOrientation(loadSettings().orientation);
  sizes = await fetch('data/sizes.json').then((r) => r.json());
  await loadMaps();
  const loader = openMovie('loader');
  await loader.ready;
  setSize(loadSettings().size);
  resize();
  await player.loadLevel(0, loader.lib);
  centreLoader();
  player.draw();
  if (!TEST) requestAnimationFrame(loop);
  // Online play: the master server and match rooms (src/online/net.js; ?server=URL for another).
  const net = new Net(player, serverRoot(params));
  // Online: the menus, over the game once it has loaded (?test keeps the game's own, for the
  // regression scenarios, unless ?menus asks for them).
  const ui = new OnlineUI(player, { setSpeed: (f) => { STEP = 1000 / (FPS * (f || 1)); }, setSize: (s) => { setSize(s); resize(); }, net });
  globalThis.onlineUI = ui;
  if (!TEST || params.has('menus')) {
    const waitForGame = () => {
      const g = player.levels[1];
      if (g && g.panel) ui.attach();
      else setTimeout(waitForGame, 100);
    };
    waitForGame();
  }
}

start().catch((e) => {
  console.error(e);
  document.body.setAttribute('data-error', String(e && e.message || e));
  const note = document.createElement('p');
  note.className = 'failed';
  note.textContent = 'CrystAlien Conflict could not load. Check your connection and reload the page.';
  document.body.appendChild(note);
});

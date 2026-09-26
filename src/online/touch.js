// Online: playing on a touch screen.  The game was made for a mouse, and reads its button once a
// frame; on a touch screen:
//
//   a tap                      is a click (held down for two of the game's frames, so that the
//                              game sees it: a tap can be quicker than a frame)
//   a double tap               is a double click (deselects, as with a mouse)
//   tap, then touch and drag   draws a selection box, as dragging the mouse does (the second
//                              touch cancels what the first tap would have ordered)
//   press, hold, then drag     draws a selection box too
//   a drag on the map          moves the view
//   a drag on the sidebar      scrolls the list it starts on
//   a long press on the sidebar  is a right-click there (with the host's Unit queue, it takes
//                              one of a unit off)
//   two fingers                pinch to zoom (about the fingers), drag to move the view
//   placing a building         a touch puts it there (drag it about); a tap on it builds it
//
// and a few buttons stand in for the keys and buttons a touch screen lacks: Deselect (the right
// button, or Space), Home (H: the headquarters) and Menu (Esc).  While touch is in use the game's
// own pointer is not drawn, the view does not scroll at the screen's edges, and once a tap has
// been dealt with the pointer is put out of the way (a mouse would move on; a finger leaves it
// where it was, and whatever it rested on would stay lit).

const TAP_MOVE = 10;             // CSS pixels a finger may wander and still tap
const HOLD_MS = 420;             // a press held this long, still, starts a selection box
const DOUBLE_MS = 300;           // a second touch this soon after a tap ...
const DOUBLE_NEAR = 40;          // ... and this near it (CSS pixels) is the second of a double tap
const SITE_NEAR = 28;            // a tap this near a building being placed builds it
const PINCH_STEP = 1.18;         // how far fingers spread for one step of the wheel
const SIDEBAR = 150;             // the sidebar's width, in stage units
const AWAY = -1000;              // where the pointer is put out of the way
const STILL_WAITING = 1e6;       // the game's count of frames left for a second click, held open

export function installTouch({ player, canvas, stagePoint, onTouchMode }) {
  let gesture = null;
  const fingers = new Map();
  let release = null;             // a click's release, waiting for the game to have seen the press
  let down = null;                // a press, waiting for the game to be ready for it
  let downAfter = -1;             // ... after this frame
  let park = null;                // when to put the pointer out of the way
  let right = null;               // a right-click: {down: after this frame, up: at this one}
  let lastTap = null;             // the last tap on the map, for double taps

  const level = () => {
    const g = player.levels[1];
    const game = g && g.panel && g.panel.game;
    return game && game.level;
  };
  const inMatch = () => !!level();
  const control = () => level() && level().control;
  const placing = () => !!(level() && level().construction && level().construction.buildingSite);

  // CSS pixels for a stage unit.
  const scale = () => {
    const r = canvas.getBoundingClientRect();
    return player.renderer.scale / (canvas.width / Math.max(1, r.width));
  };

  // The press and its release, the release no sooner than two of the game's frames later.  The
  // press waits a frame for the game to have seen the pointer where it is (a finger, unlike a
  // mouse, arrives without having hovered: the sidebar takes a click on what it lit the frame
  // before) and the last release (pressed again in the frame it was let go, the button would
  // not have gone up).  Returns the frame the press is given in.
  const press = (pt) => {
    park = null;
    if (release) {
      player.pointerUp(release.pt[0], release.pt[1]);
      release = null;
      downAfter = player.frame;
    }
    if (player.mouse[0] !== pt[0] || player.mouse[1] !== pt[1]) {
      player.pointerMove(pt[0], pt[1]);
      downAfter = player.frame;
    }
    down = pt;
    flush();
    return Math.max(player.frame, downAfter + 1);
  };
  const letGo = (pt, pressed) => {
    player.pointerMove(pt[0], pt[1]);
    release = { pt, at: pressed + 2 };
    flush();
  };
  const flush = () => {
    // (a right-click: the button down once the game has seen the pointer where it is, and up
    // two frames later)
    if (right && right.up === null && player.frame > right.down) {
      player.mouseButton(2, true);
      right.up = player.frame + 2;
    } else if (right && right.up !== null && player.frame >= right.up) {
      player.mouseButton(2, false);
      right = null;
      park = { at: player.frame + 2 };
    }
    if (down && player.frame > downAfter) {
      player.pointerDown(down[0], down[1]);
      down = null;
    }
    if (release && !down && player.frame >= release.at) {
      player.pointerUp(release.pt[0], release.pt[1]);
      release = null;
      downAfter = player.frame;
      park = { at: player.frame + 2 };
    }
    // (out of the way once the game has dealt with the release: not while a finger is down,
    // nor while a building is being placed, which follows the pointer)
    if (park && player.frame >= park.at) {
      park = null;
      if (!gesture && !release && !down && !right && !placing()) player.pointerMove(AWAY, AWAY);
    }
  };

  // The view: moved by a drag of so many stage units (the camera's own units: its height is
  // counted twice, as the game draws the ground).
  const pan = (dx, dy) => {
    const lv = level();
    const cam = lv && lv.camera;
    if (!cam) return;
    const zoom = (lv.arena && lv.arena.zoom) || 1;
    cam.focus = false;
    cam.dx = cam.dy = 0;
    cam.posX -= dx / zoom;
    cam.posY -= (2 * dy) / zoom;
  };

  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType !== 'touch') return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    canvas.setPointerCapture(ev.pointerId);
    onTouchMode(true);
    player.sound.unlock();
    fingers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (fingers.size === 1) {
      const pt = stagePoint(ev);
      const now = performance.now();
      const g = gesture = { id: ev.pointerId, mode: 'wait', x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY, pt, sidebar: pt[0] < SIDEBAR, listPixels: 0 };
      if (!inMatch()) return;
      if (g.sidebar) {
        // Held still on the sidebar: a right-click there.
        g.hold = setTimeout(() => {
          if (gesture !== g || g.mode !== 'wait') return;
          g.mode = 'held';
          park = null;
          player.pointerMove(g.pt[0], g.pt[1]);
          right = { down: player.frame, up: null };
          if (navigator.vibrate) navigator.vibrate(12);
        }, HOLD_MS);
        return;
      }
      if (placing()) {
        // A building being placed: this touch puts it here (a drag moves it about); a tap on
        // it, where it already is, builds it.
        const at = player.mouse;
        g.mode = 'site';
        g.confirm = !!at && Math.hypot(pt[0] - at[0], pt[1] - at[1]) * scale() < SITE_NEAR;
        if (!g.confirm) player.pointerMove(pt[0], pt[1]);
        return;
      }
      if (lastTap && now - lastTap.t < DOUBLE_MS && Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < DOUBLE_NEAR) {
        // The second touch of a double tap: pressed now.  What the first tap would have ordered
        // (the game waits a moment for a second click) is called off, and the game kept
        // waiting while this touch is down: lifted where it is, it is a double click; dragged,
        // a selection box.
        lastTap = null;
        const c = control();
        if (c) {
          c.singleClick = false;
          c.dblClickCount = STILL_WAITING;
        }
        g.mode = 'box';
        g.pressed = press(pt);
        return;
      }
      // Held still for a moment: a selection box, from here.
      g.hold = setTimeout(() => {
        if (gesture !== g || g.mode !== 'wait') return;
        g.mode = 'box';
        g.pressed = press(g.pt);
        if (navigator.vibrate) navigator.vibrate(12);
      }, HOLD_MS);
    } else if (fingers.size === 2) {
      // A second finger: pinch and pan, whatever the first was doing.  (A building being
      // placed goes back where it was after, not between the fingers, where the zoom put it.)
      if (gesture && gesture.mode === 'box') letGo(gesture.pt, gesture.pressed);
      if (gesture) clearTimeout(gesture.hold);
      const [a, b] = [...fingers.values()];
      const back = placing() ? player.mouse.slice() : null;
      gesture = { mode: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, steps: 0, back };
    }
  }, true);

  canvas.addEventListener('pointermove', (ev) => {
    if (ev.pointerType !== 'touch') return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    const f = fingers.get(ev.pointerId);
    if (!f) return;
    f.x = ev.clientX;
    f.y = ev.clientY;
    const g = gesture;
    if (!g) return;
    if (g.mode === 'pinch') {
      if (fingers.size < 2) return;
      const [a, b] = [...fingers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const k = scale();
      pan((mx - g.mx) / k, (my - g.my) / k);
      g.mx = mx;
      g.my = my;
      const want = Math.round(Math.log(d / g.d) / Math.log(PINCH_STEP));
      if (want !== g.steps) {
        // (the game zooms about the pointer, and over the sidebar would scroll a list instead:
        // the pointer goes between the fingers, on the map)
        const [sx, sy] = stagePoint({ clientX: mx, clientY: my });
        player.pointerMove(Math.max(SIDEBAR + 2, sx), sy);
        while (g.steps < want) { player.wheel(3); g.steps++; }
        while (g.steps > want) { player.wheel(-3); g.steps--; }
      }
      return;
    }
    if (ev.pointerId !== g.id) return;
    const pt = stagePoint(ev);
    const moved = Math.hypot(ev.clientX - g.x0, ev.clientY - g.y0) > TAP_MOVE;
    if (g.mode === 'wait' && moved) {
      clearTimeout(g.hold);
      g.mode = g.sidebar ? 'list' : 'pan';
      if (g.mode === 'list') player.pointerMove(g.pt[0], g.pt[1]);
    }
    if (g.mode === 'pan') {
      const k = scale();
      pan((ev.clientX - g.x) / k, (ev.clientY - g.y) / k);
    } else if (g.mode === 'list') {
      // (the sidebar's lists scroll as for the wheel, a step for every 36 pixels)
      g.listPixels += ev.clientY - g.y;
      while (g.listPixels >= 36) { player.wheel(3); g.listPixels -= 36; }
      while (g.listPixels <= -36) { player.wheel(-3); g.listPixels += 36; }
    } else if (g.mode === 'box') {
      // (dragged, the second touch of a double tap is a drag, not a double click)
      // (and the pointer stays where the box begins until the game has the press)
      const c = control();
      if (moved && c) c.dblClickCount = 0;
      if (!down) player.pointerMove(pt[0], pt[1]);
    } else if (g.mode === 'site') {
      if (moved) g.confirm = false;
      if (!g.confirm) player.pointerMove(pt[0], pt[1]);
    }
    g.x = ev.clientX;
    g.y = ev.clientY;
    g.pt = pt;
  }, true);

  const end = (ev) => {
    if (ev.pointerType !== 'touch') return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    fingers.delete(ev.pointerId);
    const g = gesture;
    if (!g) return;
    if (g.mode === 'pinch') {
      if (fingers.size === 0) {
        gesture = null;
        if (g.back && placing()) player.pointerMove(g.back[0], g.back[1]);
        park = { at: player.frame };
      }
      return;
    }
    if (ev.pointerId !== g.id) return;
    clearTimeout(g.hold);
    gesture = null;
    if (ev.type !== 'pointerup') {
      if (g.mode === 'box') letGo(g.pt, g.pressed);
      return;
    }
    if (g.mode === 'wait') {
      letGo(g.pt, press(g.pt));
      lastTap = g.sidebar ? null : { t: performance.now(), x: ev.clientX, y: ev.clientY };
    } else if (g.mode === 'box') {
      letGo(stagePoint(ev), g.pressed);
    } else if (g.mode === 'site' && g.confirm) {
      const at = player.mouse ? [player.mouse[0], player.mouse[1]] : g.pt;
      letGo(at, press(at));
    } else if (g.mode !== 'site' && g.mode !== 'held') {
      park = { at: player.frame };
    }
  };
  canvas.addEventListener('pointerup', end, true);
  canvas.addEventListener('pointercancel', end, true);

  // Touch's stand-ins for keys: a key held for two of the game's frames.
  const tapKey = (code) => {
    player.keyDown({ keyCode: code, key: code === 32 ? ' ' : '' });
    const at = player.frame + 2;
    const up = () => {
      if (player.frame >= at) player.keyUp({ keyCode: code, key: '' });
      else requestAnimationFrame(up);
    };
    requestAnimationFrame(up);
  };
  const bar = document.createElement('div');
  bar.className = 'touchbar';
  for (const [label, code, title] of [['✕', 32, 'Deselect'], ['⌂', 72, 'Home'], ['≡', 27, 'Menu']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); tapKey(code); });
    bar.appendChild(b);
  }
  document.body.appendChild(bar);
  // (iOS's own pinch zooms the whole page, whatever the canvas says)
  for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false });

  return {
    // each refresh: a release waiting on the game; the pointer out of the way; the buttons while
    // a match is on; and a double tap's allowance (the game's, in frames, a little longer).
    frame(touchMode) {
      flush();
      const c = control();
      if (c) c.sensitivity = touchMode ? 7 : 5;
      bar.classList.toggle('shown', !!(touchMode && inMatch() && !(level() && level().spectating)));
    },
  };
}

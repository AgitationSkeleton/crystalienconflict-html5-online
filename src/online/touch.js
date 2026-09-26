// Online: playing on a touch screen.  The game was made for a mouse, and reads its button once a
// frame; on a touch screen:
//
//   a tap                      is a click (held down for two of the game's frames, so that the
//                              game sees it: a tap can be quicker than a frame)
//   a drag on the map          moves the view
//   press, hold, then drag     draws a selection box, as dragging the mouse does
//   a drag on the sidebar      scrolls the list it starts on
//   two fingers                pinch to zoom, drag to move the view
//
// and a few buttons stand in for the keys and buttons a touch screen lacks: Deselect (the right
// button, or Space), Home (H: the headquarters) and Menu (Esc).  While touch is in use the game's
// own pointer is not drawn and the view does not scroll at the screen's edges.

const TAP_MOVE = 10;             // CSS pixels a finger may wander and still tap
const HOLD_MS = 420;             // a press held this long, still, starts a selection box
const PINCH_STEP = 1.18;         // how far fingers spread for one step of the wheel

export function installTouch({ player, canvas, stagePoint, onTouchMode }) {
  let gesture = null;
  const fingers = new Map();
  let release = null;             // a click's release, waiting for the game to have seen the press

  const level = () => {
    const g = player.levels[1];
    const game = g && g.panel && g.panel.game;
    return game && game.level;
  };
  const inMatch = () => !!level();

  // The press and its release, the release no sooner than two of the game's frames later.
  const press = (pt) => {
    player.pointerMove(pt[0], pt[1]);
    player.pointerDown(pt[0], pt[1]);
    release = null;
    return player.frame;
  };
  const letGo = (pt, pressed) => {
    player.pointerMove(pt[0], pt[1]);
    release = { pt, at: pressed + 2 };
    flush();
  };
  const flush = () => {
    if (release && player.frame >= release.at) {
      player.pointerUp(release.pt[0], release.pt[1]);
      release = null;
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

  const scale = () => {
    const r = canvas.getBoundingClientRect();
    return player.renderer.scale / (canvas.width / Math.max(1, r.width));
  };
  const onSidebar = (pt) => pt[0] < 150;

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
      gesture = { id: ev.pointerId, mode: 'wait', x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY, pt, sidebar: onSidebar(pt), listPixels: 0 };
      // Held still for a moment on the map: a selection box, from here.
      if (!gesture.sidebar && inMatch()) {
        const g = gesture;
        g.hold = setTimeout(() => {
          if (gesture !== g || g.mode !== 'wait') return;
          g.mode = 'box';
          g.pressed = press(g.pt);
          if (navigator.vibrate) navigator.vibrate(12);
        }, HOLD_MS);
      }
    } else if (fingers.size === 2) {
      // A second finger: pinch and pan, whatever the first was doing.
      if (gesture && gesture.mode === 'box') letGo(gesture.pt, gesture.pressed);
      if (gesture) clearTimeout(gesture.hold);
      const [a, b] = [...fingers.values()];
      gesture = { mode: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, steps: 0 };
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
      while (g.steps < want) { player.wheel(3); g.steps++; }
      while (g.steps > want) { player.wheel(-3); g.steps--; }
      return;
    }
    if (ev.pointerId !== g.id) return;
    const pt = stagePoint(ev);
    if (g.mode === 'wait' && Math.hypot(ev.clientX - g.x0, ev.clientY - g.y0) > TAP_MOVE) {
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
      player.pointerMove(pt[0], pt[1]);
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
      if (fingers.size === 0) gesture = null;
      return;
    }
    if (ev.pointerId !== g.id) return;
    clearTimeout(g.hold);
    if (g.mode === 'wait' && ev.type === 'pointerup') letGo(g.pt, press(g.pt));
    else if (g.mode === 'box') letGo(stagePoint(ev), g.pressed);
    gesture = null;
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

  return {
    // each refresh: a release waiting on the game; the buttons while a match is on
    frame(touchMode) {
      flush();
      bar.classList.toggle('shown', !!(touchMode && inMatch() && !(level() && level().spectating)));
    },
  };
}

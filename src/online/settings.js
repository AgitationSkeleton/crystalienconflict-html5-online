// The player's settings, kept in the browser: who they are, what they like to play as, and
// how loud things are.  Storage can be missing or refuse (a private window, blocked site
// data); then the settings last for the visit.

const KEY = 'cac-online:settings';

export const COLOURS = ['orange', 'green', 'red', 'blue', 'purple', 'black', 'tan', 'cyan'];

// The colours as the menus show them (the game's art is recoloured by hue; see
// TEAM_COLOURS in src/flash/render.js).
export const COLOUR_CSS = {
  orange: '#ff8a00', green: '#6fd12a', red: '#e0201c', blue: '#2a6fe8',
  purple: '#9a3ee0', black: '#303030', tan: '#d2b48c', cyan: '#20d0e0',
};

// How far the game may be enlarged to fill the window, in CSS pixels to one of the stage's
// units (the original's 600x400): beyond that a bigger window shows more of the map and a
// taller sidebar instead.  'fill' enlarges it all the way.
export const UI_SCALES = { small: 1.5, medium: 2, large: 2.5, fill: Infinity };

export const DEFAULTS = {
  name: 'Player',
  faction: 'good',          // 'good' (Astro), 'evil' (Alien) or 'random'
  colour: 'orange',
  palette: 'all',           // 'all' (as the host chose), 'mars' or 'snowy'
  music: 0.8,
  sound: 0.9,
  ui: 0.9,
  size: 'medium',           // the interface size: a key of UI_SCALES
  lobby: null,              // the last skirmish set up, to start from next time
};

export function loadSettings() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch (e) {
    saved = null;
  }
  const s = Object.assign({}, DEFAULTS, saved && typeof saved === 'object' ? saved : {});
  if (typeof s.name !== 'string' || !s.name.trim()) s.name = DEFAULTS.name;
  s.name = s.name.slice(0, 16);
  if (!['good', 'evil', 'random'].includes(s.faction)) s.faction = DEFAULTS.faction;
  if (!COLOURS.includes(s.colour)) s.colour = DEFAULTS.colour;
  if (!['all', 'mars', 'snowy'].includes(s.palette)) s.palette = DEFAULTS.palette;
  if (!(s.size in UI_SCALES)) s.size = DEFAULTS.size;
  for (const k of ['music', 'sound', 'ui']) {
    const v = Number(s[k]);
    s[k] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULTS[k];
  }
  return s;
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (e) {
    // Not kept; it still applies for this visit.
  }
}

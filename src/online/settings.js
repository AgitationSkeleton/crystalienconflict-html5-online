// The player's settings, kept in the browser: who they are, what they like to play as, and
// how loud things are.  Storage can be missing or refuse (a private window, blocked site
// data); then the settings last for the visit.

const KEY = 'cac-online:settings';

export const COLOURS = ['orange', 'green', 'red', 'blue', 'purple', 'black', 'tan', 'cyan', 'yellow'];

// The colours as the menus show them (the game's art is recoloured by hue; see
// TEAM_COLOURS in src/flash/render.js).
export const COLOUR_CSS = {
  orange: '#ff8a00', green: '#6fd12a', red: '#e0201c', blue: '#2a6fe8',
  purple: '#9a3ee0', black: '#303030', tan: '#d2b48c', cyan: '#20d0e0', yellow: '#f5d312',
};

// How far the game may be enlarged to fill the window, in CSS pixels to one of the stage's
// units (the original's 600x400): beyond that a bigger window shows more of the map and a
// taller sidebar instead.  'fill' enlarges it all the way.
export const UI_SCALES = { small: 1.5, medium: 2, large: 2.5, fill: Infinity };

// The map palettes: the original's Mars, its snow, the Hive (see the game's Arena.doHive) and
// the LEGO Battles worlds, as the DS game colours them and as its FactionWars mod does (Arena.doLego).
export const PALETTES = [['mars', 'Mars'], ['snowy', 'Snowy'], ['hive', 'Hive'],
  ['lb-mars', 'Battles: Mars'], ['lb-castle', 'Battles: Castle'], ['lb-pirate', 'Battles: Pirate'],
  ['lb-mars-fw', 'Battles: Mars (FactionWars)'], ['lb-castle-fw', 'Battles: Castle (FactionWars)'], ['lb-pirate-fw', 'Battles: Pirate (FactionWars)']];

// Random Mars: the Mars-like ones only -- the original's, its snow, the Hive, and FactionWars' Mars
// (the Screensaver's, too).
export const MARS_PALETTES = ['mars', 'snowy', 'hive', 'lb-mars-fw'];

export const DEFAULTS = {
  name: 'Player',
  faction: 'good',          // 'good' (Astro), 'evil' (Alien) or 'random'
  colour: 'orange',
  palette: 'all',           // 'all' (as the host chose), one of PALETTES, 'random' or 'random-mars' (each match)
  music: 0.8,
  sound: 0.9,
  ui: 0.9,
  size: 'medium',           // the interface size: a key of UI_SCALES
  edgeScroll: true,         // the view scrolls when the pointer is at its edge
  autoMine: true,           // a new miner of yours goes to the nearest crystals
  ownedCounts: false,       // the sidebar shows how many of each thing you have
  teamIcons: 'skirmish',    // the sidebar's pictures in your colour: 'off', 'skirmish' or 'all' (in the story as well)
  storyColours: false,      // the story's sides in their colours: what one builds or takes of the other's, in its own
  storySpecOps: false,      // Special Ops (the Ops Ship, the Hive) in the story's levels too
  healthBars: 'off',        // health bars always shown: 'off' (as the original), 'units', 'buildings' or 'all'
  ignoreMinersDrag: false,  // a dragged box leaves out miners, unless they are all it holds
  ignoreEngineersDrag: false, // ... and engineers and saboteurs
  multiMinerReturn: false,  // several miners selected go home at a click on a headquarters
  multiFighterReturn: false, // ... and several fighters (Boomerangs), each to its own home
  english: 'european',      // the game's and the menus' spelling: 'european' (as the game's) or 'american'
  screensaverDirector: true, // Screensaver Mode: the view follows what is going on by itself
  screensaverHud: false,     // Screensaver Mode: the sidebar shown (off: the battlefield across the screen)
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
  if (!['all', 'random', 'random-mars', ...PALETTES.map(([key]) => key)].includes(s.palette)) s.palette = DEFAULTS.palette;
  if (!(s.size in UI_SCALES)) s.size = DEFAULTS.size;
  if (!['off', 'units', 'buildings', 'all'].includes(s.healthBars)) s.healthBars = DEFAULTS.healthBars;
  if (!['european', 'american'].includes(s.english)) s.english = DEFAULTS.english;
  // (once on or off: on was in a skirmish only)
  if (s.teamIcons === true) s.teamIcons = 'skirmish';
  if (s.teamIcons === false) s.teamIcons = 'off';
  if (!['off', 'skirmish', 'all'].includes(s.teamIcons)) s.teamIcons = DEFAULTS.teamIcons;
  for (const k of ['edgeScroll', 'autoMine', 'ownedCounts', 'storyColours', 'storySpecOps', 'ignoreMinersDrag', 'ignoreEngineersDrag', 'multiMinerReturn', 'multiFighterReturn',
    'screensaverDirector', 'screensaverHud']) if (typeof s[k] !== 'boolean') s[k] = DEFAULTS[k];
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

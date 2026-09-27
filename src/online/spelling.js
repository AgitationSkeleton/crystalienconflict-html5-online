// American spelling of the game's British English, and the menus' (a player's setting, "English
// Spelling"): the words that differ -- those the game's text and the menus have (Defence Station,
// Technology Centre, colour), and the other common ones -- each as it was written (DEFENCE,
// Defence, defence).

const WORDS = {
  centre: 'center', centres: 'centers', centred: 'centered', colour: 'color', colours: 'colors', coloured: 'colored',
  colouring: 'coloring', defence: 'defense', defences: 'defenses', offence: 'offense', armour: 'armor', armoured: 'armored',
  favourite: 'favorite', grey: 'gray', metre: 'meter', metres: 'meters', theatre: 'theater', harbour: 'harbor', honour: 'honor',
  vapour: 'vapor', behaviour: 'behavior', neighbour: 'neighbor', organise: 'organize', organised: 'organized',
  realise: 'realize', recognise: 'recognize', cancelled: 'canceled', travelled: 'traveled', labelled: 'labeled',
  manoeuvre: 'maneuver', licence: 'license', programme: 'program', aluminium: 'aluminum', tyre: 'tire', tyres: 'tires',
};
const WORD = new RegExp('\\b(' + Object.keys(WORDS).join('|') + ')\\b', 'gi');

export function american(text) {
  return String(text).replace(WORD, (w) => {
    const a = WORDS[w.toLowerCase()];
    if (w === w.toUpperCase()) return a.toUpperCase();
    return w[0] === w[0].toUpperCase() ? a[0].toUpperCase() + a.slice(1) : a;
  });
}

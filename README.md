# CrystAlien Conflict Online

A multiplayer version of the 2007 LEGO Mars Mission strategy game *CrystAlien Conflict*:
skirmishes against bots and other players, new maps, team colours and game modes. It is
built on the [1:1 HTML5 port](https://github.com/AgitationSkeleton/crystalienconflict-html5)
of the original Flash game, which stays unchanged at cac.viosarcade.xyz.

Work in progress. See [ROADMAP.md](ROADMAP.md) for what is planned, in what order, and how.

## Playing

The game fills the window: a wider window shows more of the map instead of enlarging it.
The main menu leads to a **skirmish** against the computer (set up in the lobby: map,
players, teams by colour, and the match's settings), to **online** games against other people
(host one, join one from the list or by its code, or send friends a link), to the original
**story**, and to the **settings** (your name, faction, colour, preferred map palette and volumes, kept in the
browser). In the story's menus, Conflict mode starts a skirmish on Eclipse; the story's two
Conflict levels are still there, by their access codes.

A skirmish is won by destroying everything the other teams have, or only their buildings,
or in **Pizza Mode** by collecting your own pizza: buy one at your headquarters (it lands
somewhere random, in your colour, and shows on every radar), then get a unit to it before
the enemy parks on it. Headquarters can't be destroyed in Pizza Mode, and everyone gets
$400 a minute. In **Capture the Flag**, drive a vehicle onto an enemy's flag and bring it to
your own flag's home to knock them out. With **crates** on, drive over one for a free unit
(a crystal box), $10,000 (an Alien capsule) or, at Christmas, a present: Santa's Sleigh.

The game fills the window. How far it is enlarged is the interface size (in the settings);
past that, a bigger window shows more of the map and a taller sidebar. It runs at the
original's 23 frames a second and is drawn at every refresh of the screen, with what moves
shown on its way between frames. If something goes wrong, a notice in the corner copies an
error report, for a bug report.

| Control | Action |
| --- | --- |
| Left click, drag | select units, give orders (as in the original) |
| Mouse wheel | zoom in and out; over the sidebar, scroll its lists |
| WASD, arrow keys, screen edges (can be turned off in the settings) | scroll |
| Space, right-click, middle-click, double click | deselect, cancel a building placement |
| Esc | pause menu |
| H | jump to your headquarters |
| Q + number, number, W + number | assign, select, jump to a squad |

On a phone or tablet, upright or on its side:

| Touch | Action |
| --- | --- |
| Tap | select, give orders, build (as a click) |
| Drag | move the view; on the sidebar, scroll its lists |
| Press and hold, then drag | draw a selection box |
| Pinch, two-finger drag | zoom, move the view |
| ✕ ⌂ ≡ buttons | deselect, jump to your headquarters, menu |

There is also **an app** for Windows, macOS and Linux (the settings page links to it, and so
does the repository's Releases page): the same game without a browser, which keeps itself up to
date. `client/` has it.

## Running it locally

Serve the repository root over HTTP (browsers block `fetch` on `file://`):

```
python -m http.server 8000
```

then open <http://localhost:8000/>.

## How the port works

The pipeline and the player are the 1:1 port's; its README describes them.
`tools/extract.py`, `tools/build_library.py` and `tools/transpile.py` build `data/`,
`assets/` and `src/scripts/` from the original SWFs. `src/flash/` is the Flash-compatible
player. In this repository `src/scripts/game.js` is hand-maintained source: running
`tools/transpile.py` would overwrite it.

## Credits

*CrystAlien Conflict* was made by 4T2 Multimedia for LEGO in 2007. LEGO and Mars Mission
are trademarks of the LEGO Group.

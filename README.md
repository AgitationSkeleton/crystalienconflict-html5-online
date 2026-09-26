# CrystAlien Conflict Online

A multiplayer version of the 2007 LEGO Mars Mission strategy game *CrystAlien Conflict*:
skirmishes against bots and other players, new maps, team colours and game modes. It is
built on the [1:1 HTML5 port](https://github.com/AgitationSkeleton/crystalienconflict-html5)
of the original Flash game, which stays unchanged at cac.viosarcade.xyz.

Work in progress. See [ROADMAP.md](ROADMAP.md) for what is planned, in what order, and how.

## Playing

The game fills the window: a wider window shows more of the map instead of enlarging it.
**Conflict mode** on the main menu starts a skirmish against the computer on Eclipse; the
story's two Conflict levels are still there, by their access codes.

| Control | Action |
| --- | --- |
| Left click, drag | select units, give orders (as in the original) |
| Mouse wheel | zoom in and out |
| WASD, arrow keys, screen edges | scroll |
| Space, right-click, middle-click, double click | deselect, cancel a building placement |
| Esc | pause menu |
| H | jump to your headquarters |
| Q + number, number, W + number | assign, select, jump to a squad |

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

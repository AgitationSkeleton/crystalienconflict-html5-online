# CrystAlien Conflict Online: roadmap

This repository starts as a copy of the 1:1 HTML5 port
([crystalienconflict-html5](https://github.com/AgitationSkeleton/crystalienconflict-html5),
served at cac.viosarcade.xyz), which stays faithful to the Flash original. Everything that
changes the game happens here, served at caconline.viosarcade.xyz.

## Requirements

As listed, plus later additions:

1. **Skirmish with bots.** Bot opponents whose decision-making is ported from the
   CrystAlien Conflict mod for Command & Conquer. Up to six bots, depending on the map.
2. **Maps from Command & Conquer.** Research how terrain is placed in both games and port
   the C&C skirmish maps' layouts, including their base markers.
3. **Maps from LEGO Battles.** The same for the LEGO Battles free-play maps (not the
   campaign's; likewise only C&C's skirmish maps, and of CrystAlien's own, only Eclipse). Their trees and
   crystals are solid, so they become walkable crystal tiles; well taps become plain
   crystal tiles; bridge placement tiles are dropped. Every map gets base markers for at
   least 3 players.
4. **Team colours.** Orange, Green, Red, Blue, Purple, Black, Tan and Cyan, using the
   palette-swappable sprites from the C&C mod. Players with the same colour are allies:
   one team, with separate starting bases but shared resources and vision, and they
   cooperate. Each team picks Astro or Alien. Baseplates are tinted for the faction and
   the team colour, and the team colour also tints the HUD sidebar.
5. **Game modes** as in the C&C mod: Destroy All, Destroy Structures, Pizza Mode, and
   Capture the Flag (the flag sprite from the Amaze level, recoloured per team).
6. **Lobby.** 2–6 slots, the host in slot 1. Each slot can be a player or a bot (or bots
   fill empty slots up to a quota), with bot difficulty (easy/medium/hard), faction and
   team colour. The host sets:
   - map: defaults to Eclipse/Nightfall, strictly 2 players
   - map palette: Mars or Snowy (Snowy taken from the Christmas level)
   - access: public in the server list, password, or invite only
   - room code (hidden by default) and a share-link button
   - game mode, starting money, starting units
   - prebuilt bases: HQ + Power Plant/Energy Generator + Training Camp/Breeding Pit,
     otherwise HQ only
   - Special Ops units and buildings on or off, and whether they need the Tech Centre or
     Experiment Lab
   - crates, the Christmas crate, crate respawn frequency
   - passive income, pizza cost (Pizza Mode)
   - game speed (as in C&C), shroud, superweapons (the uplink's nukes)
   - factions allowed: all, Astro only, Alien only
   - crystal regrowth rate
7. **Master server.** Every hosted lobby is listed automatically as
   "Playername - CTF - Eclipse - 46ms" (host name, mode, map, ping). Players join from
   the list, by room code, or through a link the host shares. The host can kick players.
   - A lobby whose match is under way is listed as such. Anyone joining then spectates,
     and gets a slot when the match ends if one is free.
   - Switching to a map with fewer bases never removes anyone: extra slots are greyed
     out, and the match can't start until the map fits.
   - The host sets the number of slots (2–6) and can add or remove them. Removing slots
     compacts the list, keeping players ahead of bots, and players who no longer have a
     slot become spectators.
   - Hosting on GitHub Pages if possible, otherwise on the owner's Windows 10 server.
   - With two or more people playing, pausing doesn't stop the match: Esc opens the menu
     for that player only.
   - A player who disconnects forfeits. If at least two teams are still standing, all
     their units and buildings blow up, "<Playername> has surrendered!" is shown, and the
     match goes on.
8. **Settings, kept in the browser.**
   - name, preferred faction, preferred colour
   - preferred map palette (All/Mars/Snowy), which overrides the host's choice on that
     player's screen
   - music, sound and UI volumes
9. **Controls.**
   - WASD and the arrow keys scroll
   - Space or right-click deselects
   - left click selects and drags, as in the original
   - Esc opens the pause menu
10. **New main menu.** Original, not the vanilla one: the game's fonts and sounds, in the
    style of its orange Astro gradients, reusing its UI pieces where possible.
11. **Offline client.** A download from GitHub Releases for every platform, which checks
    for updates on startup and installs them. The settings page offers it to players who
    are in a browser.
12. **Camera zoom** with the mouse wheel.
13. **The window's shape and size** (moved here from the 1:1 port's plan): the game
    fills the window, showing more of the map rather than enlarging it, with the HUD and
    menus repositioned and stretched to suit.

## Status

- **1. Screen and controls: done.** The game fills the window, the wheel zooms, WASD
  scrolls, right-click deselects. It is drawn at the screen's refresh rate, what moves
  shown between the game's 23 frames a second, and the pointer where the mouse is; the
  zoomed-out map keeps its shroud as a picture (the game's own cacheAsBitmap), mended where
  it changes. When something goes wrong, a notice offers an error report to copy.
- **2. Skirmish core: under way.** Units and buildings belong to players (up to six, in
  teams) with their own money and power; the story's levels play as two players, unchanged.
  Conflict mode starts a skirmish against the computer on Eclipse. Still to come in this
  step: the match's random seed and the determinism the online game needs.
- **3. Team colours: done.** Each player's units and buildings wear their colour in place of
  the faction's (the C&C mod's method: the faction's accent hue is repainted, keeping the
  art's shading; `tools/team_accents.py`), and so does anything in the C&C key green the mod
  recolours with it, such as the Aliens riding the Mothership, so a sprite is coloured as the
  mod's is. Baseplates are coloured all over, the radar shows each player in their colour,
  and the sidebar takes the player's.
- **7. Menus and settings: under way.** A new main menu (Skirmish, Online, Story, Settings)
  in the game's fonts and the Astro sidebar's orange and metal, with the Engineer and the
  Saboteur running from the cutscenes (`tools/make_menu_figures.py`); a skirmish lobby with
  the slots and every match setting (those the game does not use yet are marked as coming);
  and settings kept in the browser (name, faction, colour, palette, interface size, and
  music, sound and interface volumes). The game is enlarged to fit the window only as far as
  the interface size allows; a bigger window shows more of the map, and the sidebar grows to
  its height (more rows in its lists, a longer power meter). The Hive, Santa's Sleigh, Santa
  and the Reindeer have the C&C mod's sidebar pictures (`tools/make_icons.py`). A skirmish
  ends when one team is left: its players are told they are victorious, and everyone goes
  back to the lobby (not the original's play-again screens); a player who is out before that
  is told so and watches the rest. In the lobby your faction can be Random, or Spectator to
  watch the match (a grey sidebar, nothing to build), and the host can make every faction
  random. The story is reached through the original menus.
- **6. Maps: done.** 34 Command & Conquer skirmish maps and LEGO Battles' 30 free-play maps,
  extracted (`tools/maps/`) and drawn with CrystAlien's own rock, acid-pool and crystal tiles
  (`tools/convert_maps.py`). Open water is the story's plain green sea, and rock masses have
  flat tops inside rocky rims, as the story's hills do. LEGO bridge sites are ground; islands
  a LEGO player reached by boat get a causeway across the narrowest water so every base can
  reach every other. `tools/render_maps.py` draws them all for review (`work/map-renders/`).
- **5. Game modes: under way.** Destroy All and Destroy Structures, and **Pizza Mode**, by
  the C&C mod's rules: any player can buy a pizza at their headquarters (the lobby sets its
  price; it takes as long as the original's), which is delivered to a random reachable spot
  in the buyer's colour (the box only; the pizza stays a pizza). The buyer's team sees the
  ground around it, everyone else hears the alarm, and it blinks on every radar through the
  shroud. The team that collects its own pizza wins; anyone else's units leave it alone.
  Headquarters take no harm and cannot be sold or infiltrated, and every player gets $400
  a minute. Computer players buy one when they can afford it, send their fastest unit for
  it, and post four armed units on the enemy's (and on bigger maps its surroundings are seen
  as far as the mod's; on smaller ones proportionally less).
  **Capture the Flag**, by the mod's rules: every player's flag (the Amaze level's, in their
  colour) stands by their headquarters. A vehicle can pick up an enemy's flag by driving onto
  it; it carries it overhead, without its shadow, under an arrow in the flag's colour (the
  tutorial's), and bringing it to its own flag's home puts the flag's owner out of the game.
  A lost carrier drops the flag; the owner always sees where their flag goes. Computer
  players carry flags home, chase whoever has theirs, send their fastest vehicle for the
  nearest enemy flag, guard their own and build their guns by it. Crates are next.
- **4. Bots: done.** Computer players (`src/online/bot.js`) think the way the C&C mod's
  opponent does, as set out in `docs/cnc-ai-spec.md`: a build plan by urgency, the four
  wants, the missions (guard, hunt, attack, harvest and so on), raids on the weakest or
  richest enemy, patrols, repairs and sales, scouting, retaliation and base defence, and
  superweapons. They play by the player's rules (tech tree, one building and one unit at a
  time, building sites), at a pace set by their difficulty; Special Ops can be on, need the
  Technology Centre, or be off.

## Order

Rearranged so that each step builds on the ones before it.

1. **Screen and controls** (12, 13, 9). The view that everything else is built on; it can
   be tried straight away on the existing levels.
2. **Skirmish core** (part of 1, 6). The original is two-sided: "good" and "evil" are both
   faction and side. Rework it into up to six players, each with a faction, a colour and a
   team (allies). Add match settings in place of story scripts, and a map format with base
   markers, starting with Eclipse/Nightfall. From here on the simulation is kept
   deterministic (seeded random numbers, identical maths in every browser, no dependence
   on rendering), so that it can later be networked.
3. **Team colours** (4).
4. **Bots** (1), ported from the C&C mod's AI.
5. **Game modes** (5).
6. **Maps** (2, 3, and the Snowy palette).
7. **Menus and settings** (10, 8, and the lobby screen of 6, playable offline against
   bots).
8. **Online** (6, 7): networking, master server, lobbies, spectators, join links.
9. **Offline client** (11).

Also planned, for later: a high-score server for the original's Conflict-mode table, as
set out in the 1:1 port's `docs/high-score-server.md`.

## How

The online version evolves the 1:1 port rather than replacing it: the same Flash-compatible
player, the same assets, and the original game's code, which here becomes hand-maintained
source. That keeps the feel and the numbers of the original (no rebalancing), with changes
made where needed. Decompiled names (`_loc2_`) get proper ones as the code is worked on.

**Networking:** deterministic lockstep, the usual approach for RTS games. Every player's
browser runs the same simulation; only commands travel over the network, applied on the
same frame everywhere. That needs:
- player input turned into commands, instead of acting on units directly;
- maths that gives bit-identical results in every browser (JavaScript's `Math.sin` and
  friends can differ in the last bit between engines).

**Open questions, for when they come up:**
- Server hosting: GitHub Pages only serves files, so it can't run the master server or
  relay a match. The likely options are Cloudflare Workers with Durable Objects on the
  viosarcade.xyz account, or a Node server on the Windows 10 machine; the protocol can be
  the same either way.
- Offline client technology: Electron or Tauri.
- "Up to six bot opponents" (1) and "2–6 slots" (6): is six the limit on players or on
  bots?

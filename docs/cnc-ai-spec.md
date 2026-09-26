# CrystAlien Conflict Factions: computer opponent porting specification

This spec covers the computer-opponent AI of the C&C Remastered (Tiberian Dawn) mod "CrystAlien Conflict Factions". It is written for re-implementation in JavaScript on the original CrystAlien Flash engine.

**Source.** `D:\Claude_RTSGames\COMMANDANDCONQUER\workfolders\cac-crystalien-factions\src\TiberianDawn\`. All `file:line` references are relative to that folder, apart from `playbook/` and `docs/`, which are at the repo root.

**Build.** The total conversion, where `CAC_SUPPLEMENTAL` is undefined. The supplemental build (GDI/Nod plus CrystAlien) is ignored except where it matters.

**Tags used in this spec:**
- **[code]**: what the C++ actually does.
- **[intent]**: what a comment or doc says it should do, where that differs from the code.
- **[gap]**: something that could not be settled from the source.
- **[port]**: a suggestion for the JS port that the source does not contain.

---

## 0. Conventions

### 0.1 Time
- `TICKS_PER_SECOND = 15` and `TICKS_PER_MINUTE = 900` (DEFINES.H:2357-2358). One AI tick is 1/15 s. `Frame` counts ticks from 0.
- Integer division matters: `TICKS_PER_SECOND/2` is **7 ticks (0.467 s)**, not 7.5.
- CrystAlien's Flash logic runs at 23 fps (CACLOGIC.H:400-404). One tick is 23/15 ≈ 1.533 Flash frames. Cadences below are given in ticks and seconds. **[port]** Either run the AI on a 15 Hz accumulator, or convert with ×23/15.
- "Cadence N, phase p" means the routine runs on ticks where `(Frame + p) % N == 0`.

### 0.2 Space
- 1 C&C cell = 1 CrystAlien tile = 256 leptons = 96 CrystAlien world px (CACLOGIC.CPP:1235-1238, CACLOGIC.H:415-419).
- The engine's `Distance` (FUNCTION.H:893-909; `Distance_Coord`) is `max(|dx|,|dy|) + min(|dx|,|dy|)/2` in leptons. It is an octagonal approximation, not Euclidean.
- Thresholds quoted "in cells" are `leptons/256`, using integer division.
- The playable map is the rectangle `MapCellX, MapCellY, MapCellWidth, MapCellHeight`. In the target engine this is the whole arena.

### 0.3 Houses, sides, ids
- **Player houses.** Players are Multi1..Multi6 (enum 4..9).
- **Engine houses.** The engine also creates GoodGuy (0), BadGuy (1), Neutral (2) and Special/JP (3).
  - Every house is created (HOUSE.CPP:2393-2405).
  - In skirmish, only Multi1..6, Neutral and Special run house AI (LOGIC.CPP:303-319).
- **Which houses the CrystAlien AI serves.**
  - CrystAlien AI routines skip Neutral and Special (`CAC_Is_CrystAlien_House`, CACLOGIC.CPP:8858-8877).
  - `CAC_Idle_Watch` (1894) and `CAC_AI_Pizza` (2413) also require Multi1 or later.
  - "Computer house" means `!IsHuman`. A human who disconnects becomes a computer house with IQ 5 and base building on (DLLInterface.cpp:1865-1877), so all of the AI takes over their side.
- **Sides.**
  - Astro = "good" and Alien = "evil", taken from the lobby faction (`CAC_Side`/`ActLike`, CACLOGIC.CPP:25-34).
  - Every CrystAlien type has one engine slot per side (CACSLOTS.INC, CACENUMS.INC). The good slot always precedes the evil slot in enum order.
  - "Own-side slot" is the house's faction's version of a code. A house can also own and build the other side's types by capturing that side's buildings (§9).
- **`id` in cadence formulas** is the house's heap index, which equals the enum value (Multi1 = 4). `houseEnum` is the same number.

### 0.4 Roster: the values the AI reads

**Buildings.**
- Sources: CACSTATS.H (cost/power/drain/cap/threat), CACCAPS.INC, CACTHREAT.INC, CACHOSTS.INC, and CACTYPES.CPP ("Build level", sight, ToBuild).
- Power is positive for generators and negative for drains.
- Health in game equals the CrystAlien figure: the constant is halved and the engine doubles it (CACSTATS.H:28).

| Code | Astro / Alien | Cost | Power | Cap | Threat | Level | Sight | Hosts (builds) |
|---|---|---|---|---|---|---|---|---|
| BA | Eagle Command Base / Alien Mothership | 3000 | +1 | 1 | 2 | 1 | 3 | structures; UD miner; UJ pizza |
| BB | Power Plant / Energy Generator | 800 | +200 | 8 | 3 | 2 | 2 | – |
| BC | Training Camp / Breeding Pit | 500 | −10 | 2 | 3 | 3 | 2 | UA, UB, UC |
| BD | Defence Station / Assault Turret | 1500 | −75 | 12 | 8 | 4 | 4 | – (armed: rocket 300 px, ROF 4) |
| BE | Vehicle Factory / Battle Foundry | 2000 | −25 | 2 | 3 | 4 | 2 | UE, UF, UR, UH |
| BF | Radar Station / Sonar Station | 1000 | −50 | 1 | 3 | 4 | 2 | UG (it is also the aircraft "pad" and fighter home) |
| BG | Technology Centre / Experiment Lab | 2000 | −100 | 1 | 5 | 5 | 2 | – |
| BH | Satellite Uplink / Orbital Uplink | 1500 | −100 | 5 | 7 | 6 | 2 | – (superweapon, lifts shroud) |
| BK | MX-81 Ops Ship / Alien Hive | 3000 | +1 | 1 | 2 | 2 | 3 | structures; UP; UQ (Alien); also UD (CACLOGIC.CPP:7235-7241). Armed: rocket 500 px, ROF 10 |
| BL | MT-201 Driller (Astro only) | 3000 | 0 | 4 | 1 | 3 | 2 | – (earns 500 credits every 196 ticks) |
| BJ | Santa's Sleigh | 1500 | +100 | 1 | 3 | 1 | 2 | UM, UN |

BI (Soccer Pitch) and BX (Rocket) are level decoration and never buildable. BS is the airborne Ops Ship unit, which is never buildable.

**Units.**

| Code | Astro / Alien | Class | Cost | Cap | Threat | Speed (CA / MPH) | Sight | Weapon | Level | Host |
|---|---|---|---|---|---|---|---|---|---|---|
| UA | Infantry / Drone | inf | 200 | 5 | 3 | 2 / 9 | 3 | laser 200 px, ROF 20 | 4 | BC |
| UB | Engineer / Saboteur | inf | 500 | 5 | 5 | 1 / 8 | 1 | none; captures or repairs | 4 | BC |
| UC | JetPack Explorer / Viper Attack | air | 600 | 5 | 4 | 5 / 16 | 3 | rocket 300 px, ROF 20 | 6 | BC |
| UD | Crystal Miner / Crystal Extractor | veh | 1400 | 4 | 2 | 6 / 20 | 3 | none; cargo 200 | 2 | BA (or BK) |
| UE | Trike / Speeder | veh | 600 | 5 | 4 | 10 / 41 | 2 | laser 250 px, ROF 10 | 5 | BE |
| UF | ClawTank Ambush / Dragon Cruiser | veh | 1200 | 5 | 7 | 5 / 16 | 3 | rocket 300 px, ROF 5 | 5 | BE |
| UG | Astro Fighter / Strike Fighter | air | 1200 | 4 | 8 | 10 / 41 | 4 | rocket 300 px, ROF 2, 10 rounds; boomerang (home BF) | 5 | BF |
| UH | Recon Dropship / Hyper Carrier | air | 1000 | 2 | 4 | 6 / 20 | 4 | none; carries 6 | 6 | BE |
| UJ | Pizza Delivery | inf | 50,000 | 1 | 0 | 0 / 8 | 1 | none | 1 | BA |
| UM | Santa | inf | 2000 | 1 | 10 | 6 / 20 | 3 | laser + rocket 275 px, ROF 3 | 1 | BJ |
| UN | Reindeer | inf | 500 | 9 | 5 | 3 / 11 | 1 | none (the "decoy") | 1 | BJ |
| UP | Switch Fighter / Alien Infiltrator | air | 1500 | 2 | 4 | 10 / 41 | 4 | rocket 300 px, ROF 10; transformer | 3 | BK |
| UQ | Commander (Alien only) | inf | 2000 | 1 | 10 | 5 / 16 | 4 | laser + rocket 350 px, ROF 3 | 3 | BK (Alien) |
| UR | Crystal Reaper (Astro only) | veh | 900 | 2 | 7 | 6 / 20 | 3 | rocket 300 px, ROF 7; carries 1 | 5 | BE |

Notes on the unit table:
- **Cap overrides.** UN's cap is 9 (the source says 8), UQ's is 1 (the source says 5), and UJ's is 1 (CACCAPS.INC).
- **Weapons.**
  - Every shot does 25 damage and there are no armour classes (CACWEAPONS.INC header).
  - Lasers cannot target aircraft; rockets can. UM and UQ carry both, so they can.
- **Speed comparisons.** The C++ compares `MaxSpeed` in MPH. The order is the same as the CrystAlien speed stat.
- **Carriers.** A UH may carry UA, UB, UC, UM, UN and UQ (CACCARRY.INC). A UR carries 1.
- **Risk and reward** feed the stock base-defence response and the superweapon picker (§6):
  - Risk is 50 for every CrystAlien unit, infantry and aircraft, and 0 for buildings.
  - Reward is 50 for units and 80 for buildings (CACTYPES.CPP "RISK/RWRD" lines).

### 0.5 Orders and their target-engine equivalents

The C++ AI never steers units itself. It assigns a **mission** plus an optional **destination** (NavCom), **target** (TarCom) and **guard anchor** (ArchiveTarget). Mission semantics come from stock TD and are detailed in §6.

| Mission | Behaviour | Target-engine equivalent |
|---|---|---|
| GUARD | Stand still. Shoot anything in weapon range. | Idle; the engine's own engageEnemy. |
| GUARD_AREA(anchor) | Leashed guard, §6.1: acquire targets within 2× weapon range of the anchor (≤ 10 cells), chase to weapon range + 1 cell, walk back to the anchor. | voyage(anchor) plus a leashed engage. |
| HUNT | With no target, pick the best enemy on the whole map (§6.2) and approach or attack it. Keep it until it is gone. | `unit.target = pick()`, re-picked when dead. |
| RESCUE(t) | HUNT with the target preset to t (MISSION.CPP:253-256). | `unit.target = t`. |
| ATTACK(t) | Approach and attack t. When t is gone, enter idle mode (FOOT.CPP:611-661). | `unit.target = t`. |
| MOVE(cell) | Go to the cell. On arrival, enter idle mode. | `nav.voyage(x, y)`. |
| CAPTURE(b) | An engineer walks into building b. An enemy building is captured; a damaged friendly one is fully repaired. The engineer is consumed either way (CACLOGIC.CPP:578-630). | Engineer `unit.target = b`. |
| ENTER(carrier) | Board the carrier. | Boarding. |
| UNLOAD(cell) | A transport flies to the cell, lands and unloads. | Carrier voyage plus unload. |
| HARVEST | The miner cycle. | `nav.voyage(.., bait)` and returnHome. |

**Idle mode for a computer unit** (UNIT.CPP:1413-1491, INFANTRY.CPP:2230-2273, AIRCRAFT.CPP:2549-2640), in order:
1. It has a target → ATTACK.
2. Otherwise it has a destination → MOVE.
3. Otherwise it is armed and not in a team → GUARD_AREA (IQ 5 ≥ IQGuardArea 4), unless it is already in GUARD or GUARD_AREA.
4. Other cases:
   - Unarmed infantry → GUARD.
   - A miner → HARVEST.
   - Aircraft → GUARD, holding station. A boomerang (UG) flies home instead (§4.2).

**New objects.** New objects enter idle mode when they are placed (TECHNO.CPP:1269-1280).
- A newly built or crate-spawned armed computer unit therefore starts in **GUARD_AREA anchored where it appears**.
- Unarmed infantry start in GUARD, miners in HARVEST and aircraft in GUARD.
- A computer house's starting army is explicitly set to GUARD_AREA (INI.CPP:2039-2041, 2101-2103).

### 0.6 Random numbers
The source uses `Random_Pick(a,b)` (inclusive) and a synchronised `Sim_Random_Pick`. **[port]** Use the game's own deterministic RNG throughout.

---

## 1. The tick

### 1.1 Global order within one tick (LOGIC.CPP:166-327)
1. Crate top-up check (LOGIC.CPP:193-200); see §7.2.
2. Purge Visceroids (CACLOGIC.CPP:1728-1747). Irrelevant to the port.
3. Team AI. There are no teams in skirmish.
4. Every object's own AI:
   - unit missions;
   - `CAC_Opportunity_Fire` (§6.2);
   - boomerang logic (§4.2);
   - building repair, auto-sell and production (§2.9, §3.1).
5. Scan bits and `Recalc_Attributes`.
6. `Map.Logic`: crystal growth (§8).
7. Factories advance.
8. **House AI**: Multi1..Multi6 in order, then Neutral, then Special (LOGIC.CPP:303-319).

### 1.2 Inside `HouseClass::AI` (HOUSE.CPP:1070-2133), in execution order

"All" means every house, human or computer. Cadences are in ticks with seconds in brackets.

| # | Routine | Runs for | Cadence | Ref |
|---|---|---|---|---|
| 1 | Reset scan bits | all | every tick | 1080-1095 |
| 2 | Computer: set `IsBaseBuilding = IsStarted = IsAlerted = true` | computer | every tick | 1106-1110 |
| 3 | `IsToDie` with BorrowedTime expired → blow up everything, then `MPlayer_Defeated`. Pizza wins and CTF captures end through this. | all | every tick | 1140-1149 |
| 4 | Stock alert/team creation. Inert: skirmish has no TeamTypes. | all | – | 1167-1190 |
| 5 | CTF: scatter a non-moving unit standing on this house's FlagHome cell | all | 90 (6 s) | 1196-1229; HOUSE.H:717 |
| 6 | Low-power damage: if engine Power < Drain, each own building with Drain > 0 and health > 50 % loses 1 HP | all | 900 (60 s) | 1290-1337 |
| 7 | `CAC_Power_Klaxon`. Interface sound only. | local player | every tick | 1446 |
| 8 | **`CAC_AI_Collect`** | computer | outer gate `Frame%7==0`, inner gate `(Frame+7·id)%15==0` → effectively **every 105 ticks (7 s)** **[code]**. The comment says once a second **[intent]**. | 1458; CACLOGIC.CPP:5170 |
| 9 | **`CAC_AI_Aggression`** | computer | 30 (2 s), all houses on the same tick | 1464 |
| 10 | **`CAC_AI_Sortie`** | computer | every tick, but acts only while `Frame % 260 ≥ 228` (32 of every 260 ticks: about 2.1 s in every 17.3 s) | 1470; CACLOGIC.CPP:4380-4384 |
| 11 | **`CAC_AI_Raid`** | computer | 450 (30 s); 180 (12 s) while under attack; phase = houseEnum | 1476; 4986-4987 |
| 12 | **`CAC_AI_Patrol`** | computer | 300 (20 s), phase 13·id; skipped while under attack | 1477; 4706-4710 |
| 13 | **`CAC_AI_Repair`** | computer | 7 (0.47 s) | 1478; 4314 |
| 14 | **`CAC_AI_Flag`** | computer, CTF only | 7 (0.47 s) | 1479; 4024-4027 |
| 15 | **`CAC_AI_Flag_Guard`** | computer, CTF only | 30 (2 s) | 1480; 4168-4171 |
| 16 | **`CAC_AI_Scout`** | computer | 15 (1 s), phase 5·id | 1481; 5481 |
| 17 | **`CAC_AI_Airlift`** | computer | 15 (1 s), phase 11·id | 1482; 5696 |
| 18 | **`CAC_AI_Infiltrate`** | computer | 15 (1 s), phase 7·id | 1483; 6025 |
| 19 | `CAC_AI_Census`. Logging only. | computer | 450, phase 37·id | 1484; 4800-4896 |
| 20 | **`CAC_Idle_Watch`** | computer, Multi houses | every tick | 1485; 1891-1985 |
| 21 | **`CAC_Pizza_Stipend`** | **all**, including humans, Neutral and Special; Pizza Mode only; skipped for defeated houses | 900 (60 s), phase 7·houseEnum | 1486; 2533-2548 |
| 22 | **`CAC_AI_Pizza`** | computer, Multi houses, Pizza Mode only | 15 (1 s), phase 13·id | 1487; 2401-2415 |
| 23 | `CAC_Watch_Factories`, `CAC_Roll_Call`. Logging only. | global | – | 1493, 1499 |
| 24 | **`CAC_Cancel_Unbuildable`**, a game rule (§9.4) | **all** | every tick | 1506; CACLOGIC.CPP:336-379 |
| 25 | Superweapon slots: enable, charge, suspend, and the computer fires when ready (§6.6) | all (firing is computer only) | every tick | 1522-1755 |
| 26 | Short-game rule. Never active in the conversion (§8). | all | every tick | 1770-1772; 5466-5534 |
| 27 | Defeat test: no active buildings, no active aircraft, no units and no active infantry → defeated | all | every tick | 1780-1783 |
| 28 | Triggers (none in skirmish), radar, sidebar | – | – | 1785-1883, 1889-2002 |
| 29 | **Stock RA-derived AI**, skirmish only: `Expert_AI` when its countdown reaches 0 (then re-armed to 75 + Random(1..7) ticks, about 5.1-5.5 s, 6411). Then, **every tick**: `AI_Building`, `AI_Unit`, `AI_Vessel` (inert), `AI_Infantry`, `AI_Aircraft`. Their return values are ignored. | computer | as stated | 2014-2035 |

### 1.3 Human versus computer summary

**Runs for human houses too:**
- the Pizza stipend;
- `CAC_Cancel_Unbuildable`;
- the CTF flag-home scatter;
- low-power building damage;
- the defeat test;
- superweapon slot management (only a human can hold the second uplink slot; see §6.6).

**Returns immediately for humans:** every `CAC_AI_*` routine, `CAC_Idle_Watch`, `Expert_AI` and `AI_Building`/`AI_Unit`/`AI_Infantry`/`AI_Aircraft`.

**Per-object behaviours that are computer-only:**
- building auto-repair, auto-sell and production (BUILDING.CPP:1260-1358);
- the idle-mode rule of §0.5;
- damage retaliation straight to HUNT (§6.3);
- `Base_Is_Attacked` defender recruiting (§6.3);
- the crate-cell entry restriction (§7.3);
- computer miners put back to HARVEST from GUARD (UNIT.CPP:4472-4475).

---

## 2. Base building

### 2.1 Flow
1. **Decide.** Every tick, if `BuildStructure` is empty, `AI_Building` evaluates the plan in §2.2 and stores the winner in `BuildStructure` (HOUSE.CPP:7129-7766). While it is set, the plan is not re-evaluated (7140).
2. **Start production.** A structure host is BA or BK, the two buildings whose ToBuild is structures.
   - When a host is idle and the house is "started" with more than 10 credits, the host asks `CAC_Host_Suggestion` (§3.1) and starts `BuildStructure` (BUILDING.CPP:1306-1358).
   - Starting production clears `BuildStructure` (Production_Begun, HOUSE.CPP:8526-8566), so the plan is re-run the next tick.
3. **Pay and build.** Payment is progressive (the engine factory).
   - Build time for CrystAlien types is `cost × 15/184` ticks, which is the source's 8 progress per frame at 23 fps (TECHNO.CPP:307-329; CACLOGIC.CPP:7034-7057).
   - The time is doubled while power is LOW (TECHNO.CPP:378-380).
4. **Place.** A finished building is placed at `Find_Build_Location` (§2.8; BUILDING.CPP:2741-2799).
   - If no cell is returned, the item is abandoned and refunded (BUILDING.CPP:1237-1241).
   - If units block the site, placement is retried after 3 s (1243-1245).

- **[code]** `BuildStructure` is sticky. If the chosen type becomes unbuildable before a host starts it, the house waits on it.

### 2.2 The plan (HOUSE.CPP:7151-7766)

**Inputs:**
- **N** = `CurBuildings`: all own buildings, including captured ones and buildings still in production.
- **money** = credits in hand. CrystAlien houses have no silo storage, so all income is credits.
- **hasincome** = the house owns its **own-side BA** *and* has at least one miner of either side (7173). Drillers and BK do not count.
- **Can_Build** for a computer house is defined in §9.3: tree, tech level and type cap.
- **affordable(b)** = `cost(b) < money` or `hasincome`.
- **cur(X)** = the count of the role's slot (§2.4). Where two stock roles map to the same slot, it is counted once (7282-7285, 7361-7364).
- **target(r)** = the ratio target from §2.3.

**Entries, in allocation order.** The order matters for tie-breaks.

| # | Entry | Builds | Offered when | Urgency | Ref |
|---|---|---|---|---|---|
| 1 | Power | BB | Can_Build ∧ `wantpower` (§2.5) ∧ affordable | `powerneed` (§2.5): HIGH if power is OFF, MEDIUM if LOW, LOW if FULL | 7199-7221 |
| 2 | Driller A | own-side BL | Can_Build ∧ affordable. No power check. | **CRITICAL** if the house has no miners, else MEDIUM | 7232-7252 |
| 3 | Refinery | BA | never, because BA is unbuildable | – | 7257-7266 |
| 4 | Barracks | BC | cur < target(40) ∧ cur < 2 ∧ (money > 300 ∨ hasincome) ∧ Can_Build ∧ affordable | LOW if cur > 0, else MEDIUM | 7282-7303 |
| 5 | Factory | BE | cur < target(25) ∧ cur < 2 ∧ (money > 2000 ∨ hasincome) ∧ Can_Build ∧ affordable | LOW if cur > 0, else MEDIUM | 7337-7346 |
| 6 | Defence | BD | cur < target(102) ∧ cur < 40 ∧ Can_Build ∧ **Can_Power** ∧ affordable | MEDIUM | 7361-7401 |
| 7a | AA: radar | BF | curBD < target(36) ∧ curBD < 10 ∧ **airthreat** ∧ own BF count = 0 ∧ Can_Build ∧ affordable | **HIGH** | 7407-7440 |
| 7b | AA: "SAM" | BD (same slot as #6) | same gate as 7a apart from the BF test; Can_Build ∧ affordable. **No power check.** | MEDIUM. HIGH only if cur < the enemy's aircraft count, which never happens (§3.2). | 7442-7447 |
| 8 | Tech centre | BG | own count = 0 ∧ Can_Build ∧ Can_Power ∧ affordable | **HIGH** if the tier switch (§8) is on, else MEDIUM | 7529-7550 |
| 9 | Uplink | BH | own count = 0 ∧ Can_Build ∧ Can_Power ∧ affordable | MEDIUM | 7552-7562 |
| 10 | Driller B | own-side BL | count < cap (4) ∧ Can_Build ∧ Can_Power (always true: no drain) ∧ affordable | **CRITICAL** in Pizza Mode, else MEDIUM | 7584-7616 |
| 11 | Sleigh | own-side BJ | count < 1 ∧ Can_Build (only after this house has opened a present) ∧ affordable | MEDIUM | 7630-7655 |
| 12 | Next rung | `CAC_AI_Extra` (§2.4) | Can_Build ∧ Can_Power ∧ affordable | MEDIUM | 7666-7684 |
| 13 | Helipad role | BF | cur < target(30) ∧ cur < 5 ∧ Can_Build ∧ affordable | MEDIUM. HIGH if own aircraft < the enemy's, which never happens. | 7689-7703 |
| 14 | Airstrip role | BK | cur < target(30) ∧ cur < 5 ∧ Can_Build ∧ affordable | **HIGH** if the tier switch is on and cur = 0. Otherwise MEDIUM (the enemy-aircraft clause never fires). | 7708-7751 |

Notes on the plan:
- **airthreat** is true when any non-allied house has any aircraft (7414-7428). `Enemy` is never set (§3.2), so the enemy-count clauses are dead.
- **Choosing the winner.** Walk the entries in allocation order. The **first entry with the strictly highest urgency wins** (7756-7766). If every entry is NONE, nothing is chosen.
  - Consequence: at equal urgency, power (#1) beats everything, and the Driller beats barracks, factory and defence.
- **No base-size limit.** `quant` (largest human base + `BaseSizeAdd` 3) is computed but never used (7152-7166). Per-type caps (§2.6) are the only limits.
- **The Driller is Astro-only.** The Alien BL slot never passes Can_Build (§9.1), so an Alien house never offers entries 2 or 10.

### 2.3 Ratio targets

`target(r) = RoundUp(r × N)`, where r is in 1/256ths. The ratios are (RULES.CPP:96-108):
- Barracks 40
- War factory 25
- Defense 102
- AA 36
- Helipad 30
- Airstrip 30
- Refinery 40

**`RoundUp` (HOUSE.CPP:5709-5721):**
1. Take `v = (r×N)` truncated to 16 bits.
2. If `v % 256 == 0`, return `v` unscaled. **[code quirk]** This is effectively "no limit". It first bites at N = 32 (ratio 40), 64 (36), 128 (102 and 30) and 256 (25); N = 0 gives 0.
3. Otherwise return `floor(v/256) + 1`, which is ceil(r×N/256).

**Hard limits:** Barracks 2, War 2, Defense 40, AA 10, Helipad 5, Airstrip 5, Refinery 4 (RULES.CPP:97-109). The per-type caps (§0.4) usually bind first: BC 2, BE 2, BD 12, BF 1, BK 1.

**Effective targets:**

| N (buildings) | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 20 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Barracks (40) | 1 | 1 | 1 | 1 | 1 | 1 | 2 | 2 | 2 | 2 | 2 | 2 | 3 | 3 | 3 | 3 | 3 | 3 | 4 |
| Factory (25) | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| Defence (102) | 1 | 1 | 2 | 2 | 2 | 3 | 3 | 4 | 4 | 4 | 5 | 5 | 6 | 6 | 6 | 7 | 7 | 8 | 8 |
| AA (36) | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 3 | 3 | 3 | 3 | 3 |
| Heli/Airstrip (30) | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 3 | 3 |

The barracks and factory targets are further clipped to 2 by their limits.

### 2.4 `CAC_AI_Role` and `CAC_AI_Extra`

**Role mapping** (CACLOGIC.CPP:7269-7377):

| Stock role asked by the plan | CrystAlien building |
|---|---|
| POWER, ADVANCED_POWER | BB |
| BARRACKS, HAND | BC |
| WEAP | BE |
| RADAR, HELIPAD | BF |
| AIRSTRIP | BK |
| TEMPLE, BIO_LAB | BG |
| EYE | BH |
| TURRET, OBELISK, SAM, GTOWER, ATOWER | BD |
| everything else (REFINERY, CONST, STORAGE, …) | BA, which is never buildable, so the entry is skipped |

**Slot selection** (7333-7375):
1. Use the house's own-side slot for the code.
2. For a computer house, if its own-side slot fails Can_Build and the other side's slot passes (the house holds a captured tree), use the other side's slot.
3. If the code has no slot for the house's side, use the other side's slot.

**`CAC_AI_Extra`** (7395-7437) walks BA, BB, BC, BD, BE, BF, BG, BH (own side) and returns the first one the house does not currently own.
- BK, BL and BJ are deliberately left out; they have their own entries.
- **[code]** BA comes first and is unbuildable. A house that does not own its own-side BA (lost, or a captured-HQ-only house) therefore always gets BA back, and the "next rung" entry is dead for it.

### 2.5 Power

**CrystAlien power model** (CACLOGIC.CPP:3206-3351):
```
charge = 50 + Σ over own placed buildings with Power>0 of floor(Power × ceil(100·HP/maxHP) / 100)
drain  = Σ over own placed buildings of Drain            // buildings still going up count for both
net    = charge − drain
state  = net < 0 ? OFF : net < 50 ? LOW : FULL
```

**Effects of each state:**
- LOW doubles build time (TECHNO.CPP:378-380).
- OFF stops buildings firing (BUILDING.CPP:1166).
- LOW pauses superweapon charging (HOUSE.CPP:1538, 1563) and the human's radar and shroud lifting.

**`CAC_AI_Power_Urgency`** (6193-6202): OFF → HIGH, LOW → MEDIUM, FULL → LOW.

**`wantpower`** (HOUSE.CPP:7199-7205):
```
wantpower = powerneed > LOW  ||  enginePower <= engineDrain + 50      // Rule.PowerSurplus = 50
```
- `enginePower` and `engineDrain` are the engine's running totals: health-scaled plant output, with **no** 50 allowance, counting placed buildings.
- In CrystAlien terms: with FULL power the AI still builds a plant while `(charge − 50) − drain ≤ 50`. **[port]** Use `charge − 50` as `enginePower`.

**`CAC_AI_Can_Power(type)`** (6215-6220): true if the type drains nothing, otherwise `net − type.Drain ≥ 0`. It gates Defence (BD, 75), Tech (BG, 100), Uplink (BH, 100), Driller B and Next rung. It does **not** gate barracks (10), factory (25), BF (50), the "SAM" entry, the Sleigh or Driller A.

### 2.6 Caps
- **Computer houses.** `Can_Build` refuses a type at its cap (HOUSE.CPP:641). The count includes objects on the map and in production (CACLOGIC.CPP:254-311, 454-497):
  - units: those not in limbo, plus passengers;
  - buildings: every active one.
- **Humans.** The cap is enforced in Begin_Production instead (HOUSE.CPP:2903-2907).
- **[code quirk]** A building in production is counted twice: once as its limbo object and once as its factory item. This only matters when BA and BK both try to start the same capped structure.
- `MaxBuilding` is at least 150 (HOUSE.CPP:2399-2401), so it is never binding.

### 2.7 Building auto-behaviour of computer houses

**Repair** (CACLOGIC.CPP:4303-4337; BUILDING.CPP:1199-1221):
- Every 7 ticks, if the house owns any BA or BK of either side, repair is switched on for every damaged own building. If the house owns neither, it is switched off.
- The engine repair adds 5 HP every 15 ticks, costing `max(1, (max(1,(cost·5/maxHP)/2))·102/256)` credits per step (BDATA.CPP:4829-4836). It stops at full health or when credits run short.
- **[port]** The source's own Building.think repair gives the computer +20 HP every 10 frames for cash while it owns BA or BK. The mod keeps TD's rate on purpose (CACLOGIC.CPP:4293-4298).

**Low-health rule** (BUILDING.CPP:1260-1301). For a repairable building at ≤ 25 % health:
- If money ≥ 1000 (REPAIR_THRESHHOLD, DEFINES.H:174), start repair.
- Otherwise, if the building has ever been damaged by an enemy, there is a **1/51 chance per tick** to sell it.
- Computer houses never sell BA or BK (Sell_Back refuses, 3537-3544). BA is unsellable for everyone (CACLOGIC.CPP:1834-1851).

### 2.8 Placement: `Find_Build_Location` (HOUSE.CPP:5815-5969)

The steps are tried in this order.

**1. Driller** (`CAC_Find_Crystal_Site`, CACLOGIC.CPP:7954-8008).
- Scan every cell. A cell is a candidate if:
  - it is crystal;
  - the Driller's whole covered footprint (2×2) is crystal;
  - no building, terrain, overlapping building or flag is on any footprint cell (7627-7674, 7709-7727).
- Its distance in cells from the house's base centre (§2.8 step 3) must not exceed `allowed`. Pick the nearest candidate.
- `allowed = CAC_Driller_Range` (7751-7767):
  - `24 + 8 × floor(Frame / 2700)` cells, so the range widens by 8 every 3 minutes;
  - capped at the map diagonal in cells (at least 24);
  - the whole cap immediately if the house owns an uplink BH of either side.
- If there is no candidate, return 0: the Driller is abandoned and refunded, and the plan will offer it again.

**2. Capture the Flag and the building is armed** (BD or BK) (`CAC_Flag_Defence_Site`, 3970-4017).
- Take the cells within ±5 (a square) of the house's flag cell. That is where the flag currently lies, or FlagHome.
- Keep the legal cells that pass adjacency.
- Pick the smallest |dx|+|dy|.

**3. Zone placement** (stock TD).
- **Base centre C and radius R** (5989-6101):
  - C is the average of the own buildings' centres, each building weighted `cost/1000 + 1`.
  - R is the mean distance to C, at least 2 cells. It is 0x200 leptons if there is only one building.
- **Zones** (8874-8889):
  - CORE: within R of C.
  - NORTH, EAST, SOUTH, WEST: 90° sectors covering R to 4R.
  - Anything beyond 4R is in no zone.
- **Rating** (5873-5910):
  - For each zone, add the building's anti-air, anti-armour and anti-infantry strength, each capped at that zone's deficit against the average zone. Only positive deficits count, and the core's deficit is halved.
  - Pick the highest-rated zone. If all are 0, pick a random zone from N/E/S/W (5916-5923).
- **Cell choice:**
  - Pick a random point in the zone: within R of C for the core, or 2R to 3R out in that direction for a sector (9945-10018).
  - Take the legal cell nearest that point that passes adjacency and lies inside some zone (9878-9926).
  - If there is none, try every zone starting from a random one (5933-5951).
- **CrystAlien values:**
  - Only BD and BK are armed, and rockets count as anti-air only: Anti_Armor and Anti_Infantry are 0 for anti-air bullets (TECHNO.CPP:5215-5290).
  - So guns are spread by their anti-air strength, and every other building gets rating 0, which means a random N/E/S/W sector.

**4. Outpost** (5963-5966; `CAC_Outpost_Site`, CACLOGIC.CPP:7891-7940).
- For each own building outside all zones (more than 4R from the centre), take the cells within ±4 of it (a square) that are legal and pass adjacency.
- Pick the smallest |dx|+|dy|.
- This lets the computer grow a base out from a remote Driller.

**5. Nothing found.** Return 0, and the item is abandoned and refunded.

**Adjacency, CrystAlien's rule** (DISPLAY.CPP:897-929; CACLOGIC.CPP:7807-7859):
- A building with Power = Drain = 0 (BL, BI, BX) needs no anchor. BL must be on a crystal site instead.
- Any other building needs an own building whose Power or Drain is not 0 within **2 cells** of any cell of its footprint. A Driller is never an anchor.
- Nothing is ever placed on a crate, present or pizza cell (7559-7562).
- This is the target engine's own Placer rule; the AI only chooses the cell.

---

## 3. Unit production

### 3.1 Wants, hosts and suggestion order

**The four wants.** `BuildStructure`, `BuildUnit` (vehicles), `BuildInfantry` and `BuildAircraft`.
- Each is filled by its `AI_*` routine when empty; they are evaluated every tick.
- Each is cleared when a factory starts that exact type (Production_Begun).

**Hosts** (CACHOSTS.INC):
- The hosts are BA, BC, BE, BF, BJ and BK. Each host has its own queue and builds one item at a time.
- A type with a host is built only there.
- The miner UD may also be built at the BK of the miner's side (CACLOGIC.CPP:7206-7244).

**Starting production** (BUILDING.CPP:1306-1358; `CAC_Host_Suggestion`, CACLOGIC.CPP:8778-8847). An idle host of a started house with more than 10 credits takes the first match from this list:
1. `BuildUnit`, if this host builds it.
2. `BuildInfantry`, if this host builds it.
3. `BuildAircraft`, if this host builds it.
4. The want for the host's ToBuild category (structures for BA and BK), if that type is allowed here.
5. The wants of the other categories this host builds, if allowed here.

Consequences:
- A pending miner at the HQ (step 1) is built before the pizza (step 2) and before structures (step 4).
- While `BuildUnit` is a miner, a Vehicle Factory builds only its aircraft (the UH).

**[port]** The target engine has one building queue and one unit queue per player; the source runs up to six host queues in parallel. A reasonable serialisation:
- building queue ← `BuildStructure`;
- unit queue ← UJ if `BuildInfantry` is UJ, then a miner if `BuildUnit` is a miner, otherwise round-robin over `BuildUnit`, `BuildInfantry` and `BuildAircraft`, skipping any whose host building is missing.

### 3.2 Production ceilings, as they actually evaluate

**The gates.**
- `AI_Unit` stops when `CurUnits ≥ MaxUnit` (HOUSE.CPP:7890).
- `AI_Infantry` stops when `CurInfantry ≥ MaxInfantry` (8224).
- `AI_Aircraft` stops when `CurAircraft ≥ MaxAircraft` (8439).
- The `Cur*` counts include objects in production and passengers. `CurUnits` includes miners.

**How the ceilings are set.**
- `MaxUnit` starts at the lobby's starting-unit count (INI.CPP:2007).
- `Expert_AI` (6145-6267) runs this block whenever the Attack timer is 0 and the house has a base:
  1. Walk houses from enum 0.
  2. Average the hostile houses' current counts.
  3. Raise each `Max*` to that average + 10 if it is lower. It never lowers them.
  4. Pick `Enemy`: the closest and most dangerous hostile, weighted by distance, kills, base size and last attacker.
- The loop **stops at the first hostile house that has not "started"**.

**[code, derived by reading, not observed in a log]**
- GoodGuy (enum 0) is created, active, hostile to every Multi house and never runs AI, so it never "starts". The loop therefore stops at once, having averaged nothing.
- Results:
  - `Enemy` is **never** assigned.
  - `MaxUnit = max(starting units, 10)`.
  - `MaxInfantry = 10` and `MaxAircraft = 10`.
- **[gap]** `MaxInfantry` and `MaxAircraft` are never initialised in the source, so their prior value is undefined; normally 0, giving 10.
- **[intent]** The comments assume "enemies' average + 10" (HOUSE.CPP:7845-7849).
- The block needs `ActiveBScan && Center`, so a house with no buildings never gets its ceilings raised.

**Consequences.**
- The computer's standing army is limited to about 10 vehicles (miners included in the count), 10 infantry and 10 aircraft.
- The dead enemy clauses noted in §2.2 and §3.4 follow from `Enemy` never being set.
- **Exempt from the gates:** forced miners (§3.3) and the pizza purchase (§3.4) run before them.

### 3.3 `AI_Unit`: vehicles (HOUSE.CPP:7835-8015)

**1. Miners first** (7872-7887).
- `want` is the miner type's cap (4) if the house owns its own-side BA, otherwise the number of own-side BA owned (0).
- If `want > Miner_Count` (miners of either side, including those in production), set `BuildUnit = Miner_Type`. This requires IQ ≥ 2 (true) and the miner's Level (2) ≤ the tech level.
- This step overrides any pending `BuildUnit` and ignores `MaxUnit`.
- `Miner_Type` is the first buildable miner slot in enum order, normally the house's own side (7044-7056).
- **[code]** A house that lost its BA but holds BK never rebuilds miners (`want` is 0), even though BK could build them.

**2. Gates.** If `BuildUnit` is set, or `CurUnits ≥ MaxUnit`, stop (7889-7890).

**3. Team-based part.** Inert: there are no teams (7899-7978).

**4. Weighted random** (7982-8012).
- The pool is every vehicle type the house can build (tree, level and cap) except its own `Miner_Type`.
- Weight 20 if armed, 1 if unarmed (for example the other side's miner).
- No money check is made; the factory pays progressively.
- In practice:
  - Trike/Speeder only until BF stands.
  - Then Trike/Speeder and ClawTank/Dragon Cruiser at 50 % each.
  - An Astro house with a Driller adds the Crystal Reaper, giving about 1/3 each.

### 3.4 `AI_Infantry` (HOUSE.CPP:8146-8416)

**1. Pizza purchase** (Pizza Mode only, 8179-8221). Set `BuildInfantry = UJ` when all of these hold:
- credits ≥ 50,000;
- there is no pizza of this house or an ally on the map;
- UJ is not at its cap (1, counting one in production);
- Can_Build(UJ).

This overrides a pending choice and bypasses the ceilings.

**2. Gates.** If `BuildInfantry` is set, or `CurInfantry ≥ MaxInfantry`, stop.

**3. Values.** For each infantry type the house can build with Level ≤ the tech level:
- If `money > 3000 || CurInfantry < CurBuildings`, its value is `CAC_AI_Infantry_Value`; otherwise its value is 0.
- The enemy clause of this test is dead (§3.2).

**4. Pick.** Weighted random among the types with value > 0 (8404-8413).

**`CAC_AI_Infantry_Value` as it evaluates** (CACLOGIC.CPP:6244-6306):

| Type | Value |
|---|---|
| at its cap | 0 |
| UJ (Pizza Mode) | 100 if credits ≥ 50,000 and no own or allied pizza is on the map, else 0. Step 1 normally gets there first. |
| UB engineer/saboteur | 0 if this house already owns 2 of that slot, else **6** for the Alien slot and **4** for the Astro slot |
| UA, UM, UQ (armed, capped) | 5 |
| UN reindeer (unarmed, capped) | 1 |

**[code]** Every CrystAlien type carries a cap, so the later branches are unreachable: "reindeer 2" (6303) and "default armed 3" (6305).

### 3.5 `AI_Aircraft` and `CAC_AI_Aircraft` (HOUSE.CPP:8433-8507; CACLOGIC.CPP:6323-6480)

**Gate.** IQ ≥ 4 (true), `BuildAircraft` empty, and `CurAircraft < MaxAircraft` (10).

**`CAC_AI_Aircraft`:**
1. `pads` = the number of own buildings whose product category is aircraft, which means own BF of either side. If `pads` is 0, build nothing.
2. `owned` = all own aircraft objects, including those in production and passengers. If `owned ≥ 4 × pads`, build nothing.
3. Candidates are the CrystAlien aircraft types the house can build (tree, level and cap) that are not at their cap. Pick the type with the **fewest owned**, counting those on the map and aboard carriers. Ties go to the first in enum order: UC, UG, UH, UP, with good before evil.
4. **Hold-still rule** (6417-6439):
   - Once a non-NONE answer is decided, it is returned unchanged for 5 s (75 ticks from the decision), as long as it stays buildable and under its cap.
   - After that the answer is re-decided and held again.
   - The per-house state is the held type and the tick it was decided.

The candidates in practice are UC (BC+BG), UG (BF), UH (BF+BE+BG) and UP (BK; Special Ops on).

### 3.6 Money thresholds, all in one place

| Decision | Threshold |
|---|---|
| A host starts any production | credits > 10 (BUILDING.CPP:1330) |
| A plan entry | cost < credits, or `hasincome` |
| Barracks entry, extra condition | credits > 300 or `hasincome` |
| Factory entry, extra condition | credits > 2000 or `hasincome` |
| Infantry at all | credits > 3000 or `CurInfantry < CurBuildings` |
| Pizza | credits ≥ 50,000 |
| Building at ≤ 25 % health | repair if credits ≥ 1000, else may be sold |
| `Expert_AI` state BROKE | < 25. No effect on CrystAlien houses. |

---

## 4. The `CAC_AI_*` routines

**Terms used in this section:**
- **armed**: has a primary weapon.
- **engineer**: UB, either slot; a capture-capable infantry.
- **decoy**: CrystAlien infantry with no weapon that cannot capture. In practice that is the reindeer UN; UJ also qualifies but deletes itself on its first tick (CACLOGIC.CPP:3508-3514).
- **miner**: UD.
- **flag carrier**: a vehicle carrying a flag.
- **has destination / has target**: NavCom / TarCom is set.
- "Heap order" is creation-slot order. **[port]** Use the list order of your units array.

### 4.1 Aggression (CACLOGIC.CPP:3600-3792). Every 30 ticks (2 s).

**1. Last stand.**
- **Trigger:** the house owns **no BA and no BK** of either side (a building under construction counts as owned) **and** still has at least one building (3609).
- **Action**, repeated every pass:
  - Every armed, non-boomerang aircraft goes to HUNT.
  - Every unit and infantry the house owns goes to HUNT (Do_All_To_Hunt, HOUSE.CPP:9624-9665). This includes unarmed ones; unarmed infantry find nothing to hunt.
- The routine then returns.
- In CrystAlien, losing the HQ ends the game. Here the house survives and goes all out.
- Without any BA or BK its miners self-destruct anyway (§6.7).

**2. Normal pass.** Let `reclaim` = under attack (§4.3). Put these into **HUNT**:
- **Vehicles:** armed; not a miner; not a flag carrier; no destination and no target; mission is GUARD, or GUARD_AREA if `reclaim`.
- **Aircraft:** armed and not a boomerang (UG belongs to Sortie).
  - A **transformer (UP) is considered only with probability 1/20 per pass**. This is UnitHAL's `random(20)` throttle (3729).
  - Otherwise the same conditions as vehicles.
- **Infantry:** armed; not an engineer; not a decoy; no destination or target; GUARD, or GUARD_AREA if `reclaim`.

**Effect of the GUARD_AREA rule.**
- Units in GUARD_AREA are left alone unless the house is under attack. That covers patrols, flag guards, pizza campers, the starting army, freshly built armed units, and units back from an attack.
- Without this, aggression would reclaim every patrol within 2 s (playbook/06-ai-and-missions.md:167-185).

### 4.2 Sortie and the boomerang cycle (CACLOGIC.CPP:4371-4485, 10157-10446, 10507-10567, 10917-11124)

**Window.** The sortie acts on every tick while `Frame % 260 ≥ 228`. That is UnitHAL's "50 frames in every 400" converted to ticks.

**Who goes.** Each boomerang (UG) of the house that meets all of these:
- full ammo (10 of 10);
- no destination and no target;
- a home station exists: an own BF of *its* side, so UG_good needs BF_good and UG_evil needs BF_evil.

**Order given:** target = `House_Target`, destination = that building's centre cell, mission MOVE. The fighter flies *through*, not *at*.

**`House_Target`** (10384-10446). This is one shared target per house, the source's `friendlyTarget`.
- It is kept for 208 ticks (13.9 s), unless the target dies, changes hands or becomes allied, in which case it is re-rolled immediately.
- Re-roll:
  1. Make up to 2 × (number of building slots) uniform random picks over all buildings.
  2. Take the first pick that is active, alive, hostile, a legal target, not Pizza-protected and has threat > 0.
- The pick is random on purpose, not "best".

**The cycle.** This is per-craft behaviour and matches the source's UnitHAL/UnitNav, so the target engine's own boomerang code can be reused.
- **Firing.** The craft fires only at its assigned target when it is in range, while moving (`CAC_Strafe`). It never scans for other targets. It holds fire while descending below 3/4 of flight level; transformers are exempt (10469-10481).
- **Out of ammo.** At 0 ammo it drops its target and flies home to its station's dock tile. The trip home is re-issued once a second while it has no destination (10917-11075).
- **Rearming.** Within 3 cells of the station it gains +1 round every 20 ticks (11099-11124).
- **Losing the station.** If no station of its type remains, the craft is destroyed, one per tick (`CAC_Check_Home`, 10223-10337).

### 4.3 Under attack, and Raid (CACLOGIC.CPP:4494-4498, 4976-5147)

**Under attack.** A house is under attack when any own building took more than 0 damage from a non-allied source in the last 900 ticks (60 s). BuildingClass::Take_Damage records this (BUILDING.CPP:1644-1649). Damage to units does not count.

**Cadence.** `(Frame + houseEnum) % (threatened ? 180 : 450) == 0`, where `threatened` = under attack.

**Choosing the aim, in order.**
1. **Threatened.**
   - Anchor = the first own building in heap order.
   - Aim = the hostile, live, legal-target object of any kind (building, vehicle, infantry or aircraft) **on a cell this house has scouted** (§4.6) that is nearest the anchor.
2. **Revenue** (`CAC_Revenue_Target`, 4524-4571). Used if there is no aim yet and the house is Alien, **or** the game is in Pizza Mode.
   - Hostile Driller (BL): worth 3.
   - Hostile miner: worth `CAC_Load_Steps > 0 ? 2 : 1`. **[code]** `CAC_Load_Steps` returns the hold size (20) for every miner, so **every miner is worth 2**. **[intent]** 2 if loaded, 1 if empty.
   - Hostile BA or BK: worth 1. A Pizza-protected BA is excluded.
   - Take the highest worth, then the nearest to the own base centre. This step ignores scouting.
3. **Best assault** (`CAC_Best_Assault`, 4917-4955). Used if there is still no aim.
   - Candidates: hostile, live, legal-target buildings that are not Pizza-protected.
   - Worth 400 if the building produces anything (BA, BK, BC, BE, BF); every other building is worth 100. **[code]** BA and BK score 400, not the 300 their code line intends, because they also produce.
   - `score = worth × 32 / max(1, cells from own base centre)`. Take the highest. This step ignores scouting.
   - If there is no candidate, there is no raid.

**Who goes.** `want` = 8 if threatened, else 5.
1. Walk own **vehicles** in heap order. Take each that is:
   - armed, not a miner and not a flag carrier;
   - on a mission that is not ENTER, CAPTURE, HARVEST or UNLOAD;
   - not (has a destination AND mission is MOVE). This protects crate, pizza and flag errands.

   Order: target = aim, ATTACK.
2. Then own **aircraft**: armed, not a boomerang, no current target → ATTACK aim.
3. Stop when `sent = want`.

**Infantry never raid.** Hunters, patrols, flag guards and pizza campers are all eligible and are pulled in.

### 4.4 Patrol (CACLOGIC.CPP:4601-4780). Every 300 ticks (20 s), phase 13·id; skipped while under attack.

1. **Count.** `armed` = armed vehicles that are not miners or flag carriers, plus armed infantry that are not engineers or decoys.
   - If `armed < 4`, stop.
   - `want = floor(armed / 2)` and `round = floor(Frame / 300)`.
2. **Send.** Walk vehicles, then infantry, in heap order, until `sent = want`.
   - **Eligible if** (4637-4693):
     - mission is GUARD, HUNT or GUARD_AREA;
     - no destination and no target;
     - not guarding the flag (§5.2).
   - **Slot:** `slot = (sent + round) % 9`, one of the nine ninths of the map (3 × 3).
   - **Point** (4601-4634), up to 8 tries:
     - `x = X0 + floor(W·(slot%3)/3) + rand(0 .. W/3−1)` (the random offset only if W/3 > 1);
     - `y = Y0 + floor(H·floor(slot/3)/3) + rand(0 .. H/3−1)`;
     - the cell must be on the map and passable for the unit's movement class (infantry: foot).
   - If no point is found, skip the unit; `sent` does not advance.
   - **Order:** clear target; destination = point; **anchor = point**; GUARD_AREA.
3. Slots rotate each round, so over a few minutes the force sweeps the map instead of picketing it.

### 4.5 Repair
See §2.7. In short: while the house holds any BA or BK, every damaged building is set to repair, checked every 7 ticks.

### 4.6 Scout memory (CACLOGIC.CPP:5447-5563). Every 15 ticks, phase 5·id.

- **The record.** For each house there is one sticky bit per cell.
- **Filling it.** Each pass, for every own building, unit, infantry and aircraft, set the bit for every cell within a **circle of radius = its sight** (tiles, minimum 1) around it.
- **Clearing it.** Never during a match. It is reset at scenario start (SCENARIO.CPP:334).
- **Humans** always count as having scouted everywhere.
- **Where it is used — only here:**
  - the threatened-raid aim (§4.3);
  - `CAC_Best_Raid` (§4.7), which drives infiltration and airlift;
  - `CAC_Unscouted_Point`.
- **Where it is not used:**
  - hunts, which are omniscient;
  - revenue and best-assault raids;
  - the fighters' house target;
  - the superweapon.

### 4.7 Infiltrate: engineers and saboteurs (CACLOGIC.CPP:6001-6164). Every 15 ticks, phase 7·id.

The routine handles each own engineer that is not in a transport and not on its way into one (mission ≠ ENTER).

**1. If it has a destination:**
- **`taking`** = the mission is CAPTURE (or SABOTAGE).
- If `taking` and the destination is no longer worthwhile, clear the destination and continue at step 2.
  - Worthwhile means a live, hostile (not own, not allied) building that can currently be captured (5885-5895).
- Otherwise, if it is **not stalled**, leave it alone for this pass.
- Otherwise it is stalled:
  - if `taking`, remember that building as `giveup`;
  - clear the destination and continue at step 2.
- **Stall test** (5916-5963). This is per man and per destination.
  - Each pass, compare the distance to the destination.
  - If it improved by more than 128 leptons (half a cell), reset. Otherwise add a strike.
  - After **10 strikes (about 10 s)** the man is stalled, and the counter resets.
  - A new destination restarts the count.

**2. Pick a target:** `best = CAC_Best_Raid(from = man, avoid = giveup)` (5566-5608).
- Candidates: hostile live buildings that can be captured (capturable, not being sold, not Pizza-protected), on a **scouted** cell, not the avoided building, with `Raid_Worth > 0`.
- Take the highest worth, then the nearest.
- **`CAC_Raid_Worth`** (5353-5411) is 0 unless the building is capturable and has threat > 0. Otherwise:

| | BA | BK | BL | other |
|---|---|---|---|---|
| Pizza Mode | 0 | 2 | 8 | 1 |
| Normal, Alien asker | 3 | 3 | 4 | 1 |
| Normal, Astro asker | 3 | 3 | 2 | 1 |

**3. If `best` exists:** destination = best, mission CAPTURE, then `Escort(best, 2)`.
- **Escort** (3537-3549): up to 2 free decoys go to MOVE to the target building's cell. A free decoy is a reindeer with no destination in GUARD or GUARD_AREA, taken first-found in heap order.

**4. Otherwise explore.** Look for `CAC_Unscouted_Point(house, man)` (5836-5871):
- Consider the centres of the 9 ninths: `x = X0 + W·(1+2·(s%3))/6`, `y = Y0 + H·(1+2·floor(s/3))/6`.
- Keep those that are unscouted, foot-passable and at least 512 leptons (2 cells) away from the man.
- Take the nearest.
- If one is found and it is not the man's own cell, MOVE there.

**5. Otherwise rally** (5977-5998).
- Rally cell = the dock exit cell of the nearest own building (`CAC_Exit_Cell`), or that building's centre.
- If there is no such building, or the man is already there, set GUARD.
- Otherwise MOVE there.

**On arrival** (CACLOGIC.CPP:578-630):
- An enemy building is captured.
- A damaged own or allied building is fully repaired.
- The engineer is consumed either way.
- Capturing a headquarters hands over that side's whole build tree (§9.2).

### 4.8 Airlift (CACLOGIC.CPP:5685-5797). Every 15 ticks, phase 11·id.

**Setup.** `boarding` = the number of own infantry currently in ENTER, heading for any transport.

**Step A: dispatch.** For each own transport aircraft (UH):
1. Skip it if it is unloading or already has a destination. This is per transport: `continue`, not `return` (§10).
2. It is **ready** if it holds a passenger AND (it is full with 6, OR `boarding == 0`) (5675-5682). If not ready, skip it.
3. `best = CAC_Best_Raid(from = transport)`. If there is none, **stop the whole routine**; that answer is house-wide.
4. LZ = the nearest free passable cell to `best` (`Map.Nearby_Location`). If there is none, skip.
5. Order: destination = LZ, UNLOAD. Then **stop**: at most one dispatch per pass.

**Step B: load.**
1. `ride` = the first own UH with no destination, mission GUARD or GUARD_AREA, and `passengers + boarding < 6`.
2. If there is no ride, or no `CAC_Best_Raid` target from it, stop.
3. For rank 0, then 1, then 2, take the first own infantry with that raider rank that:
   - is not in ENTER or CAPTURE;
   - has no destination;
   - is not guarding the flag.

   Ranks 1 and 2 are only allowed if the ride already holds a passenger.
4. Order it to ENTER the ride. Then **stop**: at most one boarding order per pass.

**Raider rank** (5649-5661):
- −1: not carriable, or unarmed (this excludes reindeer);
- 0: engineer;
- 1: UQ or UM;
- 2: other armed carriable infantry (UA).

**[code] What actually happens:**
- The first passenger is always an engineer.
- The transport departs as soon as it holds anyone and nobody is walking to any transport.
- So escorts only board while a second passenger is still walking, and often the transport **flies with a single engineer**. **[intent]** It should leave full, or with an engineer plus escorts.
- Engineers are also grabbed by Infiltrate on its own 1 s cadence, and a man with a destination cannot board. Which routine gets a new engineer depends on phase order.
- After unloading, passengers are idle: Infiltrate picks up the engineers, and Aggression picks up the armed ones.

### 4.9 Collect: crates and pickups (CACLOGIC.CPP:5150-5348). Effectively every 105 ticks (7 s); see §1.2.

1. **Count errands.**
   - `force` = own units plus infantry on the map.
   - `errands` = those whose destination cell holds a crate-type overlay: crystal box, capsule, present, **or any pizza**.
   - `allowed = min(3, 1 + floor(force / 12))`. If `errands ≥ allowed`, stop.
2. **Pick a collector.**
   - First choice: the first free decoy (a reindeer in GUARD or GUARD_AREA with no destination).
   - Otherwise the **first own vehicle** in heap order, armed or not, that is:
     - not a miner and not a flag carrier;
     - on a mission that is not MOVE, ENTER, CAPTURE, HARVEST or UNLOAD;
     - either without a destination, or on mission GUARD_AREA, ATTACK or HUNT. An errand outranks a fight or a patrol (5247-5280).
   - Other infantry never collect. If no collector is found, stop.
3. **Pick a target.** The nearest crate-type cell to the collector.
   - Crates already claimed by another errand are **not** excluded.
   - Pizzas are included: the house's own pizza (collecting it wins the game) and rivals' pizzas (walking over one does nothing).
4. **Order:** clear target; destination = that cell; MOVE.

Computer units can enter a crate cell **only when it is their destination** (§7.3).

### 4.10 Idle watch (CACLOGIC.CPP:1891-1985). Every tick.

**Scope.** Every own unit, infantry and aircraft, except:
- miners;
- anything on mission UNLOAD, CONSTRUCTION, DECONSTRUCTION or SLEEP.

A unit is watched only while it has a destination or a target.

**Rule.**
1. `held` counts consecutive ticks in the same cell. It resets when the unit changes cell or has neither destination nor target.
2. At `held = 65` (4.3 s), re-issue the same destination: clear it, then set it again, which forces a re-path.
3. At `held ≥ 195` (13 s), unless the mission is ENTER:
   - clear the destination and the target;
   - enter idle mode (§0.5);
   - reset `held`.

This mirrors the source's UnitNav `still > 100` frames → drop the path rule (CACLOGIC.H:75-83).

### 4.11 Diagnostic-only routines
`CAC_AI_Census` (4800-4896), `CAC_Miner_Stuck` (1988-2036), `CAC_Watch_Factories` (11431) and `CAC_Roll_Call` (11569) only write log lines. There is nothing to port.

### 4.12 Who can take a unit from whom

The file states its own priority: **errand > raid > patrol**, and "an errand outranks a fight" (3913-3916, 5256-5276). As implemented, each unit state can be re-tasked as follows.

**Idle GUARD, with no destination or target.** Any of:
- Aggression (→ HUNT);
- Patrol;
- Raid (vehicles);
- Collect (decoys and vehicles);
- the Flag routines;
- Pizza fetch or camp;
- stock AI_Attack (§6.4).

**GUARD_AREA with no orders** (patrol post, flag post, pizza camp, new or starting unit):
- Patrol (re-slot);
- Raid;
- Collect;
- Flag guard (re-post);
- Pizza;
- AI_Attack, with 75 % chance in attack cycles.
- Aggression takes it **only when the house is under attack**.

**HUNT or ATTACK with a target:**
- Can be taken by Raid (re-aim), Collect (vehicles), Flag runner or chase, Pizza runner or camp, and AI_Attack.
- **Not** by Patrol, Aggression or Flag guard.

**MOVE errand** (crate, pizza, flag, exploring):
- Can be taken by the Pizza runner or camp, the Flag runner or chase, and AI_Attack.
- **Not** by Raid, Collect, Patrol, Aggression or Flag guard. Crate errands are also protected from the Flag routines.

**CAPTURE or ENTER:** only the Pizza runner can take it. AI_Attack affects only armed units, and engineers are unarmed.

---

## 5. Game modes

### 5.1 Pizza Mode

**Selecting it.** In the conversion build, the skirmish mode "Destroy Structures" means Pizza Mode (DLLInterface.cpp:680, 706-711; CACLOGIC.CPP:2074-2083). It is never active in the campaign.

**The Pizza Delivery (UJ; both slots).**
- Costs **50,000** (CACSTATS.H:466).
- Build time is pinned to the source's 5000: `5000 × 15/184 = 407 ticks ≈ 27 s`, doubled on low power (CACLOGIC.CPP:7051-7054).
- Hosted at the HQ (BA). It has no prerequisite apart from Pizza Mode being on (2759).
- Cap 1, counting one in production. Level 1.

**Delivery** (INFANTRY.CPP:1274-1278; CACLOGIC.CPP:2203-2263). On its first tick the UJ is deleted and becomes a pizza.
1. **Site** (2126-2180): try up to 100 random map cells. Take the first that meets every condition:
   - clear, with no overlay;
   - crate-ground OK (§7.1);
   - reachable: a flood fill finds at least 96 track-passable cells;
   - no building drawn over it;
   - no overlapping object and no occupier.

   If no site is found, **the money is lost and nothing appears**. The AI will simply buy again.
2. Place the pizza overlay in the buyer's colour; the cell's owner = the buyer.
3. A human buyer gets a circle of radius **12 cells** revealed (CACLOGIC.H:162).
4. Non-allied local players hear the power-warning alarm.
5. The pizza shows on everyone's radar and cannot be shot (ODATA.CPP:564-593).

**Collection** (CACLOGIC.CPP:2277-2338; CELL.CPP:2102-2104). The engine treats the pizza as a crate.
- Any unit entering the cell whose house is the owner or an ally of the owner:
  - the pizza is removed;
  - **every house not allied with the collector is destroyed** (`Flag_To_Die`: everything blows up after 1 s, HOUSE.CPP:5176-5188, 1140-1149);
  - the collector's team wins.
- Anyone else walking over it: nothing happens, and it is not consumed.

**HQ protection** (BA only; BK/Hive is **not** protected) (CACLOGIC.CPP:2551-2560):
- takes no damage (BUILDING.CPP:1625-1628);
- cannot be captured (4524);
- is excluded from every target picker: Evaluate_Object (TECHNO.CPP:1466-1469), opportunity fire (CACLOGIC.CPP:10617-10620, 10746), raids, the house target and Best_Raid;
- can never be sold (1834-1851).

Nobody can therefore be defeated except through the pizza. The short-game rule is off (HOUSE.CPP:5484-5486).

**Stipend.** Every house, including humans, gets **+400 credits every 900 ticks (60 s)**, staggered by `7 × houseEnum` ticks, unless defeated (CACLOGIC.CPP:2533-2548; CACLOGIC.H:160).

**Mode-specific AI.** The Driller is asked for at **CRITICAL** (§2.2 #10). Raids use revenue targeting for every house (§4.3). `Raid_Worth` uses the pizza table (§4.7).

**`CAC_AI_Pizza`** (2401-2530). Every 15 ticks, computer Multi houses only.
- `mine` = the first pizza cell (in cell order) owned by this house or an ally. `theirs` = the first owned by a non-ally.
- **Fetch.**
  - If no own unit or infantry already has a pizza cell as its destination, pick a runner.
  - Runner = the **fastest** own vehicle or infantry by MaxSpeed; ties go to the first found. It must not be a miner; it can be armed or not, and busy or not.
  - Order: clear target; destination = `mine`; MOVE.
- **Camp.** If `theirs` exists, walk vehicles, then infantry, in heap order, until 4 are posted.
  - Eligible: armed, not a miner, not a pizza runner.
  - A unit already in GUARD_AREA anchored on that cell counts as posted.
  - Units in CAPTURE or ENTER are skipped.
  - Order: clear target; destination = anchor = `theirs`; GUARD_AREA.
- **Purchase:** see §3.4 step 1.
- **Also:** Collect (§4.9) may send a unit to a pizza because the pizza counts as a crate, and walking a unit onto its own pizza wins.

### 5.2 Capture the Flag (skirmish mode "Capture The Flag")

**Rules** (stock TD plus the conversion's changes):
- **Start** (INI.CPP:1922-1946). Each house's flag is planted on the **nearest clear cell in rings 1..6 around its HQ centre** (`CAC_Flag_Site`, CACLOGIC.CPP:3863-3900). The cell must be:
  - track-passable, with no overlay;
  - not already holding a flag;
  - free of any occupier and with no building drawn over it.

  That cell becomes FlagHome.
- **Pick-up** (UNIT.CPP:2153-2158). **Vehicles only**; infantry and aircraft can't carry flags (`Flagged` exists on UnitClass only).
  - A vehicle that carries nothing picks up a non-allied house's flag lying at its cell centre.
  - A house can never pick up its own flag.
- **Score** (2164-2183). A carrier that reaches the centre of **its own house's FlagHome** destroys the house whose flag it carries, after 1 s.
- **Drop.** If the carrier is destroyed, removed or stunned, the flag drops on its cell. FlagHome is unchanged (3989-3991, 4727-4729).
- The carrier of your flag is revealed to you (2171-2173).
- Every 90 ticks (6 s), each house scatters a non-moving unit standing on its FlagHome cell (HOUSE.CPP:1205-1229).
- A defeated house's flag is removed (4732-4740).
- **[code]** CTF with Bases Off gives each house a Trike or Speeder but never attaches a flag (INI.CPP:1975-2001), so there are effectively no flags.

**`CAC_AI_Flag`** (CACLOGIC.CPP:4020-4119). Every 7 ticks.
1. **Carry home.** Each own carrier is sent to MOVE to its FlagHome, unless it is already there or already heading there. This is re-asserted every pass.
2. **Chase the thief.** If a hostile vehicle carries our flag, every own vehicle that is armed, not a miner, not a carrier and not already targeting it → ATTACK the thief. Infantry and aircraft are not sent.
3. **Go for a flag.**
   - Take the enemy flag lying on the ground nearest the own base centre. A carried flag doesn't count.
   - If any own vehicle already has that cell as its destination, do nothing.
   - Otherwise runner = the fastest own vehicle that is not a miner, not a carrier and not on a crate errand; ties go to the first. Order: MOVE there.

**`CAC_AI_Flag_Guard`** (4130-4258). Every 30 ticks.
- **Flag cell** = where our flag currently lies, or FlagHome if it lies nowhere. If it is being carried, do nothing.
- **Spare** = the fastest own non-miner vehicle. It is never posted, so it stays free to score.
- **Want.** `armed` = armed non-miner vehicles plus armed non-engineer, non-decoy infantry. `want = max(2, floor(armed / 3))`.
- **Posting.** Post in three passes:
  1. infantry of rank 0: UQ Commander and UM Santa;
  2. other armed infantry;
  3. vehicles, excluding carriers and the spare.
- A unit already in GUARD_AREA on the flag cell counts as posted.
- Skip any unit that has a target or is on a crate errand.
- Order: clear target; destination = anchor = flag cell; GUARD_AREA.

**Other flag interactions.**
- **Guns near the flag:** §2.8 step 2.
- **Leave flag guards alone:** Patrol and Airlift.
- **May pull flag guards away:** Raid, Pizza and stock AI_Attack.

### 5.3 Normal (Destroy All)
- **Defeat.** A house is defeated when it has no active buildings, no active aircraft, no units and no active infantry (HOUSE.CPP:1780-1783).
- **Victory.** The last house or team standing wins (4797-4856).
- **Losing the HQ** is not defeat, unlike CrystAlien, where it is. It triggers the last stand instead (§4.1).
- **Supporting stock rule.** The Fire sale (§6.4) sells off a base that has no production building left.

---

## 6. Stock Tiberian Dawn behaviours the AI relies on

### 6.1 Guard area (FOOT.CPP:1040-1089)
With `anchor = ArchiveTarget` (or the unit's current cell, if no anchor is set), the unit does the following each pass (≈1 s):
1. **Miners.** A miner goes back to HARVEST.
2. **Off-map anchor.** If the destination is off the map, clear the orders and re-anchor on the current cell.
3. **Leash.** If the unit has no destination and either:
   - it is more than `max weapon range + 1 cell` from the anchor, or
   - it has no target and is more than 2 cells from the anchor,

   then drop the target and walk back to the anchor.
4. **Acquire.** If it has no target, look for one within **2 × weapon range** of the *anchor*. The distance is capped at 0xA00 leptons, i.e. 10 cells (TECHNO.CPP:4186-4195). If one is found, approach and attack it.

### 6.2 Target selection

**Value of a candidate** (`Evaluate_Object`, TECHNO.CPP:1447-1649).

A candidate is never chosen if it is:
- allied;
- in limbo;
- a Pizza-protected HQ;
- cloaked;
- not a legal target;
- outside the scan range;
- the wrong class for the mask. Lasers get no air mask; rocket-armed units add aircraft (FOOT.CPP:2020-2037).

A **human** player's units never auto-pick an unarmed building (1553). Visibility is **not** checked in skirmish (1488), so the computer "sees" everything.

**For CrystAlien targets** (1586-1590):
```
value = threat × 4096 + max(0, 4095 − distance_in_cells)
```
That is: threat first, nearest second.

**HUNT** (FOOT.CPP:704-717; TECHNO.CPP:4664-4690, 1885-1957):
- A full-map scan: the **highest-threat enemy anywhere**, nearest among equals, with exact ties picked at random.
- The target is kept until it becomes illegal (dead or captured). The unit then re-picks; the mission ticks every 20 ticks.

**Threat table** (CACTHREAT.INC via CACSTATS.H):

| Threat | Types |
|---|---|
| 10 | UM Santa, UQ Commander |
| 8 | BD, UG |
| 7 | BH, UF, UR |
| 5 | BG, UB, UN |
| 4 | UE, UC, UH, UP |
| 3 | BB, BC, BE, BF, BJ, UA |
| 2 | BA, BK, UD |
| 1 | BL |
| 0 | UJ, BI |

**GUARD** scans within weapon range. **GUARD_AREA** scans within 2× range of the anchor, as in §6.1.
- **[code quirk]** The ring scan used by these two never updates its running best (TECHNO.CPP:1813-1882).
- It returns the *last* candidate found in the first radius band that contains any, so in practice distance, not threat, decides.
- **[port]** Prefer the intended threat-then-distance rule.

**Opportunity fire** (`CAC_Opportunity_Fire`, CACLOGIC.CPP:10600-10771). This runs every tick for every armed CrystAlien unit without an assigned target, except boomerangs and fliers that are descending.
- It picks the highest threat (≥ 1) within weapon range.
- Buildings are scanned first, then vehicles, infantry and aircraft; on a tie, the later-scanned candidate wins.
- It fires without changing any orders.
- This is the source's `engageEnemy`, so the target engine's own version should be reused.

### 6.3 Retaliation and base defence

**Retaliation** (FOOT.CPP:1241-1272). A computer unit that takes damage from a non-allied source switches to **HUNT with the attacker as its target** when all of these hold:
- it is armed, and can hit aircraft if the attacker is one;
- it is in GUARD, GUARD_AREA, ATTACK, AMBUSH, RESCUE or TIMED_HUNT;
- it has no target, or its current target is out of range or unarmed.

**Base defence** (`Base_Is_Attacked`, TECHNO.CPP:4215-4426).
- **Triggers:**
  - an **unarmed** computer building is hit by an enemy vehicle or infantry (BUILDING.CPP:1654);
  - a computer **miner** is hit (UNIT.CPP:1187-1189).
- **Response timer.** The response fires only if that attacker's timer has expired. Afterwards the timer is set to 225 ticks (15 s).
- **Candidates.** The house's own infantry and vehicles, excluding any that:
  - are in a team;
  - are harvesting;
  - are in STICKY or SLEEP;
  - are already fighting an armed target.
- **Score.** `Risk × 256 / max(1, (distance − weapon range) / speed)`. A candidate already targeting the attacker reduces the need instead.
- **Selection.**
  - Need = 2 × the attacker's risk = 100.
  - Take up to 6 of the best candidates, sorted by score, and assign them **RESCUE**, which means attack the attacker.
  - Keep assigning until their combined risk exceeds 100. With every unit at risk 50, that is **3 defenders**.

**Miners.** A loaded miner that is damaged below 50 % health heads home (UNIT.CPP:1167-1180).

### 6.4 Stock `Expert_AI` (HOUSE.CPP:6119-6412)

`Expert_AI` runs every ≈5.1-5.5 s. For a CrystAlien house it has only three live effects.

**1. Ceilings and Enemy.** See §3.2.

**2. Fire sale** (6507-6527, 6743-6753). If all of these hold:
- the house owns **no host building** (BA, BC, BE, BF, BJ or BK; `CAC_Has_Factory`, CACLOGIC.CPP:9638-9646);
- it still has buildings;
- no building was hit in the last minute;

then it sells every building (BA and BK refuse) and sends everything to HUNT.

**3. Periodic attack** (`AI_Attack`, 6600-6694). This fires after the first minute, whenever the Attack timer is 0:
- **Attack cycle.** With a 1/3 chance (or when the house has no buildings), every armed aircraft, vehicle and infantry of the house goes to HUNT with a **75 % chance each**, whatever its current orders.
  - Boomerangs only go with full ammo.
  - This can pull patrols, flag guards, campers and runners away.
- **Shuffle.** Otherwise, and for the 25 % not sent, each vehicle or infantry in GUARD_AREA inside a base zone has a 20 % chance to re-anchor at a random point 2-3 base radii out in a random N/E/S/W sector (`Where_To_Go`, 9118-9134).
- **Next attack.** Attack timer = `3 × Random(450..1800)` ticks, i.e. **90-360 s**.

**Inert for CrystAlien houses.** The stock power and money sell-offs (AI_Raise_Money, AI_Raise_Power, AI_Lower_Power) name only stock buildings. So do the build-power, defence, offence and income strategies.

**No waves or teams.** Skirmish has no TeamTypes, the alert timer does nothing, blitz is off, and paranoia is disabled for GlyphX (HOUSE.CPP:9786).

### 6.5 Difficulty, IQ and Rules

**No per-AI difficulty in skirmish.** Every computer house has IQ = MaxIQ = 5 and handicap NORMAL (HOUSE.CPP:521, 527), and the lobby has no AI difficulty.
- `Difficulty` only matters in branches guarded by `GameToPlay == GAME_NORMAL` (the campaign).
- The handicap biases (`Rule.Diff`) come from the client at runtime and are the same for every computer. **[gap]** Their exact values are not in the source.

**IQ thresholds actually used:**
- IQProduction 5: base building is on.
- IQHarvester 2: forced miners.
- IQAircraft 4: aircraft production.
- IQGuardArea 4: idle units go to GUARD_AREA.

**Rule values** (RULES.CPP:90-126):
- AttackInterval 3, PowerSurplus 50, PowerEmergencyFraction 0xC0 (inert).
- Ratios and limits as in §2.3.
- InfantryReserve 3000, InfantryBaseMult 1.
- BaseSizeAdd 3 (unused), MaxIQ 5.
- IsComputerParanoid true, but disabled in GlyphX.
- AllowSuperWeapons comes from the lobby.

**Build times.** CrystAlien build times ignore difficulty and IQ (TECHNO.CPP:315-329).

### 6.6 Superweapon (HOUSE.CPP:1522-1731, 3213-3425; CACLOGIC.CPP:1263-1331, 8198-8275)

**Getting it.** A computer house that owns any uplink (BH of either side), with the lobby's superweapons on, gets **one** superweapon (the ion slot) (1591-1611).
- Only humans can get the second uplink slot (1668).

**Charging.** 10 min to charge (DEFINES.H:321), paused while power is LOW (1538, 1563).

**Firing** (`Special_Weapon_AI`, 3213-3242). When ready, the computer fires at the hostile building with the highest `Value`.
- `Value` = Risk + Reward + the value of anything inside the building.
- Every CrystAlien building scores 0 + 80, so in practice the target is the **lowest-heap-index hostile building**, unless one holds a passenger.
- The picker is not scouting-aware. It is not Pizza-aware either, but a protected HQ takes no damage anyway.

**Blast.** Radius 400 px (1066 leptons ≈ 4.2 tiles).
- Damage = `1000 × (1 − d/R)`.
- It hits **everything**, own units included, up to 256 objects.

### 6.7 Miners and income (context; the target engine has its own)
- **Computer miners.** In GUARD they go back to HARVEST (UNIT.CPP:4472-4475). New miners harvest at once (BUILDING.CPP:2648-2651).
- **Losing the HQ.** A miner whose house owns no BA and no BK (either side) is destroyed immediately (CACLOGIC.CPP:10247-10286). Miners unload at either side's BA or BK (526-546).
- **Miner income.** A full load is 20 mouthfuls × 10 = 200 cargo, paying ×5, so **1000 credits** (6659-6692).
- **Driller income.** 100 × 5 = **500 credits every 196 ticks**, staggered by building (6816-6839; CACSTATS.H:276-277).

---

## 7. Crates

### 7.1 Placement (MAP.CPP:1100-1181; INI.CPP:676-688)

**Initial crates.** At match start, if crates are on, one crate is placed per player (`MPlayerCount` counts every player, human and computer).

**Choosing a cell.** Make up to 100 random picks. The first cell that meets all of these gets the crate:
- clear, with no overlay;
- template ground OK: the cell's terrain template has LAND_CLEAR for both its land and its alternate land (`CAC_Crate_Ground_Ok`, CACLOGIC.CPP:8352-8369);
- reachable: a 4-neighbour flood fill over track-passable cells reaches ≥ 96 cells (8372-8408).

**Choosing the kind.** Roll 1..9 (1122-1157):

| Christmas allowed | 1 | 2-3 | 4-9 |
|---|---|---|---|
| on | present | Alien capsule | crystal box |
| off | Alien capsule | Alien capsule | crystal box |

So with Christmas on: present 1/9, capsule 2/9, box 6/9. With it off: capsule 3/9, box 6/9.

### 7.2 Respawn
- **[intent]** (LOGIC.CPP:175-200) Every `Random(1..3) × 900` ticks (1-3 min), if fewer crates are on the ground than at the start, place one more.
- **[code]** The target is `CAC_CrateTarget = CrateCount`, taken after the start placement. `Place_Random_Crate` writes the overlay directly and never increments `CrateCount`.
  - Only map-placed crate overlays increment it, and multiplayer skips those (OVERLAY.CPP:370).
  - So the target is 0 and **crates never respawn**.
  - The custom-map loader never sets the target at all (INI.CPP:1064-1072).
- **[port]** Decide which behaviour to reproduce. The intent is: top up toward the starting count, one crate per 1-3 min.

### 7.3 Who collects
- **Ground units (vehicles and infantry)** collect a crate by entering its cell:
  - the crystal box and the present when the unit starts moving into the cell (FOOT.CPP:848; DRIVE.CPP:1196);
  - the capsule when the unit arrives (FOOT.CPP:1582).
- A **landed Switch Fighter** also collects (AIRCRAFT.CPP:828-853). Other aircraft never do.
- **Computer units cannot enter a crate cell unless it is their destination** (UNIT.CPP:3547-3574; INFANTRY.CPP:1893-1919). The same applies to presents and pizzas.
  - So the computer collects only through Collect (§4.9), the pizza runner (§5.1), or a destination that happens to lie on a crate.
  - Humans collect freely.

### 7.4 Effects (`CAC_Crate_Effect`, CACLOGIC.CPP:2933-3178)

**Crystal box: a free unit for the finder.**
1. Draw one of 52 table entries (2994-3047).
2. Place the unit on the crate cell if nobody occupies it, otherwise on the nearest free cell.
3. If placement fails, try the next entries cyclically. If all 52 fail, pay **2000 credits** instead.

The unit keeps its own faction: a finder can get the other side's unit. **[code]** Two quirks change the odds from the table:
- aircraft entries always fail, because `AircraftTypeClass::Create_And_Place` returns false (AADATA.CPP:730-733);
- caps are **not** checked (UDATA.CPP:1781-1788; IDATA.CPP:1855-1866).

| Result | Effective odds |
|---|---|
| UE_evil Speeder | 9/52 |
| UF_good ClawTank | 9/52 |
| UB_evil Saboteur | 10/52 (includes the 7 JetPack entries falling through) |
| UA_evil Drone | 7/52 |
| UD_evil Crystal Extractor | 5/52 (includes 4 failed aircraft entries) |
| UE_good Trike | 3/52 |
| UF_evil Dragon Cruiser | 3/52 |
| UA_good Infantry | 2/52 |
| UB_good Engineer | 2/52 |
| UD_good Crystal Miner | 1/52 |
| UR_good Crystal Reaper | 1/52 |

**[intent]** The table lists 11 aircraft entries (UC, UP) meant to spawn aircraft.

**Alien capsule.** **+10,000 credits** to the finder's house.

**Present.**
- The first present unlocks Santa's Sleigh (the house's own-side BJ) for the finder's house. No unit appears.
- If the house already has it unlocked, the present pays +10,000 credits instead.

**Unused outcomes.** `POWERUP` and `ENEMY_UNIT` exist in code but no table uses them.

**Pizza.** A pizza is also a crate to the engine (§5.1).

---

## 8. Skirmish options the mod reads (DLLInterface.cpp:669-741)

| Lobby control | Field | What it means in the conversion | Effect | Refs |
|---|---|---|---|---|
| "Redeployable MCV", relabelled Allow Special Ops | `Special.IsMCVDeploy` | Special Ops allowed | Off: BK, BL, UQ, UP and UR are unbuildable for everyone. The campaign always allows them. | 677; CACLOGIC.CPP:1622-1632, 2589-2601 |
| "Spawn Visceroids", relabelled (tech tier) | `Special.IsVisceroids` | Special Ops needs the Technology Centre | On: BK needs own HQ **and** own BG, instead of own BA. The Driller stays behind BK, so Astro income comes a tier later. The AI asks for BG at HIGH, and for the first BK at HIGH. Visceroids never appear in the conversion. | 678; 1760-1770, 2657-2659; HOUSE.CPP:7545-7547, 7746 |
| "Modern Balance", relabelled | `Special.ModernBalance` | Christmas allowed | Whether presents appear among crates (§7.1). | 681; 2563-2573 |
| Mode: Destroy Structures | `DestroyStructures` → `IsEarlyWin` and `CAC_IsPizza` | **Pizza Mode** | §5.1. The short game never runs in the conversion. | 680, 706-711; HOUSE.CPP:5484-5490 |
| Mode: Capture The Flag | `IsCaptureTheFlag` | CTF | §5.2 | 679 |
| Mode: Bases Off | `MPlayerBases = 0` | No HQ at start | Nothing can be built, because the tree needs an HQ. With CTF there are no flags. | INI.CPP:1810-2002 |
| Mode: Destroy All | default | Normal | §5.3 | – |
| Superweapons | `EnableSuperweapons` → `Rule.AllowSuperWeapons` | Uplink superweapon | §6.6 | 713; HOUSE.CPP:1591, 1668 |
| Crates | `MPlayerGoodies` | Crates on/off | §7 | 672 |
| Tiberium regrows | `MPlayerTiberium` | Crystal growth and spread | 0: none. ≥ 1: growth and spread on. > 1: adds `(value−1)×2` extra growth and spread steps per map pass (below). | 735-741; MAP.CPP:898-1030 |
| Credits | `MPlayerCredits` | Starting cash | – | 670 |
| Starting units | `MPlayerUnitCount` | Starting army; also the initial `MaxUnit` | 2/3 vehicles (UE/UF), 1/3 infantry (UA), per tech-level tables; computer units start in GUARD_AREA | 675; INI.CPP:1581-2132 |
| Tech level | `BuildLevel` | Type level filter | Types with Level > setting cannot be built, by humans or computers. Levels are in §0.4. | HOUSE.CPP:595-598; DLLInterface.cpp:1255 |

**Crystal growth (stock).** 30 cells are scanned per tick. After each full pass (≈ 137 ticks), the map applies `tries` growth steps and `tries` spread steps (MAP.CPP:911-1030):
- `tries = 2`, plus `(MPlayerTiberium − 1) × 2`.
- **Growth step:** pick a random crystal cell with density < 11 and add 1.
- **Spread step:** pick a random heavy cell (density > 6) and put new crystal in a random adjacent clear cell. The new cell must not be under a building or on a flag (`CAC_Crystal_Spread_Ok`, CACLOGIC.CPP:7612-7624).

Miners never strip a cell below 1 (CACLOGIC.CPP:3356-3379). The target engine's bait model replaces all of this.

---

## 9. The tech tree as implemented

### 9.1 `CAC_Prereq_Met` (CACLOGIC.CPP:2576-2769)
- **Scope.** Applies to every CrystAlien type, for humans and computers alike.
- **`OWN(X)`** means the house owns a building of code X **of the same side as the type being checked**. Buildings under construction count (`CAC_Owns`, 1543-1563).
- **`hq`** = `OWN(BA) || OWN(BK)`.
- **Special Ops.** When Special Ops is off, BK, BL, UQ, UP and UR are refused before anything else.

| Type | Requires |
|---|---|
| BA | never: placed at start and never rebuildable |
| BK | Special Ops; tier off: `OWN(BA)`; tier on: `hq && OWN(BG)` |
| BB | `hq` |
| BC | `hq && BB` |
| BD, BE, BF | `hq && BC` |
| BG | `hq && BE && BF` |
| BH | `hq && BE && BF && BG` |
| BL | Special Ops; `OWN(BK)`; **Astro slot only** (the Alien slot is always refused) |
| BJ | the house has opened a present, and the slot is the house's own side (`CAC_Has_Santa`, 2791-2867) |
| UD | `hq` |
| UA, UB | `BC` |
| UC | `BC && BG` |
| UE | `BE` |
| UF | `hq && BE && BF` |
| UR | Special Ops; `BE && BL` |
| UG | `BF` |
| UH | `BF && BE && BG` |
| UP | Special Ops; `BK` |
| UQ | Special Ops; `BK`. Alien only; the Commander is a conversion addition, sold from the Hive. |
| UM, UN | the house owns a BJ of its own side, and the slot is its own side |
| UJ | Pizza Mode is on |
| BI, BX, BS | never |

### 9.2 Captured trees
Because `OWN()` looks at the type's side, a house holding the other side's HQ satisfies that side's tree. It can then build that side's buildings, and from them that side's units.
- For example, an Astro house that captures a Mothership can build Alien power plants, then breeding pits, and so on. `AI_Role` uses such slots when the house's own are unbuildable (§2.4).
- Capture is done by an engineer arriving at an enemy building (§4.7).

### 9.3 `Can_Build` for the AI (HOUSE.CPP:559-687)
The checks, in order:
1. The type is buildable and ownable.
2. `CAC_Prereq_Met`.
3. `CAC_Has_Santa`.
4. For CrystAlien types, Level ≤ tech level (595-598).
5. For computers only, the type is not at its cap (641).
6. The stock mask test, which is empty for CrystAlien types.

Production also needs the type's **host building** to exist (§3.1).

### 9.4 `CAC_Cancel_Unbuildable` (CACLOGIC.CPP:336-379)
- **Scope.** Every house, every tick.
- **Rule.** The first production item, scanning from the end of the list, whose CrystAlien prerequisites no longer hold is abandoned with a **full refund**. At most one item per tick.
- **Scope of the check.** Only prerequisites are rechecked; caps and levels are not.
- **Source.** This is `Construction.think`'s `cancel(item, true)`.

### 9.5 Other tree notes
- **Miners** can be built at either HQ of their side (§3.1).
- **Headquarters and selling.** BA can't be sold by anyone. BK can be sold unless it is the house's last HQ (either side). The computer never sells BA or BK.
- **Human caps.** For humans the cap is enforced when production starts, not in the sidebar (HOUSE.CPP:2903-2907).

---

## 10. Deliberate departures and lessons (short)

1. **The computer plays better than the source's.** CrystAlien's computer never builds and never collects, and its units only roam, through UnitHAL "seek". This AI builds, collects, raids, patrols, infiltrates, airlifts and fires superweapons. Fidelity governs how things look and behave, not how well the computer plays (playbook/06-ai-and-missions.md:80-91; UNIT.CPP:3560-3568).
2. **No rebalancing.** AI exceptions change play, not numbers.
   - The Aliens get no Driller.
   - Instead the Alien computer targets income: Drillers first, then miners (`CAC_Raid_Worth`, `CAC_Revenue_Target`) (06:93-133).
3. **Count on one population.** A cap and the "least of" mix test must count the same set of objects (06:135-160; CACLOGIC.CPP:6347-6358).
4. **Hold a decision for a few seconds (5 s)** so it isn't re-derived out from under a factory that is starting up (06:162-165; 6403-6416).
5. **`continue`, not `return`**, for conditions about one item inside a search loop (06:187-202; 5719-5725).
6. **Two stock roles mapping to one building must not be double-counted.** Compare the slots before adding (06:204-231; HOUSE.CPP:7273-7285).
7. **Test "idle" by exclusion**: no destination, no target, not on a deliberate errand. Don't test `mission == GUARD` (06:41-54).
8. **GUARD_AREA is not idle** unless the house is under attack. Otherwise aggression erases patrols (06:167-185).
9. **Precedence: errand > raid > patrol**, and an errand outranks a fight (CACLOGIC.CPP:3903-3917, 5247-5280).
10. **Scouting memory.** The computer only aims infiltration and threat responses at ground it has actually seen (5421-5446). Hunts stay omniscient.
11. **Keep the source's own restraint rules:**
    - the idle "still" re-path and give-up;
    - the transformer 1-in-20 throttle;
    - the boomerang sortie window and shared random house target.
12. **Softlock avoidance.**
    - BK/Hive accepts miners and can build them.
    - The computer never sells an HQ.
    - Miners and fighters die with their base.
    - Losing the HQ triggers the last stand, not defeat.
13. **Chosen rules, not ported ones:**
    - the crate mix, with boxes giving units only and capsules cash;
    - the AI-only Driller range restraint;
    - the Sleigh reached through a present.

---

## Appendix A. Divergences and gaps to decide in the port

1. **`Enemy` and the production ceilings** (§3.2). Derived by reading, not observed: `Enemy` is never set, and the ceilings are about 10 each. **[gap]** `MaxInfantry` and `MaxAircraft` are uninitialised in the source.
2. **Crate respawn is dead in the code**; the intent is a 1-3 min top-up (§7.2).
3. **Miner "loaded" test.** It is always true, so every miner is worth 2 in revenue raids (§4.3).
4. **Best-assault worth.** BA and BK score 400 like factories, not 300 (§4.3).
5. **Airlift** often departs with one engineer (§4.8).
6. **Crate free units.** Aircraft entries always fail and caps are ignored (§7.4).
7. **Collect cadence.** It is effectively 7 s, not 1 s (§1.2).
8. **The stock ring scan** ignores threat for GUARD and GUARD_AREA acquisition (§6.2).
9. **Unreachable infantry values**: "reindeer 2" and "default 3" (§3.4).
10. **`CAC_AI_Extra`** is dead for a house without its own-side BA (§2.4).
11. **Miners after losing the HQ.** A house that lost BA but has BK never rebuilds miners (§3.3).
12. **Superweapon target.** It is effectively heap order, because all CrystAlien buildings share one Value (§6.6).
13. **`Rule.Diff` handicap values** come from the client and are not in the source. They are the same for every computer.
14. **Nothing here was checked in-game for this spec.** Behaviour is as written in the source as of 2026-09-25.

## Appendix B. Constants at a glance

**Timing:**

| Constant | Value | Source |
|---|---|---|
| Ticks per second | 15 | DEFINES.H:2357 |
| Idle re-path / give-up | 65 / 195 ticks | CACLOGIC.H:82-83 |
| Raid cadence | 450 ticks; 180 when under attack | CACLOGIC.CPP:4986 |
| Patrol cadence | 300 ticks | 4709 |
| Aggression cadence | 30 ticks | HOUSE.CPP:1464 |
| Sortie window | 228-259 of every 260 ticks | CACLOGIC.CPP:4380-4384 |
| House target hold | 208 ticks | 10389 |
| Rearm | +1 round per 20 ticks within 3 cells of the station | 11120-11123 |
| Under-attack window | 900 ticks | 4497 |
| Raid patience | 10 passes, needing > 128 leptons of progress | CACLOGIC.H:166-167 |
| Aircraft decision hold | 75 ticks | CACLOGIC.CPP:6430 |
| Stock attack timer | 90-360 s | HOUSE.CPP:6692 |
| `Expert_AI` period | ≈ 5-5.5 s | 6411 |
| Crate top-up period | 1-3 min (dead in code, §7.2) | LOGIC.CPP:199 |

**Counts and distances:**

| Constant | Value | Source |
|---|---|---|
| Raid size | 5; 8 when under attack | CACLOGIC.CPP:5090 |
| Patrol | force ≥ 4; half the force sent; 9 slots | 4748-4775 |
| Collect errands | min(3, 1 + force/12) | 5210-5212 |
| Flag guards | max(2, armed/3) | 4208 |
| Pizza campers | 4 | CACLOGIC.H:165 |
| Escort | 2 decoys | CACLOGIC.CPP:6162 |
| Airlift capacity | 6 | CACSTATS.H:437 |
| Aircraft per pad | 4 | CACLOGIC.CPP:6367 |
| Driller range | 24 cells + 8 per 3 min; whole map with an uplink | CACLOGIC.H:153, 169-170 |
| Outpost reach | 4 cells | CACLOGIC.H:154 |
| Flag-gun reach | 5 cells | CACLOGIC.H:155 |
| Flag-site rings | 1..6 | CACLOGIC.H:158 |
| Adjacency margin | 2 cells | CACLOGIC.H:168 |
| Pizza reveal radius | 12 cells | CACLOGIC.H:162 |

**Economy and power:**

| Constant | Value | Source |
|---|---|---|
| Pizza stipend | 400 credits / 60 s | CACLOGIC.H:160 |
| Pizza cost | 50,000; build clock 407 ticks | CACSTATS.H:466; CACLOGIC.CPP:7051-7054 |
| Power allowance / LOW threshold | 50 / net < 50 | CACLOGIC.H:228 |
| Superweapon | radius 1066 leptons; peak 1000 damage; 10 min charge | CACLOGIC.CPP:1238-1239; DEFINES.H:321 |

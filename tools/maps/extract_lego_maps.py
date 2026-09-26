"""LEGO Battles (Nintendo DS) levels -> JSON grids.

    python tools/maps/extract_lego_maps.py [--rom NDS] [--compare-rom NDS] [--names TSV] [--out DIR]

Reads the cartridge image directly (never writes it): NitroFS -> Maps/*.map,
BP/Entities.ebp, BP/Factions.fbp, LOC/UK_English.lng.  All of them sit in the
game's 'COMP' container (header 'PMOC', decoded size, block count, hint, a
signed size per block; positive = LZ11 block, negative = raw block).

The .map format (container per legobattles-decomp docs/15, checked on all 122
maps; meanings of the planes established for this extraction):

  'MAP' 'TERR' u8 w, u8 h, u8, u8, char[32] tileset
        u8[w*h] plane A   ground/passability class, per cell:
                          0 buildable land, 2 walkable not buildable
                          (gravel/sand/shore; Mines and bridge ends go only
                          here), 3 water, 5 impassable for every unit
                          (cliffs, plateaus, crater rims).  Evidence: the
                          per-blueprint flags at UnitBlueprint+0x16..+0x19
                          read by func_02001510 (land units 0/2, ships 3,
                          flyers all, buildings 0, Mines 2, Bridges 2+3;
                          types 4 and 5 hard-coded impassable); bridges
                          write 2 on completion and 3 when destroyed
                          (Sim::Bridge virtual_06 / virtual_05).  Types 1 and
                          4 never occur in the shipped maps.
        u8[w*h] plane B   per-cell 8-neighbour bitmask used by the forest
                          autotiler (func_020A3FE0); not needed here
        u8[w*h] plane C   region ids (Sim::Continent connectivity; the
                          bridge code merges them); not needed here
        u16 n, u8[n] D    THE TREE MASK: run lengths over the w*h cells in
                          raster order, alternating not-tree / tree, starting
                          with not-tree (func_020A30E8 marks the tree runs in
                          the occupation grid, func_020A40F0 then autotiles
                          them into plane E).  The runs end exactly at w*h on
                          all 122 maps, and an autotiled render matches an
                          in-game capture.  King/Pirate worlds draw these as
                          trees, the Mars world as crystals.
        u16[w*h] plane E  metatile index (graphics only)
  'RRET'
  'EVNT' records: 'L' id, points, area, then 9-byte SPAWN records
                  (x, y, team 0-3, blueprint category, index in the team's
                  roster list for that category, 100, flags) -- read by
                  func_020A5C2C; category 7 = Base (3x3), 0 = Hero, 17 =
                  Bridge.  Positions are the footprint's top-left.  Event id
                  0 = placed at the start; other ids are fired later by the
                  mission script.
  'TRIG'          not used here
  'MARK' groups: 'L' group, count, (x, y, flag) each.  Group 7 = horizontal
                  and 8 = vertical bridge sites (func_020A3704 sizes the
                  bridge 3/6/9 long by testing for water past its end);
                  0, 3, 6 are AI points on the free-play maps; 9+ are
                  mission-script markers.
  'MINE' four groups of (x, y): Mine / Quarry / WellCap sites, 2x2, on
                  plane-A type 2 ("Mines can be placed on special
                  locations").
  'PAM'

Cell classification: A=0 '.', A=2 ',', A=3 '~', A=5 '^'; tree-mask cells on
land become 'T' (King, Pirate) or '*' (Mars); MINE sites 'w'; bridges placed
at the start '='.  Unbuilt bridge sites stay water and are listed in
"bridge_sites".  Pre-placed buildings are not painted; they are listed in
"structures".

Starts, per team: every Base (category 7) spawn, its 3x3 centre, from every
event (later ones flagged initial=false; the team's Hero is added too when all
its Bases come later).  A team with no Base anywhere is marked at the middle of
its (up to two largest) clusters of buildings placed at the start -- a cluster
needs two buildings or a Barracks/VehicleCenter/Shipyard (kind "buildings") --
or, with none, at its Hero spawn (the cell func_020A3D0C records as the
team's start).
Fewer than 3 markers -> suggested ones (suggested: true) in large open areas
far from the others; more candidates in "alternates".
"""

import sys
sys.dont_write_bytecode = True

import argparse
import hashlib
import os
import re
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import mapcommon as mc  # noqa: E402

ROMS = r"D:\Claude_RTSGames\LEGOBATTLES\roms"
DEFAULT_ROM = os.path.join(ROMS, "LEGO Battles (Europe) (En,Fr,De,Es,It,Da).nds")
DEFAULT_US = os.path.join(ROMS, "LEGO Battles (USA) (En,Fr,Es).nds")
DEFAULT_NAMES = r"D:\Claude_RTSGames\LEGOBATTLES\workfolders\legobattles-decomp\docs\data\campaign_missions.tsv"

CATEGORY = {0: "Hero", 1: "Builder", 2: "Melee", 3: "Ranged", 4: "Mounted", 5: "Transport",
            6: "Siege", 7: "Base", 8: "Mill", 9: "Mine", 10: "Farm", 11: "Barracks",
            12: "VehicleCenter", 13: "Tower", 14: "Tower2", 15: "Tower3", 16: "Shipyard",
            17: "Bridge", 18: "Gate", 19: "Wall"}
# UnitBlueprint+0x1D -> footprint, the table func_02001170 builds
FOOTPRINTS = {1: (1, 1), 2: (2, 2), 3: (3, 3), 4: (2, 3), 5: (2, 6), 6: (2, 9),
              7: (3, 2), 8: (6, 2), 9: (9, 2), 10: (1, 4), 11: (4, 1)}
WORLD = {"KingTileset": "King", "MarsTileset": "Mars", "PirateTileset": "Pirate"}
SIDES = {"ck": ("Castle", "King"), "cw": ("Castle", "Wizard"), "pi": ("Pirates", "Imperial"),
         "pp": ("Pirates", "Pirate"), "ma": ("Space", "Alien"), "mh": ("Space", "Earth")}

LEGEND_BASE = {
    ".": "buildable land (plane A type 0)",
    ",": "walkable, not buildable: gravel / sand / shore (plane A type 2; mines and bridge ends only)",
    "~": "water (plane A type 3)",
    "^": "impassable to every unit: cliffs, plateaus, crater rims, map borders (plane A type 5)",
    "w": "mine / well-cap site (MINE chunk, 2x2): 'well tap', becomes crystal",
    "=": "bridge placed at the start (EVNT spawn of a Bridge, its footprint)",
}


# ---------------------------------------------------------------------- ROM --

class Rom:
    def __init__(self, path):
        with open(path, "rb") as fh:
            self.data = fh.read()
        d = self.data
        self.code = d[0x0C:0x10].decode("latin-1")
        fnt_off, fnt_size, fat_off, fat_size = struct.unpack_from("<4I", d, 0x40)
        self.files = {}

        def walk(dir_id, prefix):
            sub, first, _parent = struct.unpack_from("<IHH", d, fnt_off + (dir_id & 0xFFF) * 8)
            p = fnt_off + sub
            fid = first
            while True:
                b = d[p]
                p += 1
                if b == 0:
                    break
                name = d[p:p + (b & 0x7F)].decode("latin-1")
                p += b & 0x7F
                if b & 0x80:
                    child = struct.unpack_from("<H", d, p)[0]
                    p += 2
                    walk(child, prefix + name + "/")
                else:
                    start, end = struct.unpack_from("<II", d, fat_off + 8 * fid)
                    self.files[prefix + name] = (start, end)
                    fid += 1
        walk(0xF000, "")

    def raw(self, path):
        start, end = self.files[path]
        return self.data[start:end]

    def get(self, path):
        data = self.raw(path)
        return comp_decode(data) if data[:4] == b"PMOC" else data


def lz11(data, p):
    header = struct.unpack_from("<I", data, p)[0]
    if header & 0xFF != 0x11:
        raise ValueError("not LZ11 at 0x%x" % p)
    size = header >> 8
    p += 4
    if size == 0:
        size = struct.unpack_from("<I", data, p)[0]
        p += 4
    out = bytearray()
    while len(out) < size:
        flags = data[p]
        p += 1
        for _ in range(8):
            if len(out) >= size:
                break
            if not flags & 0x80:
                out.append(data[p])
                p += 1
            else:
                b0 = data[p]
                ind = b0 >> 4
                if ind == 0:
                    length = ((b0 & 0xF) << 4 | data[p + 1] >> 4) + 0x11
                    disp = ((data[p + 1] & 0xF) << 8 | data[p + 2]) + 1
                    p += 3
                elif ind == 1:
                    length = ((b0 & 0xF) << 12 | data[p + 1] << 4 | data[p + 2] >> 4) + 0x111
                    disp = ((data[p + 2] & 0xF) << 8 | data[p + 3]) + 1
                    p += 4
                else:
                    length = ind + 1
                    disp = ((b0 & 0xF) << 8 | data[p + 1]) + 1
                    p += 2
                start = len(out) - disp
                for i in range(length):
                    out.append(out[start + i])
            flags = (flags << 1) & 0xFF
    return bytes(out[:size])


def comp_decode(data):
    _magic, size, nblocks, _hint = struct.unpack_from("<4sIIi", data, 0)
    sizes = struct.unpack_from("<%di" % nblocks, data, 16)
    p = 16 + 4 * nblocks
    out = bytearray()
    for s in sizes:
        if s < 0:
            out += data[p:p - s]
            p += -s
        else:
            out += lz11(data, p)
            p += s
    if len(out) != size:
        raise ValueError("COMP decoded %d bytes, header says %d" % (len(out), size))
    return bytes(out)


# ---------------------------------------------------------------- game data --

def parse_map(d):
    if d[:3] != b"MAP" or d[3:7] != b"TERR":
        raise ValueError("not a MAP/TERR file")
    p = 3
    w, h = d[p + 4], d[p + 5]
    n = w * h
    tileset = d[p + 8:p + 40].split(b"\0")[0].decode("latin-1")
    q = p + 0x28
    A = d[q:q + n]
    B = d[q + n:q + 2 * n]
    C = d[q + 2 * n:q + 3 * n]
    q += 3 * n
    dlen = struct.unpack_from("<H", d, q)[0]
    D = d[q + 2:q + 2 + dlen]
    q += 2 + dlen + 2 * n
    if d[q:q + 4] != b"RRET":
        raise ValueError("terrain chunk does not end on RRET")
    q += 4
    out = {"w": w, "h": h, "tileset": tileset, "A": A, "B": B, "C": C, "D": D}

    def expect(tag):
        nonlocal q
        if d[q:q + 4] != tag:
            raise ValueError("expected %r at 0x%x" % (tag, q))
        q += 4

    # EVNT
    expect(b"EVNT")
    events = []
    while d[q] != 0x21:
        if d[q] != 0x4C:
            raise ValueError("EVNT frame 0x%02x at 0x%x" % (d[q], q))
        ev = {"id": d[q + 1]}
        npts = d[q + 2]
        q += 3
        ev["points"] = [(d[q + 2 * i], d[q + 2 * i + 1]) for i in range(npts)]
        q += 2 * npts
        area = d[q]
        q += 1
        if area:
            ev["area"] = list(d[q:q + 4])
            q += 4
        nsp = d[q]
        q += 1
        ev["spawns"] = [d[q + 9 * i:q + 9 * i + 9] for i in range(nsp)]
        q += 9 * nsp
        nact = d[q]
        q += 1
        ev["actions"] = [d[q + 8 * i:q + 8 * i + 8] for i in range(nact)]
        q += 8 * nact
        nthird = d[q]
        q += 1 + 3 * nthird
        events.append(ev)
    q += 1
    # TRIG
    expect(b"TRIG")
    while d[q] != 0x21:
        flag = d[q + 2]
        q += 3 + (10 if flag else 0)
    q += 1
    # MARK
    expect(b"MARK")
    marks = {}
    while d[q] != 0x21:
        gid, cnt = d[q + 1], d[q + 2]
        marks.setdefault(gid, []).extend(
            (d[q + 3 + 3 * i], d[q + 4 + 3 * i], d[q + 5 + 3 * i]) for i in range(cnt))
        q += 3 + 3 * cnt
    q += 1
    # MINE
    expect(b"MINE")
    mines = []
    while d[q] != 0x21:
        cnt = d[q + 1]
        mines.append([(d[q + 2 + 2 * i], d[q + 3 + 2 * i]) for i in range(cnt)])
        q += 2 + 2 * cnt
    q += 1
    if d[q:q + 3] != b"PAM":
        raise ValueError("file does not end with PAM")
    out.update(events=events, marks=marks, mines=mines)
    return out


def tree_mask(m):
    n = m["w"] * m["h"]
    mask = bytearray(n)
    i = 0
    tree = False
    for run in m["D"]:
        if tree:
            mask[i:min(n, i + run)] = b"\1" * (min(n, i + run) - i)
        i += run
        tree = not tree
    return mask, i


def load_blueprints(rom):
    """Entities.ebp + Factions.fbp: (category, index) -> footprint, for the six
    base factions' rosters (their per-category lists follow roster slot order)."""
    d = rom.get("BP/Entities.ebp")
    p = 4
    recs = []
    for _ in range(0x227):
        t = d[p + 8]
        size = {0: 0x7C, 1: 0x74, 2: 0x70}[t]
        recs.append((p, t))
        p += size
    pool = p

    def s(off):
        q = pool + off
        return d[q:d.index(b"\0", q)].decode("latin-1")
    bps = []
    for (p, t) in recs:
        name = s(struct.unpack_from("<I", d, p)[0])
        if t == 0:
            bps.append({"name": name, "category": d[p + 0x5C], "fp": FOOTPRINTS.get(d[p + 0x1D], (1, 1))})
        else:
            bps.append({"name": name, "category": None, "fp": (1, 1)})
    f = rom.get("BP/Factions.fbp")
    lists = {}
    for rec in range(124, 130):                   # King Wizard Pirates Imperial Earth Aliens
        slots = struct.unpack_from("<26H", f, 4 + rec * 0x40 + 0x0C)
        per = {}
        for sl in slots:
            if sl == 0xFFFF or sl >= len(bps):
                continue
            b = bps[sl]
            if b["category"] is not None:
                per.setdefault(b["category"], []).append(b)
        for cat, lst in per.items():
            for i, b in enumerate(lst):
                lists.setdefault((cat, i), []).append(b)
    return lists


def load_names(rom, tsv):
    names = {}
    try:
        data = rom.get("LOC/UK_English.lng")
        first = struct.unpack_from("<I", data, 0x0C)[0]
        offs = struct.unpack_from("<%dI" % ((first - 0x0C) // 4), data, 0x0C)
        strs = []
        for o in offs:
            e = data.find(b"\0", o)
            strs.append(data[o:e].decode("latin-1") if 0 <= o < len(data) else "")
        for i, s in enumerate(strs):
            mm = re.match(r"Multiplayer Mission (\d\d) \(Mission Description\)$", s)
            if mm and i > 0:
                names["mp" + mm.group(1)] = (strs[i - 1], "LOC/UK_English.lng id %d" % (i - 1))
    except (KeyError, struct.error):
        pass
    if tsv and os.path.isfile(tsv):
        with open(tsv, encoding="utf-8") as fh:
            head = fh.readline().rstrip("\n").split("\t")
            for line in fh:
                row = dict(zip(head, line.rstrip("\n").split("\t")))
                mm = re.search(r"CampaignMission\d+_(\w+?)Act\d+$", row.get("class", ""))
                if mm and row.get("map"):
                    title = re.sub(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Za-z])(?=[0-9])|(?<=[A-Z])(?=[A-Z][a-z])",
                                   " ", mm.group(1))
                    names[row["map"]] = ("%s (%s campaign, act %s mission %s)"
                                         % (title, row.get("side", "?"), row.get("act", "?"), row.get("mission", "?")),
                                         "RTTI class %s via %s" % (row["class"], os.path.basename(tsv)))
    return names


# ------------------------------------------------------------------ convert --

def bridge_site(A, w, h, x, y, horizontal):
    """func_020A3704: a site grows 3 -> 6 -> 9 while the cell past its end is water."""
    length = 3
    for nxt in (6, 9):
        ex, ey = (x + length, y) if horizontal else (x, y + length)
        if 0 <= ex < w and 0 <= ey < h and A[ey * w + ex] in (3, 4):
            length = nxt
        else:
            break
    return length


def convert(stem, m, lists, names, out_dir, rom_label):
    w, h = m["w"], m["h"]
    A = m["A"]
    world = WORLD.get(m["tileset"], m["tileset"])
    harvest = "*" if world == "Mars" else "T"
    notes_extra = []

    grid = [[".,~^"[{0: 0, 2: 1, 3: 2, 5: 3}.get(A[y * w + x], 2 if A[y * w + x] == 1 else 3)]
             for x in range(w)] for y in range(h)]
    mask, end = tree_mask(m)
    if end != w * h:
        notes_extra.append("tree runs end at %d, not %d" % (end, w * h))
    skipped = {"^": 0, "~": 0}
    for i in range(w * h):
        if mask[i]:
            y, x = divmod(i, w)
            if grid[y][x] in ".,":
                grid[y][x] = harvest
            else:
                skipped[grid[y][x]] += 1

    mine_sites = []
    for gi, group in enumerate(m["mines"]):
        for (x, y) in group:
            mine_sites.append({"x": x, "y": y, "w": 2, "h": 2, "group": gi})
            for dy in range(2):
                for dx in range(2):
                    if 0 <= x + dx < w and 0 <= y + dy < h:
                        grid[y + dy][x + dx] = "w"

    # spawns
    spawns = []
    for ev in m["events"]:
        for sp in ev["spawns"]:
            x, y, team, cat, idx = sp[0], sp[1], sp[2], sp[3], sp[4]
            cands = lists.get((cat, idx), [])
            fps = {b["fp"] for b in cands}
            fp = sorted(fps)[0] if fps else (1, 1)
            spawns.append({"x": x, "y": y, "team": team, "category": cat,
                           "category_name": CATEGORY.get(cat, str(cat)), "index": idx,
                           "event_id": ev["id"], "fp": fp,
                           "blueprints": sorted({b["name"] for b in cands})})

    # bridges placed at the start, and the bridge sites
    built = set()
    for sp in spawns:
        if sp["category"] == 17 and sp["event_id"] == 0:
            bw, bh = sp["fp"]
            for dy in range(bh):
                for dx in range(bw):
                    if 0 <= sp["x"] + dx < w and 0 <= sp["y"] + dy < h:
                        grid[sp["y"] + dy][sp["x"] + dx] = "="
            built.add((sp["x"], sp["y"]))
    bridge_sites = []
    for gid, horiz in ((7, True), (8, False)):
        for (x, y, _f) in m["marks"].get(gid, []):
            ln = bridge_site(A, w, h, x, y, horiz)
            bridge_sites.append({"x": x, "y": y, "w": ln if horiz else 2, "h": 2 if horiz else ln,
                                 "orientation": "horizontal" if horiz else "vertical",
                                 "built_at_start": (x, y) in built})

    cells = ["".join(r) for r in grid]

    # starts: per team, its Base spawns; failing that, clusters of its
    # buildings placed at the start; failing that, its Hero.  A team whose
    # only Base arrives later also keeps its Hero start if that is elsewhere.
    teams = sorted({sp["team"] for sp in spawns})
    starts = []

    def centre(sp):
        return sp["x"] + sp["fp"][0] // 2, sp["y"] + sp["fp"][1] // 2

    def add(sp, team, kind, why, cx=None, cy=None):
        if cx is None:
            cx, cy = centre(sp)
        for s in starts:
            if abs(s["x"] - cx) + abs(s["y"] - cy) <= 2:
                return False
        starts.append({
            "x": cx, "y": cy, "team": team, "kind": kind, "event_id": sp["event_id"],
            "initial": sp["event_id"] == 0,
            "footprint": {"x": sp["x"], "y": sp["y"], "w": sp["fp"][0], "h": sp["fp"][1]},
            "from": why})
        return True

    for team in teams:
        mine = [sp for sp in spawns if sp["team"] == team]
        order = lambda s: (s["event_id"] != 0, s["event_id"])  # noqa: E731
        bases = sorted([sp for sp in mine if sp["category"] == 7], key=order)
        heroes = sorted([sp for sp in mine if sp["category"] == 0], key=order)
        for sp in bases:
            add(sp, team, "base", "EVNT spawn: team %d Base (3x3) at (%d,%d), event id %d%s" % (
                team, sp["x"], sp["y"], sp["event_id"],
                "" if sp["event_id"] == 0 else " (fired later by the mission script)"))
        if bases:
            if heroes and all(b["event_id"] != 0 for b in bases):
                h0 = heroes[0]
                hx, hy = centre(h0)
                if min(abs(hx - s["x"]) + abs(hy - s["y"]) for s in starts if s["team"] == team) > 8:
                    add(h0, team, "hero", "EVNT spawn: team %d Hero at (%d,%d), event id %d (the team's start; "
                        "its Base only comes later)" % (team, h0["x"], h0["y"], h0["event_id"]))
            continue
        blds = [sp for sp in mine if 8 <= sp["category"] <= 16 and sp["event_id"] == 0]
        clusters = []
        for sp in blds:
            cx, cy = centre(sp)
            hit = [c for c in clusters if any(abs(cx - ox) <= 7 and abs(cy - oy) <= 7 for (ox, oy, _s) in c)]
            merged = [(cx, cy, sp)]
            for c in hit:
                merged += c
                clusters.remove(c)
            clusters.append(merged)
        # a lone Farm or Mill is not a base; two buildings or a production
        # building (Barracks, VehicleCenter, Shipyard) is
        clusters = [c for c in clusters if len(c) >= 2 or any(p[2]["category"] in (11, 12, 16) for p in c)]
        clusters.sort(key=len, reverse=True)
        for c in clusters[:2]:
            mx = sum(p[0] for p in c) / float(len(c))
            my = sum(p[1] for p in c) / float(len(c))
            cx, cy, sp = min(c, key=lambda p: (p[0] - mx) ** 2 + (p[1] - my) ** 2)
            kinds = {}
            for p in c:
                kinds[p[2]["category_name"]] = kinds.get(p[2]["category_name"], 0) + 1
            add(sp, team, "buildings", "EVNT spawns: team %d buildings placed at the start (%s), no Base; "
                "marker at the one nearest their middle, (%d,%d)" % (
                    team, ", ".join("%d %s" % (n, k) for k, n in sorted(kinds.items())), sp["x"], sp["y"]),
                cx, cy)
        if not clusters and heroes:
            h0 = heroes[0]
            add(h0, team, "hero", "EVNT spawn: team %d Hero at (%d,%d), event id %d (no Base or buildings; "
                "the game records this cell as the team's start)" % (team, h0["x"], h0["y"], h0["event_id"]))
    starts.sort(key=lambda s: (s["team"], s["kind"] != "base", s["event_id"]))
    recorded = len(starts)
    suggested, alternates = mc.suggest_starts(
        cells, [(s["x"], s["y"]) for s in starts], want=3, extra=2,
        buildable=set("."), passable=set(".,=Tw*"))
    for s in suggested:
        starts.append({"x": s["x"], "y": s["y"], "suggested": True, "kind": "suggested",
                       "reachable_by_land": s["same_region"],
                       "from": "suggested: open buildable area (clear radius %d), %s cells from the nearest marker%s"
                               % (s["clearance"], s["nearest_marker"],
                                  "" if s["same_region"] else "; NOT connected by land to the recorded starts")})

    structures = [{"x": sp["x"], "y": sp["y"], "w": sp["fp"][0], "h": sp["fp"][1], "team": sp["team"],
                   "category": sp["category_name"], "blueprints": sp["blueprints"], "event_id": sp["event_id"]}
                  for sp in spawns if 7 <= sp["category"] <= 19]

    kind = "free-play" if stem.startswith("mp") else "test" if stem.startswith("test") else "campaign"
    base_teams = sorted({s["team"] for s in starts if s.get("kind") == "base" and s.get("initial")})
    players = len(base_teams) if kind == "free-play" else len({s["team"] for s in starts if not s.get("suggested")})
    name, name_src = names.get(stem, (None, None))
    if name is None:
        pre = SIDES.get(stem[:2])
        if pre:
            mm = re.match(r"..(\d)_(\d)", stem)
            name = "%s campaign (%s world), act %s map %s" % (pre[1], pre[0], mm.group(1), mm.group(2))
        else:
            name = stem
        name_src = "file name"

    cnt = mc.counts(cells)
    team_summary = {}
    for sp in spawns:
        t = team_summary.setdefault(str(sp["team"]), {})
        t[sp["category_name"]] = t.get(sp["category_name"], 0) + 1
    notes = [
        "LEGO Battles %s map %s, %s world, %dx%d cells (one cell = one 24x16 px metatile)." % (kind, stem, world, w, h),
        "Ground from TERR plane A (0 '.', 2 ',', 3 '~', 5 '^'); %d %s cells from the TERR tree mask "
        "(block D, runs alternating not-tree/tree)%s; %d mine/well-cap sites 'w' (MINE chunk, 2x2)."
        % (sum(mask), "crystal" if harvest == "*" else "tree",
           ", %d mask cells left as cliff/water" % (skipped["^"] + skipped["~"]) if skipped["^"] + skipped["~"] else "",
           len(mine_sites)),
    ]
    if bridge_sites:
        notes.append("%d bridge site(s) from MARK groups 7/8 (%d built at the start, drawn '='; the rest stay "
                     "water, see bridge_sites)." % (len(bridge_sites), sum(1 for b in bridge_sites if b["built_at_start"])))
    if kind == "free-play":
        notes.append("Free-play map for %d players (teams %s each start with Base, Barracks, Farm, 2 Builders "
                     "and a Hero)." % (players, ",".join(map(str, base_teams))))
    else:
        later = sum(1 for s in starts[:recorded] if not s.get("initial"))
        notes.append("Campaign markers: %d from the level (%d appear later, by mission script): Base spawns, "
                     "else the middle of a team's pre-placed buildings, else its Hero spawn. Teams present "
                     "(0 = player): %s."
                     % (recorded, later, ", ".join("%s: %s" % (k, "/".join("%d %s" % (n, c) for c, n in v.items()))
                                                   for k, v in sorted(team_summary.items()))))
    if recorded < 3:
        notes.append("The level data has only %d start/base position(s): %d suggested marker(s) added in large "
                     "open areas far from them (suggested: true); more candidates in alternates."
                     % (recorded, len(suggested)))
    if notes_extra:
        notes.append("Issues: " + "; ".join(notes_extra) + ".")

    legend = dict(LEGEND_BASE)
    legend[harvest] = ("harvestable crystals (tree mask, Mars world): becomes crystal" if harvest == "*"
                       else "harvestable tree (tree mask, %s world): becomes crystal" % world)

    marks_other = {str(g): [[x, y] for (x, y, _f) in v] for g, v in sorted(m["marks"].items()) if g not in (7, 8)}
    out = {
        "source": "%s :: NitroFS Maps/%s.map (COMP container; TERR, EVNT, MARK, MINE chunks)" % (rom_label, stem),
        "name": name,
        "id": stem,
        "width": w,
        "height": h,
        "cells": cells,
        "legend": legend,
        "starts": starts,
        "notes": " ".join(notes),
        "players": players,
        "kind": kind,
        "world": world,
        "tileset": m["tileset"],
        "name_source": name_src,
        "counts": cnt,
        "mine_sites": mine_sites,
        "bridge_sites": bridge_sites,
        "structures": structures,
        "teams": team_summary,
        "mark_groups": marks_other,
        "alternates": [{"x": a["x"], "y": a["y"], "clearance": a["clearance"]} for a in alternates],
    }
    mc.write_json(os.path.join(out_dir, stem + ".json"), out)
    outlines = [(b["x"], b["y"], b["w"], b["h"], (255, 140, 0)) for b in bridge_sites if not b["built_at_start"]]
    mc.write_preview(os.path.join(out_dir, stem + ".png"), cells, starts, alternates, outlines)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rom", default=DEFAULT_ROM)
    ap.add_argument("--compare-rom", default=DEFAULT_US,
                    help="second cartridge whose Maps/*.map are compared byte for byte ('' to skip)")
    ap.add_argument("--names", default=DEFAULT_NAMES,
                    help="optional campaign table (legobattles-decomp docs/data/campaign_missions.tsv)")
    ap.add_argument("--out", default=os.path.join(REPO, "work", "maps", "lego"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    rom = Rom(args.rom)
    label = "LEGO Battles ROM %s (game code %s)" % (os.path.basename(args.rom), rom.code)
    maps = sorted(p for p in rom.files if p.startswith("Maps/") and p.endswith(".map"))
    print("%s: %d files, %d maps" % (label, len(rom.files), len(maps)))
    lists = load_blueprints(rom)
    names = load_names(rom, args.names)

    if args.compare_rom and os.path.isfile(args.compare_rom):
        other = Rom(args.compare_rom)
        diff = [p for p in maps if p not in other.files or
                hashlib.sha1(other.get(p)).digest() != hashlib.sha1(rom.get(p)).digest()]
        extra = [p for p in other.files if p.startswith("Maps/") and p not in rom.files]
        print("compared with %s (%s): %d of %d maps differ%s%s" % (
            os.path.basename(args.compare_rom), other.code, len(diff), len(maps),
            (": " + ", ".join(diff[:10])) if diff else "", ("; only there: " + ", ".join(extra)) if extra else ""))

    index = []
    for p in maps:
        stem = os.path.splitext(os.path.basename(p))[0]
        m = parse_map(rom.get(p))
        out = convert(stem, m, lists, names, args.out, label)
        real = [s for s in out["starts"] if not s.get("suggested")]
        index.append({"id": stem, "name": out["name"], "width": out["width"], "height": out["height"],
                      "players": out["players"], "start_markers": len(real),
                      "suggested_markers": len(out["starts"]) - len(real), "kind": out["kind"],
                      "world": out["world"], "file": stem + ".json", "preview": stem + ".png"})
        print("%-6s %-9s %-7s %2dx%-2d players %d markers %d%s  %s" % (
            stem, out["kind"], out["world"], out["width"], out["height"], out["players"], len(real),
            " +%d suggested" % (len(out["starts"]) - len(real)) if len(out["starts"]) > len(real) else "",
            out["name"][:60]))
    mc.write_json(os.path.join(args.out, "index.json"),
                  {"game": "LEGO Battles (Nintendo DS)", "rom": os.path.basename(args.rom), "maps": index})
    n = mc.rebuild_index(os.path.dirname(args.out))
    print("wrote %d maps to %s (combined index: %d maps)" % (len(index), args.out, n))


if __name__ == "__main__":
    main()

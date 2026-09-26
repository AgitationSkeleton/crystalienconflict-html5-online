"""Tiberian Dawn (C&C Remastered) multiplayer maps -> JSON grids.

    python tools/maps/extract_cnc_maps.py [--game DIR] [--src DIR] [--out DIR]

Reads, never writes, the Steam install and EA's source release:

  maps       SCM*.INI + SCM*.BIN inside Data/CNCDATA/TIBERIAN_DAWN/*/GENERAL.MIX
             and SC-001.MIX (found by hashing every SCMxxEA/SCMxxWA name), plus
             the loose Data/CNCDATA/TIBERIAN_DAWN/COMMUNITY/SCM*.INI/BIN.
  cross-check  Data/CONFIG.MEG :: DATA/XML/CNCMAPPREVIEWDATA.XML, the
             Remastered map list (window + start waypoints per map).

Formats (reference: CnCTDRAMapEditor, TiberianDawn/GamePlugin.cs):
  BIN   64x64 cells, row-major, 2 bytes each: template id, icon.  255 = none.
        Templates not valid in the map's theater, and icons past the
        template's WxH, are treated as clear, as LoadBinary does.
  INI   [MAP] X/Y/Width/Height = the playable window (the grid written here),
        [Waypoints] n=cell, [TERRAIN] cell=TYPE,trigger,
        [OVERLAY] cell=TYPE, [STRUCTURES] n=house,TYPE,hp,cell,facing,trigger.

Cell classification, in the engine's own order (CellClass::Recalc_Attributes):
  1. template land type per icon: TIBERIANDAWN/CDATA.CPP, TemplateTypeClass
     (Land, AltLand, AltIcons).  The editor's TiberianDawn/TemplateTypes.cs
     only carries Clear/Water flags, so it is used to cross-check ids, names
     and sizes, not for land types.  LAND_CLEAR -> '.', but 'r' for the
     TXT_ROAD templates (D01-D43, all LAND_CLEAR in TD) and '=' for the clear
     icons of BRIDGE1-4(D); LAND_WATER '~'; LAND_ROCK '^'; LAND_BEACH ','
     (walkable, not buildable: Ground[] in CONST.CPP).
  2. overlay land (ODATA.CPP): TI1-TI12 LAND_TIBERIUM '*'; SBAG/CYCL/BRIK/
     BARB/WOOD LAND_WALL '#'; V12-V18 LAND_ROCK '#'; ROAD/CONC LAND_ROAD 'r'.
  3. terrain objects, occupancy masks from the editor's TerrainTypes.cs:
     T01-T18, TC01-TC05 'T'; ROCK1-7 '^'; SPLIT2/SPLIT3 (blossom trees, which
     seed tiberium) 'w'.
  4. structures (civilian V01-V37), masks from the editor's BuildingTypes.cs:
     '#'.
Starts: every valid waypoint 0..25, in index order -- the set the Remastered
DLL offers as start locations (INI.CPP / DLLInterface.cpp).  Players =
min(starts, 6) (MAX_PLAYERS in DEFINES.H).
"""

import sys
sys.dont_write_bytecode = True

import argparse
import glob
import os
import re
import string
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import mapcommon as mc  # noqa: E402

DEFAULT_GAME = r"D:\SteamLibrary\steamapps\common\CnCRemastered"
DEFAULT_SRC = r"D:\Claude_RTSGames\COMMANDANDCONQUER\sources\CnC_Remastered_Collection-master"
CELLS_W = 64
MAX_PLAYERS = 6

LEGEND = {
    ".": "clear (LAND_CLEAR): walkable, buildable",
    ",": "beach (LAND_BEACH): walkable, not buildable",
    "r": "road: TXT_ROAD templates (D01-D43) or ROAD/CONC overlay",
    "^": "rock / cliff (LAND_ROCK templates, ROCK1-7 terrain objects)",
    "~": "water (LAND_WATER: water, shore, river, falls, bridge spans)",
    "T": "tree (terrain objects T01-T18, TC01-TC05)",
    "*": "tiberium (overlay TI1-TI12)",
    "w": "blossom tree SPLIT2/SPLIT3: tiberium source",
    "=": "bridge deck (walkable icons of BRIDGE1-4 / BRIDGE1D-4D templates)",
    "#": "blocked: walls (SBAG/CYCL/BRIK/BARB/WOOD), V12-V18 field overlays, civilian buildings",
}


# ------------------------------------------------------------------ archives --

def mix_crc(name):
    """Westwood's TD MIX id: rotate-left-1 and add, over little-endian 4-byte
    chunks of the upper-cased name, the last one zero-padded."""
    b = name.upper().encode("ascii")
    crc = 0
    for i in range(0, len(b), 4):
        v = int.from_bytes(b[i:i + 4].ljust(4, b"\0"), "little")
        crc = ((((crc << 1) | (crc >> 31)) & 0xFFFFFFFF) + v) & 0xFFFFFFFF
    return crc


class Mix:
    def __init__(self, path):
        self.path = path
        with open(path, "rb") as fh:
            self.data = fh.read()
        count, _size = struct.unpack_from("<HI", self.data, 0)
        self.entries = {}
        for i in range(count):
            fid, off, size = struct.unpack_from("<III", self.data, 6 + 12 * i)
            self.entries[fid] = (off, size)
        self.body = 6 + 12 * count

    def get(self, name):
        e = self.entries.get(mix_crc(name))
        if e is None:
            return None
        return self.data[self.body + e[0]: self.body + e[0] + e[1]]


def meg_read(path, wanted):
    """Petroglyph MEG (the Remastered's): returns {name: bytes} for `wanted`.
    Layout as in CnCTDRAMapEditor Utility/Megafile.cs."""
    out = {}
    with open(path, "rb") as fh:
        first = struct.unpack("<I", fh.read(4))[0]
        off = 12 if first in (0xFFFFFFFF, 0x8FFFFFFF) else 0
        fh.seek(off)
        n_a, n_b, table_size = struct.unpack("<3I", fh.read(12))
        raw = fh.read(table_size)
        names, p = [], 0
        while p < len(raw) and len(names) < max(n_a, n_b):
            ln = struct.unpack_from("<H", raw, p)[0]
            names.append(raw[p + 2:p + 2 + ln].decode("latin-1"))
            p += 2 + ln
        n_files = n_a
        recs = fh.read(20 * n_files)
        for i in range(n_files):
            _flags, _crc, _idx, size, start, name_i = struct.unpack_from("<HIiIIH", recs, 20 * i)
            name = names[name_i] if name_i < len(names) else ""
            if name.upper() in wanted:
                fh.seek(start)
                out[name.upper()] = fh.read(size)
    return out


def ini_parse(text):
    """TD INI: first occurrence of a key wins (WWGetPrivateProfileString)."""
    secs = {}
    cur = None
    for line in text.splitlines():
        line = line.split(";", 1)[0].strip()
        if not line:
            continue
        m = re.match(r"\[(.+?)\]", line)
        if m:
            cur = secs.setdefault(m.group(1).strip().upper(), {})
            continue
        if cur is not None and "=" in line:
            k, v = line.split("=", 1)
            cur.setdefault(k.strip(), v.strip())
    return secs


# ------------------------------------------------------------ source tables --

def read_text(path):
    with open(path, encoding="latin-1") as fh:
        return fh.read()


def load_tables(src):
    td = os.path.join(src, "TIBERIANDAWN")
    ed = os.path.join(src, "CnCTDRAMapEditor", "TiberianDawn")

    # enum TemplateType, DEFINES.H
    s = read_text(os.path.join(td, "DEFINES.H"))
    m = re.search(r"typedef enum TemplateType[^{]*\{(.*?)\}\s*TemplateType;", s, re.S)
    enum, val = {}, 0
    for line in m.group(1).splitlines():
        line = line.split("//")[0].strip()
        mm = re.match(r"(TEMPLATE_\w+)\s*(?:=\s*(-?\d+))?\s*,?$", line)
        if mm:
            if mm.group(2) is not None:
                val = int(mm.group(2))
            enum[mm.group(1)] = val
            val += 1

    # TemplateTypeClass definitions and alt-icon lists, CDATA.CPP
    s = read_text(os.path.join(td, "CDATA.CPP"))
    alts = {}
    for mm in re.finditer(r"static char const (_\w+)\[\]\s*=\s*\{([^}]*)\};", s):
        vals = [int(v) for v in re.findall(r"-?\d+", mm.group(2))]
        alts[mm.group(1)] = [v for v in vals[:vals.index(-1)] if v >= 0] if -1 in vals else vals
    objs = {}
    pat = re.compile(
        r"static TemplateTypeClass const (\w+)\(\s*(TEMPLATE_\w+)\s*,\s*([^,]+?)\s*,\s*"
        r"\"([^\"]+)\"\s*,\s*(TXT_\w+)\s*,\s*(LAND_\w+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"
        r"(LAND_\w+)\s*,\s*(NULL|\(char const \*\)\s*(\w+))\s*\);", re.S)
    for mm in pat.finditer(s):
        objs[mm.group(1)] = dict(enum=mm.group(2), theaters=mm.group(3), ini=mm.group(4),
                                 text=mm.group(5), land=mm.group(6), w=int(mm.group(7)),
                                 h=int(mm.group(8)), altland=mm.group(9),
                                 alticons=set(alts.get(mm.group(11), [])) if mm.group(11) else set())
    pointers = re.search(r"TemplateTypeClass::Pointers\[TEMPLATE_COUNT\]\s*=\s*\{(.*?)\};", s, re.S)
    templates = {}
    for i, mm in enumerate(re.finditer(r"&(\w+)\s*,", pointers.group(1))):
        t = dict(objs[mm.group(1)])
        if enum.get(t["enum"]) != i:
            raise SystemExit("template table order disagrees with DEFINES.H at %d (%s)" % (i, t["enum"]))
        t["id"] = i
        t["theater_set"] = set(re.findall(r"THEATERF_(\w+)", t["theaters"]))
        templates[i] = t

    # cross-check against the editor's TemplateTypes.cs (id, name, size)
    s = read_text(os.path.join(ed, "TemplateTypes.cs"))
    mismatches = []
    for mm in re.finditer(r"new TemplateType\((\d+),\s*\"(\w+)\",\s*(\d+),\s*(\d+)", s):
        tid, name, w, h = int(mm.group(1)), mm.group(2), int(mm.group(3)), int(mm.group(4))
        t = templates.get(tid)
        if t is None or t["ini"].lower() != name.lower() or (t["w"], t["h"]) != (w, h):
            mismatches.append((tid, name, w, h))

    # overlay land types, ODATA.CPP
    s = read_text(os.path.join(td, "ODATA.CPP"))
    overlays = {}
    for mm in re.finditer(r"static OverlayTypeClass const \w+\(\s*OVERLAY_\w+\s*,[^\"]*\"(\w+)\"\s*,"
                          r"[^,]*,\s*(?://[^\n]*\n\s*)?(LAND_\w+)", s):
        overlays[mm.group(1).upper()] = mm.group(2)

    # occupancy masks, editor TerrainTypes.cs / BuildingTypes.cs
    def masks(path, cls):
        out = {}
        s = read_text(path)
        for mm in re.finditer(r"new %s\(\s*-?\d+\s*,\s*\"(\w+)\"(.*?)new bool\[(\d+),\s*(\d+)\]\s*\{(.*?)\}\s*\}" % cls, s):
            rows = re.findall(r"\{([^{}]*)\}", mm.group(5) + "}")
            grid = [[v.strip() == "true" for v in r.split(",")] for r in rows]
            out[mm.group(1).upper()] = [(x, y) for y, r in enumerate(grid) for x, v in enumerate(r) if v]
        return out
    terrain = masks(os.path.join(ed, "TerrainTypes.cs"), "TerrainType")
    buildings = masks(os.path.join(ed, "BuildingTypes.cs"), "BuildingType")
    return templates, overlays, terrain, buildings, mismatches


# ------------------------------------------------------------------- finding --

def find_maps(game):
    root = os.path.join(game, "Data", "CNCDATA", "TIBERIAN_DAWN")
    mix_paths = sorted(glob.glob(os.path.join(root, "*", "*.MIX")))
    # CD1 first: the copies in CD2/CD3/CUSTOMMAPS are byte-identical
    mix_paths.sort(key=lambda p: (os.path.basename(os.path.dirname(p)) != "CD1", p))
    mixes = [Mix(p) for p in mix_paths]
    names = set()
    alnum = string.digits + string.ascii_uppercase
    for a in alnum:
        for b in alnum:
            for side in "EW":
                for var in "ABCDEFGH":
                    names.add("SCM%s%s%s%s" % (a, b, side, var))
    found = {}
    for mx in mixes:
        ids = set(mx.entries)
        for n in names:
            if n in found or mix_crc(n + ".INI") not in ids:
                continue
            ini = mx.get(n + ".INI")
            binary = None
            for mx2 in [mx] + mixes:
                binary = mx2.get(n + ".BIN")
                if binary is not None:
                    break
            found[n] = dict(ini=ini, bin=binary, where=os.path.relpath(mx.path, game))
    for p in sorted(glob.glob(os.path.join(root, "*", "SCM*.INI"))):
        n = os.path.splitext(os.path.basename(p))[0].upper()
        if n in found:
            continue
        bp = os.path.splitext(p)[0] + ".BIN"
        with open(p, "rb") as fh:
            ini = fh.read()
        binary = open(bp, "rb").read() if os.path.isfile(bp) else None
        found[n] = dict(ini=ini, bin=binary, where=os.path.relpath(p, game))
    return found


def preview_xml(game):
    meg = os.path.join(game, "Data", "CONFIG.MEG")
    if not os.path.isfile(meg):
        return {}
    data = meg_read(meg, {"DATA\\XML\\CNCMAPPREVIEWDATA.XML"}).get("DATA\\XML\\CNCMAPPREVIEWDATA.XML")
    if not data:
        return {}
    s = data.decode("latin-1")
    out = {}
    for mm in re.finditer(r'<INIData Name="(MOBIUS_TIBERIAN_DAWN_MULTIPLAYER_(\w+?)_MAP)">(.*?)</INIData>', s, re.S):
        body = mm.group(3)
        g = lambda t: int(re.search("<%s>(-?\\d+)</%s>" % (t, t), body).group(1))
        out[mm.group(2)] = dict(name=mm.group(1), x=g("MapTileX"), y=g("MapTileY"),
                                w=g("MapTileWidth"), h=g("MapTileHeight"),
                                waypoints=[int(v) for v in re.findall(r"<Entry>(-?\d+)</Entry>", body)])
    return out


def remaster_key(mapid):
    """SCM01EA -> '1', SCMC0EA -> 'COMMUNITY_1' (the XML's numbering)."""
    core = mapid[3:5]
    if core.isdigit():
        return str(int(core))
    if core[0] == "C" and core[1].isdigit():
        return "COMMUNITY_%d" % (int(core[1]) + 1)
    return core


# ------------------------------------------------------------------ convert --

def convert(mapid, rec, tables, xml, out_dir):
    templates, overlays, terrain, buildings, _ = tables
    ini = ini_parse(rec["ini"].decode("latin-1"))
    mp = ini.get("MAP", {})
    theater = mp.get("Theater", "TEMPERATE").upper()
    X, Y = int(mp.get("X", 1)), int(mp.get("Y", 1))
    W, H = int(mp.get("Width", 62)), int(mp.get("Height", 62))
    name = ini.get("BASIC", {}).get("Name", mapid)
    issues = []

    grid = [["."] * CELLS_W for _ in range(CELLS_W)]
    bad_theater = bad_icon = 0
    raw = rec["bin"] or b""
    if len(raw) < 2 * CELLS_W * CELLS_W:
        issues.append("BIN missing or short (%d bytes); template layer treated as clear" % len(raw))
    for cell in range(min(len(raw) // 2, CELLS_W * CELLS_W)):
        tid, icon = raw[2 * cell], raw[2 * cell + 1]
        if tid == 255 or tid == 0:
            continue
        t = templates.get(tid)
        if t is None or theater not in t["theater_set"]:
            bad_theater += 1
            continue
        if icon >= t["w"] * t["h"]:
            bad_icon += 1
            continue
        land = t["altland"] if icon in t["alticons"] else t["land"]
        if land == "LAND_CLEAR":
            if t["ini"].startswith("BRIDGE") and icon in t["alticons"]:
                ch = "="
            elif t["text"] == "TXT_ROAD":
                ch = "r"
            else:
                ch = "."
        else:
            ch = {"LAND_WATER": "~", "LAND_ROCK": "^", "LAND_BEACH": ",",
                  "LAND_ROAD": "r", "LAND_WALL": "#", "LAND_TIBERIUM": "*"}.get(land, "?")
        grid[cell // CELLS_W][cell % CELLS_W] = ch
    if bad_theater:
        issues.append("%d cells name a template not valid in %s (treated as clear, as the editor does)" % (bad_theater, theater))
    if bad_icon:
        issues.append("%d cells have an icon past their template's size (treated as clear)" % bad_icon)

    ov_counts = {}
    for k, v in ini.get("OVERLAY", {}).items():
        cell, typ = int(k), v.upper()
        land = overlays.get(typ)
        ov_counts[typ] = ov_counts.get(typ, 0) + 1
        ch = {"LAND_TIBERIUM": "*", "LAND_WALL": "#", "LAND_ROCK": "#", "LAND_ROAD": "r"}.get(land)
        if land is None:
            issues.append("unknown overlay %s" % typ)
        if ch and 0 <= cell < CELLS_W * CELLS_W:
            grid[cell // CELLS_W][cell % CELLS_W] = ch

    tr_counts = {}
    for k, v in ini.get("TERRAIN", {}).items():
        cell, typ = int(k), v.split(",")[0].strip().upper()
        tr_counts[typ] = tr_counts.get(typ, 0) + 1
        occ = terrain.get(typ)
        if occ is None:
            issues.append("unknown terrain object %s" % typ)
            continue
        ch = "w" if typ.startswith("SPLIT") else "^" if typ.startswith("ROCK") else "T"
        for dx, dy in occ:
            x, y = cell % CELLS_W + dx, cell // CELLS_W + dy
            if 0 <= x < CELLS_W and 0 <= y < CELLS_W:
                grid[y][x] = ch

    structures = []
    for k, v in ini.get("STRUCTURES", {}).items():
        f = [p.strip() for p in v.split(",")]
        house, typ, cell = f[0], f[1].upper(), int(f[3])
        occ = buildings.get(typ)
        if occ is None:
            issues.append("unknown structure %s" % typ)
            occ = [(0, 0)]
        structures.append({"type": typ, "house": house, "x": cell % CELLS_W - X, "y": cell // CELLS_W - Y})
        for dx, dy in occ:
            x, y = cell % CELLS_W + dx, cell // CELLS_W + dy
            if 0 <= x < CELLS_W and 0 <= y < CELLS_W:
                grid[y][x] = "#"

    cells = ["".join(grid[y][X:X + W]) for y in range(Y, Y + H)]

    starts = []
    wps = {}
    for k, v in ini.get("WAYPOINTS", {}).items():
        try:
            wps[int(k)] = int(v)
        except ValueError:
            pass
    for n in range(26):
        c = wps.get(n, -1)
        if c == -1:
            continue
        x, y = c % CELLS_W - X, c // CELLS_W - Y
        if not (0 <= x < W and 0 <= y < H):
            issues.append("waypoint %d (cell %d) lies outside the map window" % (n, c))
        starts.append({"x": x, "y": y, "from": "waypoint %d (cell %d)" % (n, c),
                       "kind": "waypoint", "waypoint": n, "team": len(starts)})
    players = min(len(starts), MAX_PLAYERS)

    suggested, alternates = mc.suggest_starts(
        cells, [(s["x"], s["y"]) for s in starts], want=3, extra=2,
        buildable=set(".r"), passable=set(".,r=*w"))
    for s in suggested:
        starts.append({"x": s["x"], "y": s["y"], "suggested": True, "kind": "suggested",
                       "reachable_by_land": s["same_region"],
                       "from": "suggested: open area (clear radius %d), %s cells from the nearest start%s"
                               % (s["clearance"], s["nearest_marker"],
                                  "" if s["same_region"] else "; NOT connected by land to the starts")})

    key = remaster_key(mapid)
    x_info = xml.get(key)
    xml_check = None
    if x_info:
        xml_cells = x_info["waypoints"]
        mine = [wps[n] for n in range(26) if wps.get(n, -1) != -1]
        xml_check = (xml_cells == mine and (x_info["x"], x_info["y"], x_info["w"], x_info["h"]) == (X, Y, W, H))
        if not xml_check:
            issues.append("Remastered preview XML disagrees: window %s waypoints %s"
                          % ((x_info["x"], x_info["y"], x_info["w"], x_info["h"]), xml_cells))

    cnt = mc.counts(cells)
    n_units = len(ini.get("UNITS", {}))
    n_inf = len(ini.get("INFANTRY", {}))
    notes = [
        "Tiberian Dawn multiplayer map '%s' (%s), theater %s. Grid = the [MAP] window "
        "X=%d Y=%d %dx%d of the 64x64 map." % (name, mapid, theater, X, Y, W, H),
        "Land types per template icon from TIBERIANDAWN/CDATA.CPP (TemplateTypeClass Land/AltLand/AltIcons; "
        "roads are LAND_CLEAR there and are marked 'r' by their TXT_ROAD name, bridge decks '=' by BRIDGE* "
        "alt icons); overlay lands from ODATA.CPP; terrain-object and building footprints from "
        "CnCTDRAMapEditor/TiberianDawn/TerrainTypes.cs and BuildingTypes.cs.",
        "%d start waypoint(s) (valid waypoints 0-25, index order); up to %d players (MAX_PLAYERS 6)."
        % (sum(1 for s in starts if not s.get("suggested")), players),
    ]
    if suggested:
        notes.append("Fewer than 3 starts in the level: %d suggested marker(s) added (open area far "
                     "from the starts), flagged suggested." % len(suggested))
    notes.append("Objects: terrain %s; overlay %s; %d civilian/other structures ('#'); "
                 "%d units and %d infantry ignored (civilians, visceroids)."
                 % (sum(tr_counts.values()), sum(ov_counts.values()), len(structures), n_units, n_inf))
    if xml_check:
        notes.append("Window and start cells agree with the Remastered CNCMAPPREVIEWDATA.XML entry %s." % x_info["name"])
    if issues:
        notes.append("Issues: " + "; ".join(issues) + ".")

    out = {
        "source": "C&C Remastered Tiberian Dawn: %s :: %s.INI + %s.BIN" % (rec["where"].replace("\\", "/"), mapid, mapid),
        "name": name,
        "id": mapid,
        "width": W,
        "height": H,
        "cells": cells,
        "legend": LEGEND,
        "starts": starts,
        "notes": " ".join(notes),
        "players": players,
        "theater": theater,
        "map_window": {"x": X, "y": Y, "width": W, "height": H},
        "remaster_id": x_info["name"] if x_info else None,
        "counts": cnt,
        "objects": {"terrain": dict(sorted(tr_counts.items())), "overlay": dict(sorted(ov_counts.items())),
                    "structures": structures, "units": n_units, "infantry": n_inf},
        "alternates": [{"x": a["x"], "y": a["y"], "clearance": a["clearance"]} for a in alternates],
    }
    jpath = os.path.join(out_dir, mapid + ".json")
    mc.write_json(jpath, out)
    mc.write_preview(os.path.join(out_dir, mapid + ".png"), cells, starts, alternates)
    return out, issues


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--game", default=DEFAULT_GAME)
    ap.add_argument("--src", default=DEFAULT_SRC,
                    help="EA source release (TIBERIANDAWN + CnCTDRAMapEditor)")
    ap.add_argument("--out", default=os.path.join(REPO, "work", "maps", "cnc"))
    args = ap.parse_args()
    if not os.path.isdir(os.path.join(args.src, "TIBERIANDAWN")):
        alt = os.path.join(args.game, "SOURCECODE")
        if os.path.isdir(os.path.join(alt, "TIBERIANDAWN")):
            args.src = alt
    os.makedirs(args.out, exist_ok=True)

    tables = load_tables(args.src)
    templates, overlays, terrain, buildings, mismatches = tables
    print("templates %d, overlays %d, terrain masks %d, building masks %d, editor mismatches %d"
          % (len(templates), len(overlays), len(terrain), len(buildings), len(mismatches)))
    for m in mismatches[:10]:
        print("  editor/CDATA mismatch:", m)
    xml = preview_xml(args.game)
    found = find_maps(args.game)
    print("maps found: %d; Remastered list entries: %d" % (len(found), len(xml)))

    index = []
    for mapid in sorted(found):
        out, issues = convert(mapid, found[mapid], tables, xml, args.out)
        real = [s for s in out["starts"] if not s.get("suggested")]
        index.append({"id": mapid, "name": out["name"], "width": out["width"], "height": out["height"],
                      "players": out["players"], "start_markers": len(real),
                      "suggested_markers": len(out["starts"]) - len(real),
                      "theater": out["theater"], "file": mapid + ".json", "preview": mapid + ".png"})
        print("%-8s %-40s %2dx%-2d starts %d%s%s" % (
            mapid, out["name"][:40], out["width"], out["height"], len(real),
            " +%d suggested" % (len(out["starts"]) - len(real)) if len(out["starts"]) > len(real) else "",
            "  ISSUES: " + "; ".join(issues) if issues else ""))
    listed = set(xml)
    missing = sorted(k for k in listed if not any(remaster_key(m) == k for m in found))
    if missing:
        print("in the Remastered list but not found:", missing)
    mc.write_json(os.path.join(args.out, "index.json"),
                  {"game": "Command & Conquer: Tiberian Dawn (Remastered)", "legend": LEGEND, "maps": index})
    n = mc.rebuild_index(os.path.dirname(args.out))
    print("wrote %d maps to %s (combined index: %d maps)" % (len(index), args.out, n))


if __name__ == "__main__":
    main()

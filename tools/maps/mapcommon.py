"""Shared pieces for the map extractors in tools/maps/.

Every extractor writes one JSON per map:

    {"source": "...", "name": "...", "width": W, "height": H,
     "cells": ["row strings", ...],          one character per cell, see LEGEND
     "legend": {char: meaning},
     "starts": [{"x": .., "y": .., "from": "...", ...}, ...],   0-based cell coords
     "notes": "...",
     ... extra keys per game (documented in each extractor)}

`starts` holds only positions a base can go (tools/convert_maps.py turns every
entry into a base).  Entries invented here rather than read from the level
carry "suggested": true.  Further candidates that are not needed to reach the
minimum go to "alternates", which the converter ignores.

Also here: the PNG preview (one cell = one square, starts marked), the
start-suggestion search, and the index writer.
"""

import json
import math
import os
from collections import deque

# One alphabet for both games.  Each extractor puts the subset it uses, with
# game-specific wording, into every map's "legend".
LEGEND = {
    ".": "open ground: walkable, buildable",
    ",": "open ground the source game will not build on (walkable)",
    "r": "road (walkable, buildable)",
    "^": "rock / cliff: impassable terrain",
    "~": "water",
    "T": "tree",
    "*": "tiberium / crystal field (harvestable)",
    "w": "well tap / crystal source",
    "=": "bridge deck",
    "#": "blocked by an object (building, wall, civilian structure)",
}

COLORS = {
    ".": (178, 160, 110),
    ",": (218, 202, 152),
    "r": (128, 120, 112),
    "^": (86, 66, 56),
    "~": (40, 90, 200),
    "T": (24, 100, 36),
    "*": (60, 230, 150),
    "w": (235, 40, 205),
    "=": (215, 130, 40),
    "#": (40, 40, 40),
}
UNKNOWN_COLOR = (255, 0, 0)

TEAM_COLORS = [(230, 40, 40), (40, 110, 255), (250, 210, 20), (40, 200, 60),
               (250, 130, 20), (170, 60, 220), (20, 210, 210), (240, 240, 240)]

# What the start suggestion may put a base on, and what counts as passable
# when deciding which open areas are reachable from the recorded starts.
# Trees and crystals are passable here because the target game makes them
# walkable crystal cells.
DEFAULT_BUILDABLE = set(".r")
DEFAULT_PASSABLE = set(".,r=T*w")


# --------------------------------------------------------------- suggestions --

def clearance_map(cells, buildable):
    """Chebyshev distance to the nearest non-buildable cell (outside counts as
    non-buildable), minus one: the radius of the largest square of buildable
    ground centred on the cell.  -1 for non-buildable cells."""
    h = len(cells)
    w = len(cells[0])
    INF = 1 << 30
    dist = [[INF] * w for _ in range(h)]
    q = deque()
    for y in range(h):
        for x in range(w):
            if cells[y][x] not in buildable:
                dist[y][x] = 0
                q.append((x, y))
            elif x == 0 or y == 0 or x == w - 1 or y == h - 1:
                dist[y][x] = 1          # the outside is one step away
                q.append((x, y))
    while q:
        x, y = q.popleft()
        d = dist[y][x] + 1
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                xx, yy = x + dx, y + dy
                if 0 <= xx < w and 0 <= yy < h and dist[yy][xx] > d:
                    dist[yy][xx] = d
                    q.append((xx, yy))
    return [[dist[y][x] - 1 for x in range(w)] for y in range(h)]


def components(cells, passable):
    """4-connected components of passable cells: (label grid, sizes)."""
    h = len(cells)
    w = len(cells[0])
    lab = [[-1] * w for _ in range(h)]
    sizes = []
    for y0 in range(h):
        for x0 in range(w):
            if lab[y0][x0] != -1 or cells[y0][x0] not in passable:
                continue
            n = len(sizes)
            lab[y0][x0] = n
            q = deque([(x0, y0)])
            size = 0
            while q:
                x, y = q.popleft()
                size += 1
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    xx, yy = x + dx, y + dy
                    if 0 <= xx < w and 0 <= yy < h and lab[yy][xx] == -1 \
                            and cells[yy][xx] in passable:
                        lab[yy][xx] = n
                        q.append((xx, yy))
            sizes.append(size)
    return lab, sizes


def suggest_starts(cells, existing, want=3, extra=2, buildable=None,
                   passable=None, min_clearance=3):
    """Pick open areas far from the existing starts and from each other.

    existing: [(x, y)].  Returns (suggested, alternates): enough suggestions to
    bring the total to `want`, then up to `extra` alternates.  Each is a dict
    with x, y, clearance (radius of open square around it) and the distance to
    the nearest other marker.

    Candidates must be buildable with an open square around them (5x5
    preferred, 3x3 at worst) and lie in a passable region that holds one of
    the existing starts (or the largest region when there are none); other
    regions only when those run out ("same_region": false).  Greedy
    farthest-point choice: the score is the distance to the nearest marker,
    discounted by up to 30% for spots with less than `min_clearance` room.
    """
    buildable = buildable or DEFAULT_BUILDABLE
    passable = passable or DEFAULT_PASSABLE
    h = len(cells)
    w = len(cells[0])
    need = max(0, want - len(existing))
    total = need + (extra if need else 0)
    if total == 0:
        return [], []
    clear = clearance_map(cells, buildable)
    lab, sizes = components(cells, passable | buildable)
    regions = set()
    for (x, y) in existing:
        if 0 <= x < w and 0 <= y < h and lab[y][x] >= 0:
            regions.add(lab[y][x])
        else:
            # a start on a cell that is not passable here: take the regions
            # of its neighbourhood
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    xx, yy = x + dx, y + dy
                    if 0 <= xx < w and 0 <= yy < h and lab[yy][xx] >= 0:
                        regions.add(lab[yy][xx])
    if not regions and sizes:
        regions = {max(range(len(sizes)), key=lambda i: sizes[i])}

    chosen = list(existing)
    picks = []
    diag = math.hypot(w, h)
    full = max(1, min_clearance)
    # Passes, loosest last: roomy spots (5x5 open) in the starts' own regions,
    # then any 3x3 spot there, then other regions, then rooms allowed closer.
    far = max(6, min(w, h) // 6)
    for pass_regions, sep, rmin in ((regions, far, 2), (regions, far, 1),
                                    (None, far, 2), (None, far, 1), (None, 3, 1)):
        if len(picks) >= total:
            break
        picks += _pick(cells, clear, lab, pass_regions, chosen, total - len(picks),
                       sep, full, diag, rmin)
    return picks[:need], picks[need:]


def _pick(cells, clear, lab, regions, chosen, total, sep, full, diag, rmin=1):
    h = len(cells)
    w = len(cells[0])
    picks = []
    cands = [(x, y) for y in range(h) for x in range(w)
             if clear[y][x] >= rmin and (regions is None or lab[y][x] in regions)
             and all(math.hypot(x - cx, y - cy) >= sep for (cx, cy) in chosen)]
    # thin the candidate list on big maps; every other cell is plenty
    if len(cands) > 6000:
        cands = [(x, y) for (x, y) in cands if (x + y) % 2 == 0]
    while len(picks) < total and cands:
        best = None
        for (x, y) in cands:
            if chosen:
                d = min(math.hypot(x - cx, y - cy) for (cx, cy) in chosen)
            else:
                # nothing to be far from: prefer the middle of the largest room
                d = diag - math.hypot(x - w / 2.0, y - h / 2.0)
            room = min(clear[y][x], full) / float(full)
            score = d * (0.7 + 0.3 * room) + 0.01 * clear[y][x]
            if best is None or score > best[0]:
                best = (score, x, y, d)
        _, x, y, d = best
        picks.append({"x": x, "y": y, "clearance": clear[y][x],
                      "nearest_marker": round(d, 1) if chosen else None,
                      "same_region": regions is not None})
        chosen.append((x, y))
        # do not pick the same room twice
        cands = [(cx, cy) for (cx, cy) in cands
                 if math.hypot(cx - x, cy - y) >= sep]
    return picks


# ------------------------------------------------------------------ preview --

def write_preview(path, cells, starts, alternates=(), outlines=(), scale=None):
    """PNG: one square per cell, starts as numbered discs (hollow when
    suggested), alternates as small hollow squares, `outlines` as rectangles
    [(x, y, w, h, (r, g, b))]."""
    from PIL import Image, ImageDraw, ImageFont
    h = len(cells)
    w = len(cells[0])
    if scale is None:
        scale = max(4, 512 // max(w, h))
    img = Image.new("RGB", (w * scale, h * scale))
    px = img.load()
    for y, row in enumerate(cells):
        for x, ch in enumerate(row):
            col = COLORS.get(ch, UNKNOWN_COLOR)
            for yy in range(y * scale, (y + 1) * scale):
                for xx in range(x * scale, (x + 1) * scale):
                    px[xx, yy] = col
    d = ImageDraw.Draw(img)
    for (x, y, bw, bh, col) in outlines:
        d.rectangle([x * scale, y * scale, (x + bw) * scale - 1, (y + bh) * scale - 1],
                    outline=col, width=max(1, scale // 4))
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None
    r = max(4, int(scale * 1.6))
    for a in alternates:
        cx = a["x"] * scale + scale // 2
        cy = a["y"] * scale + scale // 2
        d.rectangle([cx - r // 2, cy - r // 2, cx + r // 2, cy + r // 2],
                    outline=(255, 255, 255), width=1)
    for i, s in enumerate(starts):
        cx = s["x"] * scale + scale // 2
        cy = s["y"] * scale + scale // 2
        team = s.get("team")
        col = TEAM_COLORS[(team if isinstance(team, int) and team >= 0 else i) % len(TEAM_COLORS)]
        if s.get("suggested"):
            d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 255, 0), width=max(2, scale // 3))
            label = "S"
        else:
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col, outline=(0, 0, 0), width=2)
            label = str(i)
        if font is not None:
            d.text((cx - 3 * len(label), cy - 5), label, fill=(0, 0, 0) if not s.get("suggested") else (255, 255, 0), font=font)
    img.save(path)


# -------------------------------------------------------------------- output --

def counts(cells):
    c = {}
    for row in cells:
        for ch in row:
            c[ch] = c.get(ch, 0) + 1
    return dict(sorted(c.items()))


def write_json(path, obj):
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(obj, fh, indent=1, ensure_ascii=False)
        fh.write("\n")


def rebuild_index(maps_root):
    """work/maps/index.json from the per-game indexes that exist."""
    entries = []
    for game in ("cnc", "lego"):
        p = os.path.join(maps_root, game, "index.json")
        if os.path.isfile(p):
            with open(p, encoding="utf-8") as fh:
                for e in json.load(fh)["maps"]:
                    e = dict(e)
                    e["game"] = game
                    e["file"] = game + "/" + e["file"]
                    if e.get("preview"):
                        e["preview"] = game + "/" + e["preview"]
                    entries.append(e)
    write_json(os.path.join(maps_root, "index.json"),
               {"legend": LEGEND,
                "note": "One JSON per map in cnc/ and lego/; see each file's legend "
                        "and notes.  players = start markers read from the level "
                        "(suggested markers not counted).",
                "maps": entries})
    return len(entries)

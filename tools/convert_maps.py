"""
Maps from other games, as CrystAlien Conflict maps.

    python tools/convert_maps.py [INPUT_DIR ...]      (default: work/maps/cnc and work/maps/lego)

Reads the extracted grids (tools/maps/: one JSON per map, a character per cell -- see the
legend below -- and the players' start positions) and writes data/maps/<id>.json plus
data/maps/index.json, which the game plays as skirmish maps.

A CrystAlien map is a grid of the story's tiles (96x48 pixels each), encoded as the story's
maps are: two characters for its width and height, then a tile id per cell, all through
ascii2num's table.  Three things matter about a cell: rock (impassable), crystal (mined),
or open ground.  Rock regions and water are drawn with the story's own pieces, chosen by
which of a cell's eight neighbours are blocked -- the rule the story's maps follow, found by
counting, for every piece in them, the blocked neighbours around it (ROCK_TILES below): tiles
1-24 are rock, 29-44 the green acid pools the game has for water, 47 crystals.

What each source's cells become (the target game's owner decided the LEGO Battles ones):

    .  clear, r road, = bridge ................ open ground (there are no bridge tiles; a LEGO
                                                 Battles bridge site, where a bridge could be
                                                 built, is open ground too, so the map stays
                                                 connected as its designers meant)
    ^  rock, cliff, # other blockers .......... rock
    ~  water, river ........................... acid pool
    *  tiberium / crystal ..................... crystals
    T  tree ................................... rock in C&C, crystals in LEGO Battles
    w  well tap ............................... crystals

Which maps: Command & Conquer's skirmish maps, and LEGO Battles' free-play maps (mp01 to
mp30), not either game's campaign.  (Of CrystAlien Conflict's own, the skirmish has Eclipse.)
"""

import json
import os
import re
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

OPEN, ROCK, POOL, CRYSTAL = 0, 1, 2, 3

# The story's pieces, by the eight neighbours: N NE E SE S SW W NW, 1 for blocked.  Edges
# and outer corners by which sides are open; inner corners by which diagonal is.
ROCK_TILES = {'interior': (12, 13, 16), 'N': 1, 'E': 2, 'S': 3, 'W': 4, 'NE': 5, 'SE': 6, 'SW': 7, 'NW': 8,
              'in_NE': 11, 'in_SE': 12, 'in_SW': 13, 'in_NW': 14, 'in_SE_NW': 15, 'in_NE_SW': 16,
              'tip_S': 17, 'tip_N': 22, 'tip_E': 23, 'tip_W': 19, 'alone': 20}
POOL_TILES = {'interior': (37, 37, 37, 37, 37, 37, 37, 38), 'N': 29, 'E': 30, 'S': 31, 'W': 32, 'NE': 33, 'SE': 34, 'SW': 35, 'NW': 36,
              'in_NE': 39, 'in_SE': 40, 'in_SW': 41, 'in_NW': 42, 'in_SE_NW': 44, 'in_NE_SW': 43}
CRYSTAL_TILE = 47


def classify(ch, source):
    if ch in '^#':
        return ROCK
    if ch == '~':
        return POOL
    if ch in '*w':
        return CRYSTAL
    if ch == 'T':
        return CRYSTAL if source == 'lego' else ROCK
    return OPEN


def ascii_table():
    s = open(os.path.join(ROOT, 'src', 'scripts', 'game.js'), encoding='utf-8').read()
    m = re.search(r'ascii2num = function ascii2num\(char\)\s*\{\s*var _loc3_ = new Array\((.*?)\);', s, re.S)
    return json.loads('[' + m.group(1) + ']')


def clean(grid, w, h):
    """Rock or water one cell thin cannot be drawn with the story's pieces; open it up (a
    single cell) or thicken nothing -- lines one cell wide become open ground."""
    out = [row[:] for row in grid]
    for y in range(h):
        for x in range(w):
            c = grid[y][x]
            if c not in (ROCK, POOL):
                continue
            def same(dx, dy):
                xx, yy = x + dx, y + dy
                return 0 <= xx < w and 0 <= yy < h and grid[yy][xx] in (ROCK, POOL)
            vertical = same(0, -1) or same(0, 1)
            horizontal = same(-1, 0) or same(1, 0)
            if not vertical and not horizontal:
                out[y][x] = OPEN
    return out


STEPS = ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1))


def reachable(grid, w, h, x0, y0):
    """The cells a ground unit at (x0, y0) can walk to."""
    seen = [[False] * w for _ in range(h)]
    todo = [(x0, y0)]
    while todo:
        x, y = todo.pop()
        if not (0 <= x < w and 0 <= y < h) or seen[y][x] or grid[y][x] in (ROCK, POOL):
            continue
        seen[y][x] = True
        todo.extend((x + dx, y + dy) for dx, dy in STEPS)
    return seen


def causeway(grid, w, h, starts):
    """If some base cannot walk to the first, lay ground across the least water that joins
    them (two cells wide, never through rock), and say so.  Islands a LEGO Battles player
    crossed by boat or by a bridge the map never records become reachable on foot."""
    land = reachable(grid, w, h, starts[0]['x'], starts[0]['y'])
    cut = [st for st in starts if not land[st['y']][st['x']]]
    if not cut:
        return False
    other = reachable(grid, w, h, cut[0]['x'], cut[0]['y'])
    # Breadth-first from all of the first base's land, through water only, to the other's.
    from collections import deque
    back = {}
    todo = deque()
    for y in range(h):
        for x in range(w):
            if land[y][x]:
                back[(x, y)] = None
                todo.append((x, y))
    end = None
    while todo and end is None:
        x, y = todo.popleft()
        for dx, dy in STEPS[:4]:
            nx, ny = x + dx, y + dy
            if not (0 <= nx < w and 0 <= ny < h) or (nx, ny) in back:
                continue
            if other[ny][nx]:
                back[(nx, ny)] = (x, y)
                end = (nx, ny)
                break
            if grid[ny][nx] == POOL:
                back[(nx, ny)] = (x, y)
                todo.append((nx, ny))
    if end is None:
        return False
    cell = back[end]
    laid = 0
    while cell is not None and not land[cell[1]][cell[0]]:
        x, y = cell
        for cx, cy in ((x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1)):
            if 0 <= cx < w and 0 <= cy < h and grid[cy][cx] == POOL:
                grid[cy][cx] = OPEN
                laid += 1
        cell = back[cell]
    print('  causeway of %d cells to the base at %d,%d' % (laid, cut[0]['x'], cut[0]['y']))
    return True


def report_unreachable(grid, w, h, starts, name):
    """Warn about base markers that cannot reach the first by land."""
    if not starts:
        return
    seen = [[False] * w for _ in range(h)]
    sx, sy = starts[0]['x'], starts[0]['y']
    todo = [(sx, sy)]
    while todo:
        x, y = todo.pop()
        if not (0 <= x < w and 0 <= y < h) or seen[y][x] or grid[y][x] in (ROCK, POOL):
            continue
        seen[y][x] = True
        todo.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1), (x + 1, y + 1), (x - 1, y - 1), (x + 1, y - 1), (x - 1, y + 1)))
    cut = [i for i, st in enumerate(starts) if not seen[st['y']][st['x']] if 0 <= st['x'] < w and 0 <= st['y'] < h]
    if cut:
        print('  %s: base markers %s cannot reach marker 0 by land' % (name, cut))


def piece(grid, w, h, x, y):
    """Which of the story's pieces a blocked cell takes."""
    def b(dx, dy):
        xx, yy = x + dx, y + dy
        if not (0 <= xx < w and 0 <= yy < h):
            return True
        return grid[yy][xx] in (ROCK, POOL)
    n, e, s, wst = b(0, -1), b(1, 0), b(0, 1), b(-1, 0)
    ne, se, sw, nw = b(1, -1), b(1, 1), b(-1, 1), b(-1, -1)
    if n and e and s and wst:
        open_diagonals = [k for k, v in (('NE', ne), ('SE', se), ('SW', sw), ('NW', nw)) if not v]
        if not open_diagonals:
            return 'interior'
        if set(open_diagonals) == {'SE', 'NW'}:
            return 'in_SE_NW'
        if set(open_diagonals) == {'NE', 'SW'}:
            return 'in_NE_SW'
        return 'in_' + open_diagonals[0]
    if not n and e and s and wst:
        return 'N'
    if n and not e and s and wst:
        return 'E'
    if n and e and not s and wst:
        return 'S'
    if n and e and s and not wst:
        return 'W'
    if not n and not e and s and wst:
        return 'NE'
    if n and not e and not s and wst:
        return 'SE'
    if n and e and not s and not wst:
        return 'SW'
    if not n and e and s and not wst:
        return 'NW'
    # A ridge or a tip: the edge piece of the side most of it faces.
    if n and not e and not s and not wst:
        return 'tip_N'
    if s and not n and not e and not wst:
        return 'tip_S'
    if e and not n and not s and not wst:
        return 'tip_E'
    if wst and not n and not s and not e:
        return 'tip_W'
    if n and s:
        return 'E' if not e else 'W'
    if e and wst:
        return 'N' if not n else 'S'
    return 'alone'


def tidy(name):
    """The maps' names as the lobby shows them: the community maps' author tags and version
    notes dropped, and names in capitals in title case."""
    name = re.sub(r'^\s*[\[(][^\])]*[\])]\s*', '', name)
    name = re.sub(r'\s*\((Symmetrical|v)[^)]*\)\s*$', '', name)
    if name.isupper():
        name = name.title()
    return name.strip()


def convert(path, source, table):
    src = json.load(open(path, encoding='utf-8'))
    w, h = src['width'], src['height']
    grid = [[classify(ch, source) for ch in row[:w].ljust(w, '.')] for row in src['cells'][:h]]
    for site in src.get('bridge_sites', []):
        for y in range(site['y'], site['y'] + site['h']):
            for x in range(site['x'], site['x'] + site['w']):
                if 0 <= x < w and 0 <= y < h and grid[y][x] in (ROCK, POOL):
                    grid[y][x] = OPEN
    grid = clean(grid, w, h)
    starts = src.get('starts', [])[:6]
    for _ in range(len(starts)):
        if not causeway(grid, w, h, starts):
            break
    report_unreachable(grid, w, h, starts, os.path.basename(path))
    ids = []
    for y in range(h):
        for x in range(w):
            c = grid[y][x]
            if c == CRYSTAL:
                ids.append(CRYSTAL_TILE)
            elif c in (ROCK, POOL):
                key = piece(grid, w, h, x, y)
                tiles = POOL_TILES if c == POOL else ROCK_TILES
                tile = tiles.get(key, tiles['interior'])
                # Solid rock (the story has none big enough to need it) is its fullest pieces,
                # varied by position so that it does not repeat.
                if isinstance(tile, tuple):
                    tile = tile[(x * 7 + y * 13) % len(tile)]
                ids.append(tile)
            else:
                ids.append(0)
    encoded = table[w] + table[h] + ''.join(table[i] for i in ids)
    bases = [{'x': s['x'] + 1, 'y': s['y'] + 1} for s in src.get('starts', [])]
    return {'name': tidy(src.get('name', os.path.splitext(os.path.basename(path))[0])), 'source': source,
            'cols': w, 'rows': h, 'map': encoded, 'bases': bases, 'players': len(bases)}


def main():
    dirs = sys.argv[1:] or [os.path.join(ROOT, 'work', 'maps', 'cnc'), os.path.join(ROOT, 'work', 'maps', 'lego')]
    table = ascii_table()
    out_dir = os.path.join(ROOT, 'data', 'maps')
    os.makedirs(out_dir, exist_ok=True)
    index = []
    for d in dirs:
        source = 'lego' if 'lego' in os.path.basename(d.rstrip('/\\')).lower() else 'cnc'
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if not f.endswith('.json') or f == 'index.json':
                continue
            if source == 'lego' and not re.match(r'mp\d+\.json$', f):
                continue
            m = convert(os.path.join(d, f), source, table)
            mid = source + '-' + re.sub(r'[^a-z0-9]+', '-', os.path.splitext(f)[0].lower()).strip('-')
            m['id'] = mid
            with open(os.path.join(out_dir, mid + '.json'), 'w', encoding='utf-8', newline='\n') as fh:
                json.dump(m, fh, separators=(',', ':'), ensure_ascii=False)
            index.append({'id': mid, 'name': m['name'], 'source': source, 'cols': m['cols'], 'rows': m['rows'], 'players': m['players']})
            print('%-28s %3dx%-3d %d players' % (mid, m['cols'], m['rows'], m['players']))
    with open(os.path.join(out_dir, 'index.json'), 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(index, fh, indent=1, ensure_ascii=False)
    print('%d maps -> data/maps' % len(index))


if __name__ == '__main__':
    main()

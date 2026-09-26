// The computer players: the Command & Conquer mod's (CrystAlien Conflict Factions) opponent,
// ported to the game's own engine.  docs/cnc-ai-spec.md is the specification it follows,
// section by section (the § numbers below); where the mod's code and its intent differ, the
// port follows the code unless the code is a plain slip, and says so.
//
// The mod thinks at Command & Conquer's 15 ticks a second; the game runs at 23 frames a
// second.  A Bot keeps the mod's clock -- 15/23 of a tick a frame -- so that every cadence
// and phase offset is the mod's.
//
// A Bot plays by the player's rules: it builds through a Production (one building and one
// unit at a time, paid for as they progress), places buildings where the building site
// allows, and moves its units with the orders a player's clicks give.  It runs in the game's
// simulation, the same in every browser of an online match: all its randomness is the game's
// seeded random().

const TICKS_PER_FRAME = 15 / 23;

// How each difficulty plays (the online game's own: the mod's opponent is Hard, as it was).
// Medium and Easy build slower, mine with fewer miners, keep smaller armies and fewer guns, stay
// quiet longer at the start -- no raids either -- then raid and attack less often and with
// fewer units, and answer an attack more slowly; Easy builds no superweapon.  (Times in the
// mod's ticks, fifteen a second.)
//   speed        building speed (a player's is 8)
//   miners       how many miners it keeps
//   army         how many vehicles, and how many infantry, at most
//   guns         defences at most
//   quiet        no attack before this (and, but for Hard, no raid)
//   attackEvery  the time between attacks, times this
//   share        of 4, how many of its armed units go on an attack
//   raidEvery    a raid this often, unthreatened; raidThreatened when under attack
//   raidSize     units sent on a raid (three more when under attack)
//   aggression, patrol  how often it looks for trouble and patrols
//   react        as a person must click: how long after one thing is made it starts the next,
//                and after a building is ready it puts it down
//   hunters   of each new fighting unit, the chance in 100 it is sent hunting (the rest keep
//             to the base, until it is attacked or an attack takes them)
//   buildGap  ticks between one building and starting the next, unless it is needed now
//   buildings how many buildings it keeps, unless one is needed now (power, a first miner)
//   outposts  crystal outposts (BL), at most; reach: minutes for each 8 cells they may go out
//   sortieGap ticks from one Boomerang sortie to the next it may send (none in the quiet start)
const PROFILES = {
  easy: { react: 90, speed: 3, miners: 2, army: 4, guns: 2, quiet: 9000, attackEvery: 5, share: 1, raidEvery: 3600, raidThreatened: 360, raidSize: 2, aggression: 90, hunters: 10, patrol: 1800, superweapon: false, buildGap: 1200, buildings: 10, outposts: 2, reach: 9, sortieGap: 2700 },
  medium: { react: 45, speed: 5, miners: 3, army: 7, guns: 6, quiet: 5400, attackEvery: 2.5, share: 2, raidEvery: 1800, raidThreatened: 240, raidSize: 3, aggression: 45, hunters: 30, patrol: 900, superweapon: true, buildGap: 750, buildings: 14, outposts: 3, reach: 5, sortieGap: 1350 },
  hard: { react: 15, speed: 8, miners: 4, army: 10, guns: 40, quiet: 900, attackEvery: 1, share: 3, raidEvery: 450, raidThreatened: 180, raidSize: 7, aggression: 30, hunters: 100, patrol: 300, superweapon: true, buildGap: 0, buildings: Infinity, outposts: 4, reach: 3, sortieGap: 0 },
};
const CELL = 96;                              // a tile, in world pixels

const NONE = 0, LOW = 1, MEDIUM = 2, HIGH = 3, CRITICAL = 4;

// §0.4: who builds what.
const VEHICLES = ['UD', 'UE', 'UF', 'UR'];
const INFANTRY = ['UA', 'UB', 'UJ', 'UM', 'UN', 'UQ'];
const AIRCRAFT = ['UC', 'UG', 'UH', 'UP'];
const kindOf = (code) => (VEHICLES.includes(code) ? 'vehicle' : INFANTRY.includes(code) ? 'infantry' : AIRCRAFT.includes(code) ? 'aircraft' : 'building');

// §2.3: ratio targets, in 256ths of the number of buildings.
const RATIO = { barracks: 40, factory: 25, defence: 102, aa: 36, helipad: 30, airstrip: 30 };

// Octagonal distance in cells, as the engine measures (§0.2).
function cells(ax, ay, bx, by) {
  const dx = Math.abs(ax - bx) / CELL, dy = Math.abs(ay - by) / CELL;
  return Math.max(dx, dy) + Math.min(dx, dy) / 2;
}

// §2.3 RoundUp, quirk and all.
function roundUp(r, n) {
  const v = (r * n) & 0xffff;
  if (v % 256 === 0) return v;
  return Math.floor(v / 256) + 1;
}

export class Bot {
  constructor(level, player, rng) {
    this.level = level;
    this.player = player;
    this.random = rng;                       // (n) => 0..n-1, the game's seeded generator
    this.difficulty = PROFILES[player.difficulty] ? player.difficulty : 'medium';
    this.profile = PROFILES[this.difficulty];
    this.tick = 0;
    this.clock = 0;
    this.id = 4 + player.index;              // the mod's house enum, for phase offsets
    // The four wants (§3.1) and the aircraft decision held for 5 s (§3.5).
    this.want = { building: null, vehicle: null, infantry: null, aircraft: null };
    this.aircraftHeld = null;
    this.aircraftHeldAt = -1e9;
    this.roundRobin = 0;
    this.lastHit = -1e9;                     // §4.3: when an own building last took damage
    this.defended = new Map();               // §6.3: attacker -> tick its response may repeat
    this.attackTimer = this.profile.quiet;   // §6.4: the first minute is quiet (longer, below Hard)
    this.expertTimer = 75;
    this.scouted = null;                     // §4.6
    this.placeWait = 0;
    this.placing = null;
    this.readyAt = { unit: 0, building: 0 };  // when it may start the next of each (react)
    this.lastBuilt = -1e9;                   // when a building was last in production (buildGap)
    this.wantUrgent = false;                 // the building chosen is needed now
    this.lastSortie = -1e9;                  // when its Boomerangs were last sent (sorties)
    // Building speed: a player's is 8; the computer never waits to click, so below Hard it
    // builds slower.
    this.speed = this.profile.speed;
    this.production = null;                  // set by the level (Production)
  }

  // ---- the game's side ------------------------------------------------------------------------
  get arena() { return this.level.arena; }
  get settings() { return this.level.skirmish || {}; }
  own(test) { return this.level.units.filter((u) => u.active && u.owner === this.player && !u.stats.pickup && (!test || test(u))); }
  ownBuildings(test) { return this.level.buildings.filter((b) => b.active && b.owner === this.player && (!test || test(b))); }
  code(obj) { return obj.type.substr(0, 2); }
  side(obj) { return obj.type.substr(3); }
  mine(code) { return code + '_' + this.player.faction; }
  hostile(obj) { return this.level.hostile(obj, this.player); }
  armed(u) { return !!u.stats.weapon; }
  isMiner(u) { return !!u.stats.miner; }
  isEngineer(u) { return !!u.stats.repair; }
  isDecoy(u) { return kindOf(this.code(u)) === 'infantry' && !u.stats.weapon && !u.stats.repair; }
  isBoomerang(u) { return !!u.stats.boomerang; }
  aircraft(u) { return kindOf(this.code(u)) === 'aircraft'; }
  vehicle(u) { return kindOf(this.code(u)) === 'vehicle'; }
  infantry(u) { return kindOf(this.code(u)) === 'infantry'; }
  tileOf(obj) { return obj.isBuilding ? { x: obj.tilePos.x, y: obj.tilePos.y } : obj.tilePos; }
  centre(obj) { return { x: obj.posX, y: obj.posY }; }
  hasHQ(side) {
    return this.ownBuildings((b) => (this.code(b) === 'BA' || this.code(b) === 'BK') && (!side || this.side(b) === side)).length > 0;
  }
  pizzaProtected(b) { return this.settings.mode === 'pizza' && b.isBuilding && this.code(b) === 'BA'; }
  underAttack() { return this.tick - this.lastHit < 900; }
  // Below Hard, the quiet start: nothing sent out -- no raid, patrol, hunt or capture -- unless
  // it is attacked.
  calm() { return this.difficulty !== 'hard' && this.tick < this.profile.quiet && !this.underAttack(); }

  // ---- the clock -----------------------------------------------------------------------------
  // Called by the level every frame, after this player's production.
  frame() {
    this.clock += TICKS_PER_FRAME;
    while (this.clock >= 1) {
      this.clock -= 1;
      this.tick++;
      this.runTick();
    }
  }

  every(n, phase = 0) { return (this.tick + phase) % n === 0; }

  // §1.2, in the mod's order.
  runTick() {
    const t = this.tick;
    if (this.every(7) && (t + 7 * this.id) % 15 === 0) this.collect();
    if (this.every(this.profile.aggression)) this.aggression();
    if ((t + this.id) % (this.underAttack() ? this.profile.raidThreatened : this.profile.raidEvery) === 0) this.raid();
    if (!this.underAttack() && this.every(this.profile.patrol, 13 * this.id)) this.patrol();
    if (this.every(7)) this.repair();
    if (this.settings.mode === 'ctf' && this.every(7)) this.flagRun();
    if (this.settings.mode === 'ctf' && this.every(30)) this.flagGuard();
    if (this.every(15, 5 * this.id)) this.scout();
    if (this.every(15, 11 * this.id)) this.airlift();
    if (this.every(15, 7 * this.id)) this.infiltrate();
    if (this.every(15, 3 * this.id)) this.missions();
    this.idleWatch();
    if (this.settings.mode === 'pizza' && this.every(15, 13 * this.id)) this.pizza();
    if (--this.expertTimer <= 0) {
      this.expertTimer = 75 + 1 + this.random(7);
      this.expert();
    }
    this.buildings();
    this.units();
    this.place();
    this.superweapon();
  }

  // ---- §2: base building ---------------------------------------------------------------------
  tech() { return this.level.techFor(this.player); }

  inProduction(type) {
    const p = this.production;
    return (p.building && p.building.type === type ? 1 : 0) + (p.unit && p.unit.type === type ? 1 : 0);
  }

  count(type) { return this.level.countOwned(type, this.player) + this.inProduction(type); }

  statsOf(type) { return type[0] === 'B' ? this.level.statsOfType(type) : this.level.statsOfType(type); }

  canBuild(type) {
    if (!type || !this.tech()[type]) return false;
    const st = this.statsOf(type);
    return this.count(type) < (st.max === undefined ? 1 : st.max);
  }

  // The slot a role is built in: this side's, or the other side's where only a captured tree
  // allows it (§2.4).
  slot(code) {
    const own = code + '_' + this.player.faction;
    const other = code + '_' + (this.player.faction === 'good' ? 'evil' : 'good');
    if (this.canBuild(own)) return own;
    if (this.canBuild(other)) return other;
    return own;
  }

  power() {
    const charge = this.player.powerCharge || 0, drain = this.player.powerDrain || 0;
    const net = charge - drain;
    return { charge, drain, net, state: net < 0 ? 'off' : net < 50 ? 'low' : 'full' };
  }

  drainOf(type) {
    const p = this.statsOf(type).power || 0;
    return p < 0 ? -p : 0;
  }

  canPower(type) {
    const d = this.drainOf(type);
    return !d || this.power().net - d >= 0;
  }

  miners() { return this.own((u) => this.isMiner(u)).length + (this.production.unit && this.code(this.production.unit) === 'UD' ? 1 : 0); }

  hasIncome() { return this.ownBuildings((b) => b.type === this.mine('BA')).length > 0 && this.miners() > 0; }

  affordable(type) { return this.statsOf(type).cost < this.player.cash || this.hasIncome(); }

  airThreat() {
    return this.level.units.some((u) => u.active && u.owner && this.level.hostile(u, this.player) && this.aircraft(u));
  }

  buildingCount() { return this.ownBuildings().length + (this.production.building ? 1 : 0); }

  // §2.2: what to build next, if nothing is chosen.
  buildings() {
    if (this.want.building && !this.canBuild(this.want.building)) this.want.building = null;
    if (!this.want.building) this.want.building = this.plan();
    const p = this.production;
    if (p.building) {
      this.readyAt.building = this.tick + this.profile.react;
      this.lastBuilt = this.tick;
    }
    // (below Hard, a pause between buildings, unless the one chosen is needed now)
    const gap = this.wantUrgent ? 0 : this.profile.buildGap;
    if (this.want.building && !p.building && this.tick >= this.readyAt.building && this.tick >= this.lastBuilt + gap && this.player.cash > 10) {
      if (p.start(this.want.building)) this.want.building = null;
    }
  }

  plan() {
    const N = this.buildingCount();
    const pw = this.power();
    const powerneed = pw.state === 'off' ? HIGH : pw.state === 'low' ? MEDIUM : LOW;
    const wantpower = powerneed > LOW || (pw.charge - 50) <= pw.drain + 50;
    const tier = this.settings.specops === 'tech';
    const cash = this.player.cash;
    const income = this.hasIncome();
    const entries = [];
    const offer = (type, urgency) => entries.push([type, urgency]);
    const cur = (code) => this.count(code + '_good') + this.count(code + '_evil');

    const bb = this.slot('BB');
    if (this.canBuild(bb) && wantpower && this.affordable(bb)) offer(bb, powerneed);
    const bl = 'BL_' + this.player.faction;
    if (this.canBuild(bl) && this.affordable(bl)) offer(bl, this.miners() === 0 ? CRITICAL : MEDIUM);
    const bc = this.slot('BC');
    const curBC = cur('BC');
    if (curBC < roundUp(RATIO.barracks, N) && curBC < 2 && (cash > 300 || income) && this.canBuild(bc) && this.affordable(bc)) offer(bc, curBC > 0 ? LOW : MEDIUM);
    const be = this.slot('BE');
    const curBE = cur('BE');
    if (curBE < roundUp(RATIO.factory, N) && curBE < 2 && (cash > 2000 || income) && this.canBuild(be) && this.affordable(be)) offer(be, curBE > 0 ? LOW : MEDIUM);
    const bd = this.slot('BD');
    const curBD = cur('BD');
    if (curBD < roundUp(RATIO.defence, N) && curBD < this.profile.guns && this.canBuild(bd) && this.canPower(bd) && this.affordable(bd)) offer(bd, MEDIUM);
    if (curBD < roundUp(RATIO.aa, N) && curBD < Math.min(10, this.profile.guns) && this.airThreat()) {
      const bf = this.slot('BF');
      if (cur('BF') === 0 && this.canBuild(bf) && this.affordable(bf)) offer(bf, HIGH);
      if (this.canBuild(bd) && this.affordable(bd)) offer(bd, MEDIUM);
    }
    const bg = this.slot('BG');
    if (cur('BG') === 0 && this.canBuild(bg) && this.canPower(bg) && this.affordable(bg)) offer(bg, tier ? HIGH : MEDIUM);
    const bh = this.slot('BH');
    if (cur('BH') === 0 && this.canBuild(bh) && this.canPower(bh) && this.affordable(bh)) offer(bh, MEDIUM);
    if (this.count(bl) < this.profile.outposts && this.canBuild(bl) && this.canPower(bl) && this.affordable(bl)) offer(bl, this.settings.mode === 'pizza' ? CRITICAL : MEDIUM);
    // (Santa's Sleigh, the Aliens' building, is anyone's who has found a present.)
    const bj = 'BJ_evil';
    if (this.count(bj) < 1 && this.canBuild(bj) && this.affordable(bj)) offer(bj, MEDIUM);
    const extra = this.extra();
    if (extra && this.canBuild(extra) && this.canPower(extra) && this.affordable(extra)) offer(extra, MEDIUM);
    const bf = this.slot('BF');
    const curBF = cur('BF');
    if (curBF < roundUp(RATIO.helipad, N) && curBF < 5 && this.canBuild(bf) && this.affordable(bf)) offer(bf, MEDIUM);
    const bk = this.slot('BK');
    const curBK = cur('BK');
    if (curBK < roundUp(RATIO.airstrip, N) && curBK < 5 && this.canBuild(bk) && this.affordable(bk)) offer(bk, tier && curBK === 0 ? HIGH : MEDIUM);

    let best = null, bestUrgency = NONE;
    for (const [type, urgency] of entries) {
      if (urgency > bestUrgency) { best = type; bestUrgency = urgency; }
    }
    // (below Hard, a base of a size, beyond which only what is needed now is built)
    this.wantUrgent = bestUrgency >= HIGH;
    if (!this.wantUrgent && N >= this.profile.buildings) return null;
    return best;
  }

  // §2.4 CAC_AI_Extra: the first rung of the ladder this player does not own.
  extra() {
    for (const code of ['BA', 'BB', 'BC', 'BD', 'BE', 'BF', 'BG', 'BH']) {
      const type = this.mine(code);
      if (this.level.countOwned(type, this.player) === 0) return type;
    }
    return null;
  }

  // ---- §2.8: placing a finished building --------------------------------------------------
  baseCentre() {
    const bs = this.ownBuildings();
    if (!bs.length) return null;
    let wx = 0, wy = 0, wt = 0;
    for (const b of bs) {
      const w = b.stats.cost / 1000 + 1;
      wx += b.tilePos.x * w; wy += b.tilePos.y * w; wt += w;
    }
    const c = { x: wx / wt, y: wy / wt };
    let r = 0;
    for (const b of bs) r += Math.max(Math.abs(b.tilePos.x - c.x), Math.abs(b.tilePos.y - c.y)) + Math.min(Math.abs(b.tilePos.x - c.x), Math.abs(b.tilePos.y - c.y)) / 2;
    c.r = bs.length > 1 ? Math.max(2, r / bs.length) : 2;
    return c;
  }

  place() {
    const type = this.production.ready();
    if (!type) { this.placeWait = 0; this.placing = null; return; }
    // (a person takes a moment to put it down)
    if (this.placing !== type) { this.placing = type; this.placeWait = this.profile.react; }
    if (this.placeWait > 0) { this.placeWait--; return; }
    const site = this.findSite(type);
    if (site && this.production.place(site.x, site.y)) return;
    // Units in the way: try again in 3 s; nowhere at all: give it up, money back (§2.1).
    if (site) { this.placeWait = 45; return; }
    this.production.cancel(true);
  }

  findSite(type) {
    const c = this.baseCentre();
    if (!c) return null;
    const level = this.level;
    const code = type.substr(0, 2);
    if (code === 'BL') return this.crystalSite(type, c);
    const armed = !!this.statsOf(type).weapon;
    // §2.8 step 2: in Capture the Flag, guns go by the flag (where it lies, or its home).
    if (this.settings.mode === 'ctf' && (code === 'BD' || code === 'BK') && level.flagOf) {
      const flag = level.flagOf(this.player);
      const cell = flag && (flag.carrier ? flag.home : flag.cell);
      const site = cell && level.siteNear(type, this.player, cell, 5);
      if (site) return site;
    }
    // Zones: the core, and four sectors from R to 4R out (§2.8 step 3).  Guns go where there
    // are fewest guns; everything else to a random side.
    const zones = ['north', 'east', 'south', 'west'];
    let order;
    if (armed) {
      const guns = { core: 0, north: 0, east: 0, south: 0, west: 0 };
      for (const b of this.ownBuildings((x) => !!x.stats.weapon)) guns[this.zoneOf(b.tilePos, c)] += 1;
      order = ['core', ...zones].sort((a, b) => guns[a] - guns[b]);
    } else {
      const first = this.random(4);
      order = zones.map((_, i) => zones[(first + i) % 4]);
    }
    for (const zone of order) {
      const p = this.pointIn(zone, c);
      const site = level.siteNear(type, this.player, p, Math.max(3, Math.ceil(c.r)), (x, y) => this.zoneOf({ x, y }, c) !== null);
      if (site) return site;
    }
    // Outposts: near a building outside every zone (step 4).
    for (const b of this.ownBuildings((x) => this.zoneOf(x.tilePos, c) === null)) {
      const site = level.siteNear(type, this.player, b.tilePos, 4);
      if (site) return site;
    }
    // Anywhere near any building, before giving up.
    for (const b of this.ownBuildings()) {
      const site = level.siteNear(type, this.player, b.tilePos, 5);
      if (site) return site;
    }
    return null;
  }

  zoneOf(t, c) {
    const dx = t.x - c.x, dy = t.y - c.y;
    const d = Math.max(Math.abs(dx), Math.abs(dy)) + Math.min(Math.abs(dx), Math.abs(dy)) / 2;
    if (d <= c.r) return 'core';
    if (d > 4 * c.r) return null;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'east' : 'west';
    return dy > 0 ? 'south' : 'north';
  }

  pointIn(zone, c) {
    if (zone === 'core') {
      return { x: Math.round(c.x + this.random(2 * Math.ceil(c.r) + 1) - Math.ceil(c.r)), y: Math.round(c.y + this.random(2 * Math.ceil(c.r) + 1) - Math.ceil(c.r)) };
    }
    const d = 2 * c.r + this.random(Math.max(1, Math.ceil(c.r)));
    const across = this.random(2 * Math.ceil(d) + 1) - Math.ceil(d);
    const dir = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }[zone];
    return { x: Math.round(c.x + dir[0] * d + dir[1] * across), y: Math.round(c.y + dir[1] * d + dir[0] * across) };
  }

  // §2.8 step 1: a Driller on crystals, within a range that widens with time.
  crystalSite(type, c) {
    const arena = this.arena;
    const minutes = this.tick / 900;
    const diagonal = Math.hypot(arena.cols, arena.rows);
    const allowed = this.ownBuildings((b) => this.code(b) === 'BH').length ? diagonal : Math.min(Math.max(24, diagonal), 24 + 8 * Math.floor(minutes / this.profile.reach));
    let best = null, bestD = Infinity;
    for (let x = 1; x <= arena.cols; x++) {
      for (let y = 1; y <= arena.rows; y++) {
        if (!(arena.baits[x] && arena.baits[x][y])) continue;
        const d = cells(x * CELL, y * CELL, c.x * CELL, c.y * CELL);
        if (d > allowed || d >= bestD) continue;
        if (!this.level.siteValid(type, this.player, x, y)) continue;
        best = { x, y }; bestD = d;
      }
    }
    return best;
  }

  // ---- §3: units ---------------------------------------------------------------------------
  counts() {
    const all = this.own();
    const n = { vehicle: 0, infantry: 0, aircraft: 0 };
    for (const u of all) n[kindOf(this.code(u))] += 1;
    for (const u of all) if (u.stats.contents) for (const c of u.stats.contents) n[kindOf(this.code(c))] += 1;
    const pu = this.production.unit;
    if (pu) n[kindOf(pu.type.substr(0, 2))] += 1;
    return n;
  }

  ceiling(kind) {
    // §3.2: the ceilings come to about ten of each (the mod never finds an enemy to average).
    if (kind === 'vehicle') return Math.max(this.settings.units || 0, this.profile.army);
    return this.profile.army;
  }

  units() {
    const n = this.counts();
    this.chooseVehicle(n);
    this.chooseInfantry(n);
    this.chooseAircraft(n);
    const p = this.production;
    if (p.unit) this.readyAt.unit = this.tick + this.profile.react;
    if (p.unit || this.tick < this.readyAt.unit || this.player.cash <= 10) return;
    // One unit queue for the mod's several factories (§3.1 [port]): the pizza, then a miner,
    // then vehicles, infantry and aircraft in turn.
    const order = [];
    if (this.want.infantry && this.code({ type: this.want.infantry }) === 'UJ') order.push('infantry');
    if (this.want.vehicle && this.code({ type: this.want.vehicle }) === 'UD') order.push('vehicle');
    const turns = ['vehicle', 'infantry', 'aircraft'];
    for (let i = 0; i < 3; i++) order.push(turns[(this.roundRobin + i) % 3]);
    for (const kind of order) {
      const type = this.want[kind];
      if (!type) continue;
      if (p.start(type)) {
        this.want[kind] = null;
        this.roundRobin = (turns.indexOf(kind) + 1) % 3;
        return;
      }
    }
  }

  buildable(code) {
    const own = this.mine(code);
    const other = code + '_' + (this.player.faction === 'good' ? 'evil' : 'good');
    return [own, other].filter((t) => this.canBuild(t));
  }

  chooseVehicle(n) {
    // §3.3: miners first.
    // (none more while the map has no crystals worth the trip, as a mined-out map has not)
    const want = this.ownBuildings((b) => b.type === this.mine('BA')).length && this.crystalsLeft() ? this.profile.miners : 0;
    if (want > this.miners()) {
      const miner = this.buildable('UD')[0];
      if (miner) { this.want.vehicle = miner; return; }
    }
    if (this.want.vehicle && !this.canBuild(this.want.vehicle)) this.want.vehicle = null;
    if (this.want.vehicle || n.vehicle >= this.ceiling('vehicle')) return;
    const pool = [];
    for (const code of ['UE', 'UF', 'UR', 'UD']) {
      for (const t of this.buildable(code)) {
        if (t === this.mine('UD')) continue;
        pool.push([t, this.statsOf(t).weapon ? 20 : 1]);
      }
    }
    this.want.vehicle = this.weighted(pool);
  }

  chooseInfantry(n) {
    // §3.4: the pizza, when it can be afforded and nobody on this team has one out.
    if (this.settings.mode === 'pizza') {
      const pizza = this.buildable('UJ')[0];
      const cost = this.settings.pizzaCost || 50000;
      if (pizza && this.player.cash >= cost && !this.level.pizzaOf?.(this.player, true)) { this.want.infantry = pizza; return; }
    }
    if (this.want.infantry && !this.canBuild(this.want.infantry)) this.want.infantry = null;
    if (this.want.infantry || n.infantry >= this.ceiling('infantry')) return;
    const enough = this.player.cash > 3000 || n.infantry < this.buildingCount();
    if (!enough) return;
    const pool = [];
    for (const code of ['UA', 'UB', 'UM', 'UN', 'UQ']) {
      for (const t of this.buildable(code)) pool.push([t, this.infantryValue(t)]);
    }
    this.want.infantry = this.weighted(pool.filter(([, v]) => v > 0));
  }

  infantryValue(type) {
    const code = type.substr(0, 2);
    if (code === 'UB') return this.level.countOwned(type, this.player) >= 2 ? 0 : type.endsWith('evil') ? 6 : 4;
    if (code === 'UN') return 1;
    return 5;
  }

  chooseAircraft(n) {
    // §3.5, with the decision held for 5 s.
    if (this.want.aircraft && !this.canBuild(this.want.aircraft)) this.want.aircraft = null;
    if (this.want.aircraft || n.aircraft >= this.ceiling('aircraft')) return;
    const pads = this.ownBuildings((b) => this.code(b) === 'BF').length;
    if (!pads || n.aircraft >= 4 * pads) return;
    if (this.aircraftHeld && this.tick - this.aircraftHeldAt < 75 && this.canBuild(this.aircraftHeld)) {
      this.want.aircraft = this.aircraftHeld;
      return;
    }
    let best = null, fewest = Infinity;
    for (const code of AIRCRAFT) {
      for (const side of ['good', 'evil']) {
        const t = code + '_' + side;
        if (!this.canBuild(t)) continue;
        const have = this.count(t);
        if (have < fewest) { best = t; fewest = have; }
      }
    }
    if (best) { this.aircraftHeld = best; this.aircraftHeldAt = this.tick; }
    this.want.aircraft = best;
  }

  weighted(pool) {
    const total = pool.reduce((s, [, w]) => s + w, 0);
    if (!total) return null;
    let r = this.random(total);
    for (const [t, w] of pool) {
      if (r < w) return t;
      r -= w;
    }
    return null;
  }

  // ---- missions: what each unit is doing (§0.5) ---------------------------------------------
  missionOf(u) {
    if (!u.mission) this.idle(u);
    return u.mission;
  }

  // A unit with nothing to do: attack what it is after, go where it was going, or guard the
  // ground it stands on.
  idle(u) {
    if (u.target && u.target.active) { u.mission = { kind: 'attack' }; return; }
    if (this.isMiner(u)) { u.mission = { kind: 'harvest' }; return; }
    if (this.isBoomerang(u)) { u.mission = { kind: 'sortie' }; return; }
    if (this.armed(u)) { u.mission = { kind: 'guard_area', anchor: { x: u.posX, y: u.posY } }; return; }
    u.mission = { kind: 'guard' };
  }

  order(u, kind, extra) {
    u.mission = Object.assign({ kind, since: this.tick }, extra || {});
    u.botHeld = 0;
    if (kind === 'hunt' || kind === 'attack' || kind === 'rescue') {
      if (extra && extra.target) { u.target = extra.target; if (u.wakeUp) u.wakeUp(); }
    }
    if (kind === 'move' || kind === 'guard_area') {
      u.target = false;
      const d = extra && (extra.dest || extra.anchor);
      if (d) u.nav.voyage(d.x, d.y, true);
    }
    if (kind === 'capture' || kind === 'enter') {
      u.target = extra.target;
      if (u.wakeUp) u.wakeUp();
    }
  }

  // The engine asks a computer unit's hal what to do when it has reached the end of its path
  // (UnitNav); the Bot's missions do their work on their own cadence instead.
  hal(u) {
    const self = this;
    return { type: 'bot', handle() { self.arrived(u); } };
  }

  arrived(u) {
    const m = this.missionOf(u);
    if (m.kind === 'move') {
      if (m.then === 'unload' && u.stats.carrier) { u.deploy = true; this.idle(u); return; }
      u.mission = { kind: this.armed(u) ? 'guard_area' : 'guard', anchor: { x: u.posX, y: u.posY } };
    }
  }

  // Every second: each unit carries on with its mission.
  missions() {
    for (const u of this.own()) {
      if (u.stats.pickup || u.posX < 0) continue;
      const m = this.missionOf(u);
      switch (m.kind) {
        case 'hunt':
          if (!this.legalTarget(u, u.target)) {
            const t = this.huntPick(u);
            if (t) { u.target = t; } else this.idle(u);
          }
          break;
        case 'attack':
        case 'rescue':
          if (!this.legalTarget(u, u.target)) { u.target = false; this.idle(u); }
          break;
        case 'guard_area':
          this.guardArea(u, m);
          break;
        case 'capture':
          if (!u.target || !u.target.active || !this.hostile(u.target)) { u.target = false; this.idle(u); }
          break;
        case 'harvest':
          this.harvest(u);
          break;
        default:
          break;
      }
    }
  }

  legalTarget(u, t) {
    if (!t || !t.active || !t.owner || !this.hostile(t)) return false;
    if (t.stats.pickup || this.pizzaProtected(t)) return false;
    if (t.stats.flying && u.stats.weapon === 'laser' && t.nav && t.nav.landerPerc < 75) return false;
    return true;
  }

  // §6.2: threat first, nearest second.
  value(u, t) { return (t.stats.threat || 0) * 4096 + Math.max(0, 4095 - cells(u.posX, u.posY, t.posX, t.posY)); }

  huntPick(u) {
    let best = null, bestV = -1, ties = [];
    const consider = (t) => {
      if (!this.legalTarget(u, t)) return;
      const v = this.value(u, t);
      if (v > bestV) { bestV = v; best = t; ties = [t]; } else if (v === bestV) ties.push(t);
    };
    for (const b of this.level.buildings) consider(b);
    for (const x of this.level.units) consider(x);
    if (ties.length > 1) return ties[this.random(ties.length)];
    return best;
  }

  // §6.1: guard the anchor -- engage what comes within twice the weapon's range of it (ten
  // cells at most), and never stray far.
  guardArea(u, m) {
    const a = m.anchor || { x: u.posX, y: u.posY };
    const range = (u.stats.weaponRange || 0) / CELL;
    const moving = u.nav.path && u.nav.path.length > 1;
    if (!moving) {
      const d = cells(u.posX, u.posY, a.x, a.y);
      if ((u.target && d > range + 1) || (!u.target && d > 2)) {
        u.target = false;
        u.nav.voyage(a.x, a.y, true);
        return;
      }
    }
    if (!u.target) {
      const reach = Math.min(2 * range, 10);
      let best = null, bestV = -1;
      const consider = (t) => {
        if (!this.legalTarget(u, t)) return;
        if (cells(a.x, a.y, t.posX, t.posY) > reach) return;
        const v = this.value(u, t);
        if (v > bestV) { bestV = v; best = t; }
      };
      for (const b of this.level.buildings) consider(b);
      for (const x of this.level.units) consider(x);
      if (best) { u.target = best; if (u.wakeUp) u.wakeUp(); }
    }
  }

  // A miner with nothing to do goes to the nearest crystals it can reach, as a player would
  // click it there; after that the engine's own loop carries it back and forth.  Rich crystals
  // (over 25) first; if there are none -- a busy map mines them down, and a tile keeps a little
  // however it is mined, and shows it -- the nearest of any.  One whose crystals have run low is
  // sent to rich ones, once it has unloaded, if there are any (the engine takes it back to where
  // it last mined, and looks for more only a little way round that).  A field it cannot reach
  // -- over water, walled in -- is passed over for the next nearest (next time), and
  // remembered.
  harvest(u) {
    const nav = u.nav;
    const arena = this.arena;
    // (with a load, the engine takes it home; a new miner that found no crystals nearby is
    // marked as heading home too, but with nothing aboard that means nothing)
    if (u.cargo) return;
    const fed = nav.lastFed && nav.lastFed.x ? nav.lastFed : null;
    const amount = (t) => (arena.baits[t.x] && arena.baits[t.x][t.y]) || 0;
    if (fed && amount(fed) > 25) return;
    const moving = (nav.path && nav.path.length > 1) || nav.npath;
    // (on its way, as a new miner is, to crystals the engine found for it -- but not one that
    // was to go and never went, marked as feeding where it stands: a starting miner whose way
    // out was blocked by the units it started with)
    if (!fed && moving) return;
    if (!fed && nav.feeding && amount(u.tilePos) > 0) return;
    // (mining a thin field, or on its way back to one: only for rich crystals elsewhere)
    const least = fed ? 25 : 0;
    if (!u.botFarFields) u.botFarFields = new Set();
    // (one way looked for a second at most: a whole map's is dear, on a big one)
    for (let tries = 0; tries < 1; tries++) {
      const field = this.nearestCrystal(u.tilePos, u.botFarFields, 25) || (least ? null : this.nearestCrystal(u.tilePos, u.botFarFields, 0));
      if (!field) {
        if (!least) u.botFarFields.clear();         // (try them all again, another time)
        return;
      }
      nav.voyage((field.x - 0.5) * CELL, (field.y - 0.5) * CELL, false);
      const end = nav.npath && nav.npath[nav.npath.length - 1];
      if (end && amount(end) > 0) {
        // (where it mines now: the engine brings it back here after unloading)
        nav.feeding = true;
        nav.lastFed = { x: end.x, y: end.y };
        return;
      }
      // (the way there ends short of it: out of reach)
      delete nav.npath;
      u.botFarFields.add(field.x + ',' + field.y);
    }
  }

  // The crystals nearest a tile, of more than `over` (25 unless said), not among those skipped.
  nearestCrystal(from, skip, over) {
    const arena = this.arena;
    const least = over === undefined ? 25 : over;
    let best = null, bestD = Infinity;
    for (let x = 1; x <= arena.cols; x++) {
      for (let y = 1; y <= arena.rows; y++) {
        if (!(arena.baits[x] && arena.baits[x][y] > least) || (arena.tiles[x] && arena.tiles[x][y])) continue;
        if (skip && skip.has(x + ',' + y)) continue;
        const d = (x - from.x) * (x - from.x) + (y - from.y) * (y - from.y);
        if (d < bestD) { bestD = d; best = { x, y }; }
      }
    }
    return best;
  }

  // Whether any crystals are worth mining anywhere: more than 10 on a tile (a tile mined out
  // keeps 1).  Looked at every 3 s.
  crystalsLeft() {
    if (this.crystalsSeenAt === undefined || this.tick - this.crystalsSeenAt >= 45) {
      this.crystalsSeenAt = this.tick;
      this.crystalsSeen = !!this.nearestCrystal({ x: 0, y: 0 }, null, 10);
    }
    return this.crystalsSeen;
  }

  // ---- §4.1 aggression -------------------------------------------------------------------------
  aggression() {
    if (!this.hasHQ() && this.ownBuildings().length) {
      // The last stand: everything goes hunting.
      for (const u of this.own()) if (this.armed(u) && !this.isBoomerang(u) && !this.isMiner(u)) this.order(u, 'hunt', { target: this.huntPick(u) });
      return;
    }
    const reclaim = this.underAttack();
    if (this.calm()) return;
    for (const u of this.own()) {
      if (!this.armed(u) || this.isMiner(u) || this.isBoomerang(u) || u.flag) continue;
      if (this.isEngineer(u) || this.isDecoy(u)) continue;
      if (u.stats.transformer && this.random(20) !== 0) continue;
      const m = this.missionOf(u);
      if (u.target || (u.nav.path && u.nav.path.length > 1)) continue;
      if (m.kind === 'guard' && !reclaim && this.random(100) >= this.profile.hunters) {
        // (below Hard, most new units keep to the base)
        u.mission = { kind: 'guard_area', anchor: { x: u.posX, y: u.posY } };
        continue;
      }
      if (m.kind === 'guard' || (reclaim && m.kind === 'guard_area')) this.order(u, 'hunt', { target: this.huntPick(u) });
    }
  }

  // The game gives each computer player, every 320 frames, one of its enemies' buildings for its
  // Boomerangs to fly at (the level's raiders: friendlyTarget), whatever else it is doing.  Below
  // Hard, none in the quiet start, and then not every time.
  sorties() {
    if (this.calm()) return false;
    if (this.tick - this.lastSortie < this.profile.sortieGap) return false;
    this.lastSortie = this.tick;
    return true;
  }

  // ---- §4.3 raid ---------------------------------------------------------------------------------
  raid() {
    const threatened = this.underAttack();
    if (this.calm()) return;
    const c = this.baseCentre();
    if (!c) return;
    let aim = null;
    if (threatened) {
      const anchor = this.ownBuildings()[0];
      let bestD = Infinity;
      for (const t of [...this.level.buildings, ...this.level.units]) {
        if (!t.active || !t.owner || !this.hostile(t) || t.stats.pickup || this.pizzaProtected(t)) continue;
        if (!this.hasScouted(t.tilePos)) continue;
        const d = cells(anchor.posX, anchor.posY, t.posX, t.posY);
        if (d < bestD) { bestD = d; aim = t; }
      }
    }
    if (!aim && (this.player.faction === 'evil' || this.settings.mode === 'pizza')) aim = this.revenueTarget(c);
    if (!aim) aim = this.bestAssault(c);
    if (!aim) return;
    const want = this.profile.raidSize + (threatened ? 3 : 0);
    let sent = 0;
    for (const u of this.own((x) => this.vehicle(x))) {
      if (sent >= want) break;
      if (!this.armed(u) || this.isMiner(u) || u.flag) continue;
      const m = this.missionOf(u);
      if (['enter', 'capture', 'harvest', 'unload'].includes(m.kind)) continue;
      if (m.kind === 'move' && u.nav.path && u.nav.path.length > 1) continue;
      this.order(u, 'attack', { target: aim });
      sent++;
    }
    for (const u of this.own((x) => this.aircraft(x))) {
      if (sent >= want) break;
      if (!this.armed(u) || this.isBoomerang(u) || u.target) continue;
      this.order(u, 'attack', { target: aim });
      sent++;
    }
  }

  revenueTarget(c) {
    let best = null, bestWorth = 0, bestD = Infinity;
    const consider = (t, worth) => {
      if (!worth) return;
      const d = cells(c.x * CELL, c.y * CELL, t.posX, t.posY);
      if (worth > bestWorth || (worth === bestWorth && d < bestD)) { best = t; bestWorth = worth; bestD = d; }
    };
    for (const b of this.level.buildings) {
      if (!b.active || !b.owner || !this.hostile(b) || this.pizzaProtected(b)) continue;
      const code = this.code(b);
      consider(b, code === 'BL' ? 3 : code === 'BA' || code === 'BK' ? 1 : 0);
    }
    for (const u of this.level.units) {
      if (!u.active || !u.owner || !this.hostile(u) || !this.isMiner(u)) continue;
      consider(u, 2);                           // (the mod counts every miner as loaded)
    }
    return best;
  }

  bestAssault(c) {
    let best = null, bestScore = -1;
    for (const b of this.level.buildings) {
      if (!b.active || !b.owner || !this.hostile(b) || this.pizzaProtected(b)) continue;
      // (Destroy HQs: the headquarters are the game.)
      const hq = ['BA', 'BK'].includes(this.code(b));
      const worth = hq && this.settings.mode === 'hq' ? 1600 : ['BA', 'BK', 'BC', 'BE', 'BF'].includes(this.code(b)) ? 400 : 100;
      const score = worth * 32 / Math.max(1, cells(c.x * CELL, c.y * CELL, b.posX, b.posY));
      if (score > bestScore) { bestScore = score; best = b; }
    }
    return best;
  }

  // ---- §4.4 patrol -----------------------------------------------------------------------------
  patrol() {
    if (this.calm()) return;
    const force = this.own((u) => this.armed(u) && !this.isMiner(u) && !u.flag && !this.aircraft(u) && !this.isEngineer(u) && !this.isDecoy(u));
    if (force.length < 4) return;
    const want = Math.floor(force.length / 2);
    const round = Math.floor(this.tick / 300);
    let sent = 0;
    const ordered = [...force.filter((u) => this.vehicle(u)), ...force.filter((u) => this.infantry(u))];
    for (const u of ordered) {
      if (sent >= want) break;
      const m = this.missionOf(u);
      if (!['guard', 'hunt', 'guard_area'].includes(m.kind) || u.target || (u.nav.path && u.nav.path.length > 1) || m.flagGuard) continue;
      const slot = (sent + round) % 9;
      const p = this.patrolPoint(slot);
      if (!p) continue;
      this.order(u, 'guard_area', { anchor: p });
      sent++;
    }
  }

  patrolPoint(slot) {
    const arena = this.arena;
    const W = arena.cols, H = arena.rows;
    for (let tries = 0; tries < 8; tries++) {
      const x = 1 + Math.floor(W * (slot % 3) / 3) + (W / 3 > 1 ? this.random(Math.floor(W / 3)) : 0);
      const y = 1 + Math.floor(H * Math.floor(slot / 3) / 3) + (H / 3 > 1 ? this.random(Math.floor(H / 3)) : 0);
      if (x < 1 || y < 1 || x > W || y > H || (arena.tiles[x] && arena.tiles[x][y])) continue;
      return { x: (x - 0.5) * CELL, y: (y - 0.5) * CELL };
    }
    return null;
  }

  // ---- §2.7 repair and selling ------------------------------------------------------------
  repair() {
    const hq = this.hasHQ();
    for (const b of this.ownBuildings()) {
      if (b.healthPerc <= 25 && b.stats.repairable && b.hitByEnemy && this.player.cash < 1000) {
        const code = this.code(b);
        if (code !== 'BA' && code !== 'BK' && this.random(51) === 0) b.destroy(true);
      }
    }
  }

  // ---- §4.6 scouting memory ----------------------------------------------------------------
  scout() {
    const arena = this.arena;
    if (!this.scouted) this.scouted = new Uint8Array((arena.cols + 2) * (arena.rows + 2));
    const mark = (tx, ty, r) => {
      r = Math.max(1, r || 1);
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (dx * dx + dy * dy > r * r) continue;
          const x = Math.round(tx) + dx, y = Math.round(ty) + dy;
          if (x < 0 || y < 0 || x > arena.cols + 1 || y > arena.rows + 1) continue;
          this.scouted[y * (arena.cols + 2) + x] = 1;
        }
      }
    };
    for (const b of this.ownBuildings()) mark(b.tilePos.x, b.tilePos.y, b.stats.spread);
    for (const u of this.own()) if (u.posX >= 0) mark(u.tilePos.x, u.tilePos.y, u.stats.spread);
  }

  hasScouted(t) {
    if (!this.scouted || !t) return false;
    const x = Math.round(t.x), y = Math.round(t.y);
    return !!this.scouted[y * (this.arena.cols + 2) + x];
  }

  // ---- §4.7 infiltrate ---------------------------------------------------------------------
  raidWorth(b) {
    if (!b.active || !b.owner || !this.hostile(b) || !(b.stats.threat > 0) || this.pizzaProtected(b)) return 0;
    const code = this.code(b);
    if (this.settings.mode === 'pizza') return code === 'BA' ? 0 : code === 'BK' ? 2 : code === 'BL' ? 8 : 1;
    if (code === 'BA' || code === 'BK') return this.settings.mode === 'hq' ? 8 : 3;
    if (code === 'BL') return this.player.faction === 'evil' ? 4 : 2;
    return 1;
  }

  bestRaid(from, avoid) {
    let best = null, bestW = 0, bestD = Infinity;
    for (const b of this.level.buildings) {
      if (b === avoid || !this.hasScouted(b.tilePos)) continue;
      const w = this.raidWorth(b);
      if (!w) continue;
      const d = cells(from.posX, from.posY, b.posX, b.posY);
      if (w > bestW || (w === bestW && d < bestD)) { best = b; bestW = w; bestD = d; }
    }
    return best;
  }

  infiltrate() {
    for (const u of this.own((x) => this.isEngineer(x))) {
      if (u.posX < 0) continue;                       // aboard a transport
      const m = this.missionOf(u);
      if (m.kind === 'enter') continue;
      let giveup = null;
      if (m.kind === 'capture' || m.kind === 'move') {
        const taking = m.kind === 'capture';
        if (taking && !(u.target && u.target.active && this.hostile(u.target))) {
          // no longer worth it
        } else {
          const goal = taking ? u.target : m.dest;
          const d = goal ? cells(u.posX, u.posY, goal.posX !== undefined ? goal.posX : goal.x, goal.posY !== undefined ? goal.posY : goal.y) : 0;
          if (u.botBest === undefined || u.botGoal !== goal || d < u.botBest - 0.5) { u.botBest = d; u.botGoal = goal; u.botStrikes = 0; continue; }
          if (++u.botStrikes < 10) continue;
          u.botStrikes = 0;
          if (taking) giveup = u.target;
        }
        u.target = false;
      }
      const best = this.calm() ? null : this.bestRaid(u, giveup);
      if (best) {
        this.order(u, 'capture', { target: best });
        this.escort(best, 2);
        continue;
      }
      const explore = this.calm() ? null : this.unscoutedPoint(u);
      if (explore) { this.order(u, 'move', { dest: explore }); continue; }
      const home = this.ownBuildings()[0];
      if (home && cells(u.posX, u.posY, home.posX, home.posY) > 1.5) this.order(u, 'move', { dest: { x: home.stats.dockX, y: home.stats.dockY } });
      else u.mission = { kind: 'guard' };
    }
  }

  escort(b, n) {
    for (const d of this.own((x) => this.isDecoy(x))) {
      if (n <= 0) break;
      const m = this.missionOf(d);
      if ((m.kind === 'guard' || m.kind === 'guard_area') && !(d.nav.path && d.nav.path.length > 1)) {
        this.order(d, 'move', { dest: { x: b.posX, y: b.posY } });
        n--;
      }
    }
  }

  unscoutedPoint(u) {
    const arena = this.arena;
    let best = null, bestD = Infinity;
    for (let s = 0; s < 9; s++) {
      const x = Math.round(1 + arena.cols * (1 + 2 * (s % 3)) / 6), y = Math.round(1 + arena.rows * (1 + 2 * Math.floor(s / 3)) / 6);
      if (this.hasScouted({ x, y }) || (arena.tiles[x] && arena.tiles[x][y])) continue;
      const p = { x: (x - 0.5) * CELL, y: (y - 0.5) * CELL };
      const d = cells(u.posX, u.posY, p.x, p.y);
      if (d < 2 || d >= bestD) continue;
      best = p; bestD = d;
    }
    return best;
  }

  // ---- §4.8 airlift ------------------------------------------------------------------------
  airlift() {
    const transports = this.own((u) => this.code(u) === 'UH');
    if (!transports.length) return;
    const boarding = this.own((u) => this.missionOf(u).kind === 'enter').length;
    for (const t of transports) {
      const m = this.missionOf(t);
      if (m.kind === 'move' || t.deploy) continue;
      const load = t.stats.contents ? t.stats.contents.length : 0;
      const ready = load > 0 && (load >= (t.stats.capacity || 6) || boarding === 0);
      if (!ready) continue;
      const best = this.bestRaid(t);
      if (!best) return;
      const lz = this.arena.closestAvailable(this.arena.translatePos(best.posX, best.posY + CELL));
      if (!lz) continue;
      this.order(t, 'move', { dest: { x: (lz.x - 0.5) * CELL, y: (lz.y - 0.5) * CELL }, then: 'unload' });
      return;
    }
    const ride = transports.find((t) => ['guard', 'guard_area'].includes(this.missionOf(t).kind) && !(t.nav.path && t.nav.path.length > 1)
      && (t.stats.contents ? t.stats.contents.length : 0) + boarding < (t.stats.capacity || 6));
    if (!ride || !this.bestRaid(ride)) return;
    const aboard = ride.stats.contents ? ride.stats.contents.length : 0;
    for (const rank of [0, 1, 2]) {
      if (rank > 0 && !aboard) break;
      const man = this.own((u) => this.infantry(u) && u.stats.carriable && this.raiderRank(u) === rank).find((u) => {
        const k = this.missionOf(u).kind;
        return k !== 'enter' && k !== 'capture' && !(u.nav.path && u.nav.path.length > 1) && !this.missionOf(u).flagGuard;
      });
      if (man) { this.order(man, 'enter', { target: ride }); return; }
    }
  }

  raiderRank(u) {
    if (!u.stats.carriable) return -1;
    if (this.isEngineer(u)) return 0;
    if (!this.armed(u)) return -1;
    const code = this.code(u);
    return code === 'UQ' || code === 'UM' ? 1 : 2;
  }

  // ---- §4.9 collect (crates and pizzas; see Level.crates) ---------------------------------
  collect() {
    const crates = this.level.crateCells ? this.level.crateCells() : [];
    if (!crates.length) return;
    const force = this.own((u) => !this.aircraft(u));
    const errands = force.filter((u) => u.mission && u.mission.errand).length;
    if (errands >= Math.min(3, 1 + Math.floor(force.length / 12))) return;
    let collector = this.own((u) => this.isDecoy(u)).find((u) => ['guard', 'guard_area'].includes(this.missionOf(u).kind) && !(u.nav.path && u.nav.path.length > 1));
    if (!collector) {
      collector = this.own((u) => this.vehicle(u) && !this.isMiner(u) && !u.flag).find((u) => {
        const k = this.missionOf(u).kind;
        if (['move', 'enter', 'capture', 'harvest', 'unload'].includes(k)) return false;
        return !(u.nav.path && u.nav.path.length > 1) || ['guard_area', 'attack', 'hunt'].includes(k);
      });
    }
    if (!collector) return;
    let best = null, bestD = Infinity;
    for (const c of crates) {
      const d = cells(collector.posX, collector.posY, c.posX, c.posY);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best) this.order(collector, 'move', { dest: { x: best.posX, y: best.posY }, errand: true });
  }

  // ---- §5.1 CAC_AI_Pizza: fetch our pizza, camp theirs ------------------------------------------
  pizza() {
    const pizzas = this.level.pizzas ? this.level.pizzas() : [];
    const mine = pizzas.find((p) => !this.hostile(p));
    const theirs = pizzas.find((p) => this.hostile(p));
    const at = (spot, p) => spot && cells(spot.x, spot.y, p.posX, p.posY) < 1;
    // The fastest unit that is not a miner (armed or not, busy or not) runs for ours, unless
    // one is on its way already.
    if (mine && !this.own((u) => u.mission && u.mission.kind === 'move' && at(u.mission.dest, mine)).length) {
      let runner = null;
      for (const u of this.own((x) => (this.vehicle(x) || this.infantry(x)) && !this.isMiner(x) && x.posX >= 0)) {
        if (!runner || (u.stats.speed || 0) > (runner.stats.speed || 0)) runner = u;
      }
      if (runner) this.order(runner, 'move', { dest: { x: mine.posX, y: mine.posY }, runner: true });
    }
    // Four armed units sit on theirs: vehicles first, then infantry.
    if (theirs) {
      let posted = 0;
      for (const u of [...this.own((x) => this.vehicle(x)), ...this.own((x) => this.infantry(x))]) {
        if (posted >= 4) break;
        if (!this.armed(u) || this.isMiner(u) || u.posX < 0 || (u.mission && u.mission.runner)) continue;
        const m = this.missionOf(u);
        if (m.kind === 'capture' || m.kind === 'enter') continue;
        if (m.kind === 'guard_area' && at(m.anchor, theirs)) { posted++; continue; }
        this.order(u, 'guard_area', { anchor: { x: theirs.posX, y: theirs.posY }, camp: true });
        posted++;
      }
    }
  }

  // ---- §5.2 CAC_AI_Flag: carry flags home, chase a thief, send a runner ----------------------
  flagRun() {
    const flags = this.level.flags || [];
    const mine = flags.find((f) => f.owner === this.player);
    const centreOf = (cell) => ({ x: (cell.x - 0.5) * CELL, y: (cell.y - 0.5) * CELL });
    const at = (spot, cell) => spot && cells(spot.x, spot.y, (cell.x - 0.5) * CELL, (cell.y - 0.5) * CELL) < 1;
    // 1. Carriers go home, unless there already or on the way.
    if (mine) {
      for (const u of this.own((x) => x.flag)) {
        if (u.tilePos.x === mine.home.x && u.tilePos.y === mine.home.y) continue;
        if (u.mission && u.mission.kind === 'move' && at(u.mission.dest, mine.home)) continue;
        this.order(u, 'move', { dest: centreOf(mine.home), carry: true });
      }
    }
    // 2. Armed vehicles after whoever has our flag.
    if (mine && mine.carrier && this.hostile(mine.carrier)) {
      for (const u of this.own((x) => this.vehicle(x) && this.armed(x) && !this.isMiner(x) && !x.flag && x.target !== mine.carrier)) {
        this.order(u, 'attack', { target: mine.carrier });
      }
    }
    // 3. The enemy flag lying nearest our base: the fastest free vehicle goes for it.
    const c = this.baseCentre();
    if (!c) return;
    let best = null, bestD = Infinity;
    for (const f of flags) {
      if (f.carrier || !this.level.hostile(f.owner, this.player)) continue;
      const d = cells(c.x * CELL, c.y * CELL, (f.cell.x - 0.5) * CELL, (f.cell.y - 0.5) * CELL);
      if (d < bestD) { bestD = d; best = f; }
    }
    if (!best) return;
    if (this.own((u) => this.vehicle(u) && u.mission && u.mission.kind === 'move' && at(u.mission.dest, best.cell)).length) return;
    let runner = null;
    for (const u of this.own((x) => this.vehicle(x) && !this.isMiner(x) && !x.flag && !(x.mission && x.mission.errand) && x.posX >= 0)) {
      if (!runner || (u.stats.speed || 0) > (runner.stats.speed || 0)) runner = u;
    }
    if (runner) this.order(runner, 'move', { dest: centreOf(best.cell), flagRun: true });
  }

  // ---- §5.2 CAC_AI_Flag_Guard: guards on our flag --------------------------------------------
  flagGuard() {
    const mine = (this.level.flags || []).find((f) => f.owner === this.player);
    if (!mine || mine.carrier) return;
    const spot = { x: (mine.cell.x - 0.5) * CELL, y: (mine.cell.y - 0.5) * CELL };
    // The fastest vehicle is never posted: it stays free to go for flags.
    let spare = null;
    for (const u of this.own((x) => this.vehicle(x) && !this.isMiner(x))) {
      if (!spare || (u.stats.speed || 0) > (spare.stats.speed || 0)) spare = u;
    }
    const armed = this.own((x) => (this.vehicle(x) && this.armed(x) && !this.isMiner(x))
      || (this.infantry(x) && this.armed(x) && !this.isEngineer(x) && !this.isDecoy(x))).length;
    const want = Math.max(2, Math.floor(armed / 3));
    const first = (x) => this.code(x) === 'UQ' || this.code(x) === 'UM';
    const passes = [
      this.own((x) => this.infantry(x) && first(x)),
      this.own((x) => this.infantry(x) && !first(x) && this.armed(x) && !this.isEngineer(x) && !this.isDecoy(x)),
      this.own((x) => this.vehicle(x) && this.armed(x) && !this.isMiner(x) && !x.flag && x !== spare),
    ];
    let posted = 0;
    for (const list of passes) {
      for (const u of list) {
        if (posted >= want) return;
        if (u.posX < 0) continue;
        const m = this.missionOf(u);
        if (m.kind === 'guard_area' && m.anchor && cells(m.anchor.x, m.anchor.y, spot.x, spot.y) < 1) { posted++; continue; }
        if (u.target || m.errand) continue;
        this.order(u, 'guard_area', { anchor: spot, flagGuard: true });
        posted++;
      }
    }
  }

  // ---- §4.10 idle watch --------------------------------------------------------------------
  idleWatch() {
    if (this.tick % 5) return;                    // (every tick in the mod; five is plenty here)
    for (const u of this.own()) {
      if (this.isMiner(u) || u.posX < 0) continue;
      const m = u.mission;
      const busy = u.target || (m && (m.kind === 'move' || m.kind === 'capture'));
      if (!busy) { u.botHeld = 0; continue; }
      const cell = u.tilePos.x + ',' + u.tilePos.y;
      if (cell !== u.botCell) { u.botCell = cell; u.botHeld = 0; continue; }
      u.botHeld = (u.botHeld || 0) + 5;
      if (u.botHeld === 65 && m && m.dest) u.nav.voyage(m.dest.x, m.dest.y, true);
      if (u.botHeld >= 195 && (!m || m.kind !== 'enter')) {
        u.target = false;
        u.mission = null;
        this.idle(u);
        u.botHeld = 0;
      }
    }
  }

  // ---- §6.3 retaliation and base defence (called by the engine when something is hit) -----
  damaged(victim, attacker) {
    if (!attacker || !attacker.owner || !this.level.hostile(attacker, this.player)) return;
    if (victim.isBuilding) {
      this.lastHit = this.tick;
      victim.hitByEnemy = true;
      if (!victim.stats.weapon && !this.aircraft(attacker)) this.defend(attacker);
      return;
    }
    if (this.isMiner(victim)) { this.defend(attacker); return; }
    if (!this.armed(victim)) return;
    if (this.aircraft(attacker) && victim.stats.weapon === 'laser') return;
    const m = this.missionOf(victim);
    if (!['guard', 'guard_area', 'attack', 'rescue'].includes(m.kind)) return;
    if (victim.target && victim.target.stats && victim.target.stats.weapon && cells(victim.posX, victim.posY, victim.target.posX, victim.target.posY) <= (victim.stats.weaponRange || 0) / CELL) return;
    this.order(victim, 'hunt', { target: attacker });
  }

  defend(attacker) {
    const until = this.defended.get(attacker);
    if (until !== undefined && until > this.tick) return;
    this.defended.set(attacker, this.tick + 225);
    const candidates = this.own((u) => (this.vehicle(u) || this.infantry(u)) && this.armed(u) && !this.isMiner(u) && !(u.target && u.target.stats && u.target.stats.weapon));
    const speed = (u) => Math.max(1, u.stats.speed || 1);
    candidates.sort((a, b) => {
      const sa = 50 * 256 / Math.max(1, (cells(a.posX, a.posY, attacker.posX, attacker.posY) - (a.stats.weaponRange || 0) / CELL) / speed(a));
      const sb = 50 * 256 / Math.max(1, (cells(b.posX, b.posY, attacker.posX, attacker.posY) - (b.stats.weaponRange || 0) / CELL) / speed(b));
      return sb - sa;
    });
    for (const u of candidates.slice(0, 3)) this.order(u, 'rescue', { target: attacker });
  }

  // ---- §6.4 the periodic attack and the fire sale --------------------------------------------
  expert() {
    const hosts = this.ownBuildings((b) => ['BA', 'BC', 'BE', 'BF', 'BJ', 'BK'].includes(this.code(b)));
    if (!hosts.length && this.ownBuildings().length && !this.underAttack()) {
      for (const b of this.ownBuildings()) if (this.code(b) !== 'BA' && this.code(b) !== 'BK') b.destroy(true);
      for (const u of this.own((x) => this.armed(x))) this.order(u, 'hunt', { target: this.huntPick(u) });
      return;
    }
    this.attackTimer -= 75;
    if (this.attackTimer > 0) return;
    this.attackTimer = 3 * (450 + this.random(1351)) * this.profile.attackEvery;
    if (this.random(3) === 0 || !this.ownBuildings().length) {
      for (const u of this.own((x) => this.armed(x) && !this.isMiner(x))) {
        if (this.isBoomerang(u) && u.weaponPayload !== u.stats.maxWeaponPayload) continue;
        if (this.random(4) < this.profile.share) this.order(u, 'hunt', { target: this.huntPick(u) });
      }
    } else {
      const c = this.baseCentre();
      if (!c) return;
      for (const u of this.own((x) => (this.vehicle(x) || this.infantry(x)) && this.armed(x))) {
        const m = this.missionOf(u);
        if (m.kind !== 'guard_area' || this.zoneOf(u.tilePos, c) === null || this.random(5) !== 0) continue;
        const zone = ['north', 'east', 'south', 'west'][this.random(4)];
        const p = this.pointIn(zone, c);
        this.order(u, 'guard_area', { anchor: { x: (p.x - 0.5) * CELL, y: (p.y - 0.5) * CELL } });
      }
    }
  }

  // ---- §6.6 the superweapon ------------------------------------------------------------------
  // The game's superweapon is bought (the uplink's UK, like a unit) and fired when ready; the
  // computer buys it when it can spare the money, and fires at the first hostile building.
  superweapon() {
    const p = this.production;
    const uk = this.mine('UK');
    if (p.unit && p.unit.type === uk && p.unit.progress === p.unit.constructionTime) {
      // (The mod fires at the first hostile building, a Pizza Mode headquarters too, which
      // shrugs it off.  Here a building that can be harmed comes first; but a headquarters
      // is still fired on when there is nothing else, since the finished weapon holds up
      // this player's other units until it is fired.)
      const hostile = this.level.buildings.filter((b) => b.active && b.owner && this.hostile(b));
      const target = hostile.find((b) => !this.pizzaProtected(b)) || hostile[0];
      if (target && p.fire()) this.level.launchSuperweapon(target.posX, target.posY);
      return;
    }
    if (!p.unit && this.profile.superweapon && this.tick % 45 === 0 && this.canBuild(uk) && this.player.cash > this.statsOf(uk).cost + 2000) p.start(uk);
  }
}

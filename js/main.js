import * as THREE from 'three';
import { W, KERB, DS, TRACKS, getTrack, previewPoints, locate, bankH, elevAt } from './tracks.js?v=95106973';
import { World } from './world.js?v=95106973';
import { makeCar, disposeCar, setCompound, makeSafetyCar, loadCarModel, AXLE_F, AXLE_R } from './car.js?v=95106973';
import { Sound } from './audio.js?v=95106973';
import { Particles, Skids } from './fx.js?v=95106973';
import { Weather } from './weather.js?v=95106973';
import { clamp, angDiff, rng, fmt, store, setMaxAniso, smooth } from './util.js?v=95106973';

const $ = id => document.getElementById(id);
const VMAX = 100;

/* ---------------- Teams, drivers, tyres (all fictional) ---------------- */
const TEAMS = [
  { name: 'Halcyon Racing', color: '#14b8a6', accent: '#0f172a' },
  { name: 'Ironclad GP', color: '#f97316', accent: '#1f2937' },
  { name: 'Solaris Motorsport', color: '#a3e635', accent: '#111827' },
  { name: 'Corvid Racing', color: '#7c3aed', accent: '#e5e7eb' },
  { name: 'Brightwater', color: '#38bdf8', accent: '#0b1324' },
  { name: 'Vermilion Works', color: '#dc2626', accent: '#fde68a' },
  { name: 'Pinnacle Engineering', color: '#22c55e', accent: '#f8fafc' },
  { name: 'Atlas Velocity', color: '#ec4899', accent: '#1e1b4b' },
  { name: 'Northstar GP', color: '#1e3a8a', accent: '#fbbf24' },
  { name: 'Granite Motorsport', color: '#9ca3af', accent: '#dc2626' },
  { name: 'Copperline Racing', color: '#b45309', accent: '#0a0a0a' },
];
const DRIVERS = [
  ['Marco Ferrante', 'FER'], ['Lena Hoffmann', 'HOF'], ['Kai Tanaka', 'TAN'], ['Rafael Duarte', 'DUA'],
  ['Sofia Lindqvist', 'LIN'], ['Theo Marchetti', 'MAR'], ['Amara Okafor', 'OKA'], ['Jonas Brandt', 'BRA'],
  ['Elise Moreau', 'MOR'], ['Diego Salvador', 'SAL'], ['Niko Virtanen', 'VIR'], ['Priya Raman', 'RAM'],
  ['Oscar Whitfield', 'WHI'], ['Yuki Mori', 'MRI'], ['Felix Arnaud', 'ARN'], ['Mateo Rojas', 'ROJ'],
  ['Lucas Bremer', 'BRE'], ['Isabela Costa', 'COS'], ['Hugo Lefevre', 'LEF'], ['Anya Petrova', 'PET'],
  ['Tom Ashworth', 'ASH'], ['Kenji Arai', 'ARA'],
];
const CAR_NUMS = [4, 7, 11, 14, 16, 22, 27, 31, 33, 44, 55, 63, 77, 81, 88, 99, 3, 5, 10, 12, 18, 23];
let TEAM_MAP = DRIVERS.map((_, i) => Math.floor(i / 2) % TEAMS.length);
const teamIdxOf = di => TEAM_MAP[di];
/* random pairings: shuffle the drivers, then seat them two to a team */
function shuffleTeams(r, seated) {
  // seat the drivers actually racing (minus the player's teammate) two per team, so every team is a pair
  const pool = (seated || DRIVERS.map((_, i) => i)).slice().sort(() => r() - 0.5), map = DRIVERS.map((_, i) => Math.floor(i / 2) % TEAMS.length);
  const slots = TEAMS.map((_, t) => t).sort(() => r() - 0.5);
  pool.forEach((di, k) => { map[di] = slots[Math.floor(k / 2) % slots.length]; });
  return map;
}
const LIVERIES = ['#ffcc00', '#f8fafc', '#ef4444', '#3b82f6', '#10b981', '#a855f7', '#111827'];
const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
// 100 = right on the limit and slightly over it (they rely on kerbs and run-off); 75 ≈ old Hard
const aiPace = s => 0.8 + 0.225 * Math.pow(clamp(s, 0, 100) / 100, 0.75);
// skill 80-100 also get extra grip, braking and power so the very top is genuinely hard to beat
const aiBoost = s => 1 + BOOST_MAX * Math.pow(clamp((s - 70) / 30, 0, 1), 2);
const BOOST_MAX = 0.16;
const GEARS = [0, 22, 33, 44, 54, 64, 74, 84, 200];
const CAMS = ['COCKPIT', 'T-CAM', 'CHASE'];
const COMP = {
  soft: { name: 'Soft', s: 'S', color: '#e2231a', grip: 1.035, life: 0.4 },
  medium: { name: 'Medium', s: 'M', color: '#f5c400', grip: 1.0, life: 0.68 },
  hard: { name: 'Hard', s: 'H', color: '#e8e8e8', grip: 0.972, life: 0.8 },
  inter: { name: 'Intermediate', s: 'I', color: '#2bb54a', grip: 0.93, life: 0.7 },
  wet: { name: 'Wet', s: 'W', color: '#1e6fe0', grip: 0.9, life: 0.95 },
};
const SLICK = c => c === 'soft' || c === 'medium' || c === 'hard';
const lerp4 = (pts, w) => { for (let i = 1; i < pts.length; i++) if (w <= pts[i][0]) { const [a, va] = pts[i - 1], [b, vb] = pts[i]; return va + (vb - va) * (w - a) / (b - a); } return pts[pts.length - 1][1]; };
function tyreGrip(comp, wear, wet) {
  let g;
  if (SLICK(comp)) g = COMP[comp].grip * lerp4([[0, 1], [0.3, 0.84], [0.6, 0.67], [1, 0.52]], wet);
  else if (comp === 'inter') g = lerp4([[0, 0.86], [0.3, 0.93], [0.6, 0.9], [1, 0.74]], wet);
  else g = lerp4([[0, 0.78], [0.3, 0.85], [0.6, 0.9], [1, 0.89]], wet);
  return g * clamp(1 - 0.16 * Math.min(wear, 1) ** 2 - 0.3 * Math.max(0, wear - 1), 0.55, 1);
}

/* ---------------- Renderer & world ---------------- */
const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = false;
setMaxAniso(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.08, 20000);
const world = new World(renderer, scene);
const weather = new Weather(scene);
const smoke = new Particles(scene, 1600, false);
const sparks = new Particles(scene, 500, true);
const skids = new Skids(scene);

const settings = Object.assign({ track: 0, mode: 'race', laps: 5, opp: 9, ai: 50, line: 'off', livery: 0, quali: 'on', weather: 'random', damage: 'sim' }, store.json('apexgp2-settings', {}));
if (settings.track >= TRACKS.length) settings.track = 0;
if (typeof settings.diff === 'string') { settings.ai = { easy: 25, medium: 50, hard: 72 }[settings.diff] ?? 50; delete settings.diff; }
delete settings.gfx;
const saveSettings = () => store.set('apexgp2-settings', JSON.stringify(settings));

let builtFor = null;
function buildTrack(i) {
  if (builtFor === i) return getTrack(i);
  const T = getTrack(i);
  world.build(T, 0, TEAMS.map(t => t.color));
  builtFor = i;
  smoke.clear(); sparks.clear(); skids.clear();
  return T;
}

/* ---------------- Audio ---------------- */
const sound = new Sound();
sound.muted = store.get('apexgp-muted') === '1';
const audio = { init() { sound.init(); }, set() {}, get muted() { return sound.muted; }, set muted(v) { sound.muted = v; } };

/* ---------------- Championship ---------------- */
const loadSeason = () => store.json('apexgp2-season', null);
const saveSeason = s => store.set('apexgp2-season', JSON.stringify(s));
function newSeason() {
  const r = rng(Date.now() & 0xfffff);
  const order = DRIVERS.map((d, i) => i).sort(() => r() - 0.5).slice(0, settings.opp);
  const s = { round: 0, laps: settings.laps, ai: settings.ai, opp: settings.opp, lineup: order.map(di => ({ di, rating: 0.99 + r() * 0.02 })), pts: {}, finished: false };
  s.teamMap = shuffleTeams(r, s.lineup.slice(1).map(l => l.di));
  s.pts.YOU = 0; order.forEach(di => s.pts[DRIVERS[di][1]] = 0);
  saveSeason(s); return s;
}

/* ---------------- Game state ---------------- */
const game = { state: 'menu', T: null, cars: [], player: null, mate: null, session: null, phase: 'idle', lightsT: 0, goAt: 0, raceTime: 0, camMode: 2, paused: false, finishCount: 0, orbit: 0, resultsAt: 0, season: null, laps: 5, skill: 50, q: null, grid: null, wx: {}, to: null, fastest: Infinity };
const cm = parseInt(store.get('apexgp-cam'), 10); if (cm >= 0 && cm < 3) game.camMode = cm;
const keys = {};
const bestKey = T => 'apexgp2-best-' + T.def.id;
const recordFor = T => { const v = parseFloat(store.get(bestKey(T))); return isFinite(v) ? v : 0; };
const T = () => game.T;
const isRace = () => game.session === 'race';
const racing = () => isRace() && game.phase === 'race';
const curLap = c => Math.max(1, c.maxDone + 1);

function clearCars() { world.resetCrews(); for (const c of game.cars) { scene.remove(c.group); disposeCar(c); } game.cars = []; game.player = null; game.mate = null; }

function resetState(c) {
  Object.assign(c, {
    x: 0, z: 0, h: 0, vh: 0, v: 0, steer: 0, spin: 0, slip: 0, idx: 0, prog: 0, lat: 0, surf: 0, gripNow: 1, maxDone: -1, lapStart: 0, lastLap: 0, bestLap: Infinity,
    lapInvalid: false, lapTimes: [], finished: false, finishTime: 0, finishOrder: 0, splits: {}, lastBucket: -1e9, laneOff: 0, laneTarget: 0, blockT: 0, startDelay: 0,
    autopilot: false, inp: { throttle: 0, brake: 0, steer: 0 }, gear: 0, rpm: 4000, wheelRot: 0, hitT: 0, scrub: 0, sparkT: Math.random(),
    drsArmed: -1, drsOpen: false, drsGap: Infinity, offLimits: false, strikes: 0, penalty: 0, contactT: -9, pitReq: false, pit: null, pits: 0,
    dmg: { fw: 0, rw: 0, susp: 0, punct: false, pull: 0 }, dnf: false, retire: null, yieldT: 0, active: true, sessBest: Infinity, timedLaps: 0, evalT: 0, wearWarn: 0, outLap: false, inPitRoad: false, impact: 0, pitExitT: -99, lift: 0,
  });
  c.fwing.visible = c.rwing.visible = true;
}
function setTyres(c, comp) { c.tyre = { comp, wear: 0 }; c.stints = c.stints || []; c.stints.push(comp); setCompound(c, comp); }

/* Build the field: player, teammate (in Your Team colours) and AI rivals */
function makeField(lineup, skill) {
  clearCars();
  const colr = LIVERIES[settings.livery], acc = colr === '#111827' ? '#ffcc00' : '#111827';
  const p = Object.assign(makeCar({ color: colr, accent: acc, helmet: '#ffffff', number: 1, compound: 'medium' }), { name: 'You', code: 'YOU', team: 'Your Team', color: colr, isPlayer: true, pace: 1, teamIdx: TEAMS.length });
  game.cars.push(p); game.player = p;
  lineup.forEach((L, k) => {
    const di = L.di, mate = k === 0 && settings.mode !== 'tt';
    const tm = TEAMS[teamIdxOf(di)];
    const c = Object.assign(makeCar({ color: mate ? colr : tm.color, accent: mate ? acc : tm.accent, helmet: ['#ffffff', '#ffcc00', '#ff4d4d', '#4da6ff'][di % 4], number: CAR_NUMS[di], compound: 'medium' }),
      { name: DRIVERS[di][0], code: DRIVERS[di][1], team: mate ? 'Your Team' : tm.name, color: mate ? colr : tm.color, isPlayer: false, mate, teamIdx: mate ? TEAMS.length : teamIdxOf(di),
        pace: Math.min(1.03, aiPace(skill) * L.rating), lateBrake: skill >= 70, rating: L.rating, boost: aiBoost(skill) });
    game.cars.push(c); if (mate) game.mate = c;
  });
  for (const c of game.cars) { resetState(c); c.stints = []; scene.add(c.group); }
  p.steering.visible = true;
}

/* ---------------- Placement: grid, garage ---------------- */
function placeOnTrack(c, idx, lat, Tr) {
  c.idx = idx; c.lat = lat; c.x = Tr.px[idx] + Tr.nx[idx] * lat; c.z = Tr.pz[idx] + Tr.nz[idx] * lat; c.h = c.vh = Math.atan2(Tr.tx[idx], Tr.tz[idx]);
}
function placeGrid(order, Tr) {
  order.forEach((c, s) => {
    const back = 8 + s * 8, idx = (Tr.N - Math.round(back / DS)) % Tr.N, lane = (s % 2 === 0 ? 1 : -1) * 3.2;
    placeOnTrack(c, idx, lane, Tr); c.prog = idx - Tr.N; c.laneOff = lane - Tr.race[idx]; c.laneTarget = (Math.random() - 0.5) * 1.2;
    c.startDelay = c.isPlayer ? 0 : 0.12 + Math.random() * 0.35; c.gridPos = s + 1;
  });
}
const boxIdx = (c, Tr) => (Tr.pit.boxStart + c.teamIdx * Tr.pit.boxGap) % Tr.N;
const boxK = (c, Tr) => (boxIdx(c, Tr) - Tr.pit.entry + Tr.N) % Tr.N;
function placeGarage(c, Tr) {
  c.pit = { stage: 'garage', k: boxK(c, Tr), lat0: Tr.pit.fast, wait: 0, stopAtBox: true, total: 1 };
  c.prog = boxIdx(c, Tr) - Tr.N; c.v = 0; pitPose(c, Tr);
}

/* ---------------- Weekend flow ---------------- */
let lapEstCache = null;
function estimateLap(Tr, pace, prof, boost = 1) {
  const vm = VMAX * Math.sqrt(boost), sp = pace * Math.sqrt(boost);
  let v = prof[0] * sp, t = 0;
  for (let pass = 0; pass < 2; pass++) { t = 0; for (let i = 0; i < Tr.N; i++) { const lim = prof[(i + 1) % Tr.N] * sp, a = 11.5 * boost * (1 - (v / vm) ** 2) - (0.3 + 0.00028 * v * v); const nv = Math.min(lim, Math.sqrt(Math.max(1, v * v + 2 * a * DS))); t += DS / ((v + nv) / 2); v = nv; } }
  return t * 1.002; // AI drive almost exactly on the profile
}

function startWeekend() {
  const champ = settings.mode === 'champ', tt = settings.mode === 'tt';
  if (champ) { game.season = loadSeason() || newSeason(); settings.track = game.season.round; }
  const Tr = game.T = buildTrack(settings.track);
  game.laps = tt ? Infinity : (champ ? game.season.laps : settings.laps);
  game.skill = champ ? (game.season.ai ?? 50) : settings.ai;
  const r = rng((Date.now() & 0xffff) + 1);
  let lineup = [];
  if (champ) { if (!game.season.teamMap) { game.season.teamMap = shuffleTeams(r, game.season.lineup.slice(1).map(l => l.di)); saveSeason(game.season); } TEAM_MAP = game.season.teamMap; }
  if (champ) lineup = game.season.lineup.slice();
  else if (!tt) lineup = DRIVERS.map((d, i) => i).sort(() => r() - 0.5).slice(0, settings.opp).map(di => ({ di, rating: 0.99 + r() * 0.02 }));
  if (!champ && !tt) TEAM_MAP = shuffleTeams(r, lineup.slice(1).map(l => l.di));
  makeField(lineup, game.skill);
  game.seed = (Date.now() & 0xfffff) + 3;
  game.lapEst = estimateLap(Tr, aiPace(game.skill), Tr.vprof);
  game.record = recordFor(Tr); game.fastest = Infinity;
  game.wxMode = tt ? 'dry' : settings.weather;
  $('menu').classList.add('hidden'); $('results').classList.add('hidden'); $('pause').classList.add('hidden'); $('hud').classList.remove('hidden');
  buildMinimap(Tr);
  audio.init();
  if (tt) return startSession('tt');
  if (settings.quali === 'on') {
    const n = game.cars.length;
    game.q = { stages: n >= 12 ? ['Q1', 'Q2', 'Q3'] : ['Q'], idx: 0, entrants: game.cars.slice(), out: [], results: {} };
    if (n >= 12) { const rest = n - 10; game.q.elim = { Q1: Math.ceil(rest / 2), Q2: rest - Math.ceil(rest / 2), Q3: 0 }; } else game.q.elim = { Q: 0 };
    return startSession(game.q.stages[0]);
  }
  // no qualifying: random grid with the player mid-field
  const order = game.cars.filter(c => !c.isPlayer).sort(() => r() - 0.5);
  order.splice(Math.floor(game.cars.length * 0.55), 0, game.player);
  game.grid = order;
  showStrategy();
}

function hideAllOverlays() { ['results', 'pause', 'qres', 'strategy'].forEach(id => $(id).classList.add('hidden')); }

function startSession(kind) {
  world.resetCrews();
  const Tr = game.T, p = game.player;
  hideAllOverlays();
  clearSC(); game.flag = null; $('flag').className = 'hidden';
  game.wx = { announced: 0, level: 0, raining: false, forecastSaid: false };
  game.session = kind; game.raceTime = 0; game.finishCount = 0; game.paused = false; game.resultsAt = 0; game.state = 'race';
  game.drsCross = Tr.drs.map(() => ({}));
  const quali = kind !== 'tt' && kind !== 'race';
  const dur = quali ? game.lapEst * 3.2 : game.lapEst * 30;
  weather.setup(Tr, game.wxMode, dur, game.seed + (quali ? 11 : 0));
  for (const c of game.cars) { const keep = c.stints; resetState(c); c.stints = []; c.active = c.isPlayer; c.group.visible = c.isPlayer; }
  const wetStart = weather.average() > 0.3;
  setTyres(p, wetStart ? (weather.average() > 0.6 ? 'wet' : 'inter') : 'soft');
  placeGarage(p, Tr);
  game.phase = 'garage';
  if (quali) {
    const entrants = game.q.entrants, sess = { name: kind, times: {}, reveal: [] };
    const factor = { Q1: 1, Q2: 0.998, Q3: 0.996, Q: 1 }[kind];
    for (const c of entrants) {
      if (c.isPlayer) continue;
      const base = estimateLap(Tr, Math.min(1, c.pace), c.lateBrake ? Tr.vprof2 : Tr.vprof, c.boost || 1) * factor * 1.012;
      const wetPen = 1 + 0.16 * weather.average();
      const t = base * wetPen * (1 + (Math.random() - 0.5) * 0.006);
      sess.reveal.push({ c, t, at: 25 + Math.random() * (dur - 30) });
    }
    game.q.cur = sess;
    radio((kind === 'Q' ? 'Qualifying. Out lap, then two flying laps.' : kind + '. Out lap, then two flying laps. Bottom ' + game.q.elim[kind] + ' are knocked out.') + ' DRS is free in the zones.', 'info', 7);
  } else if (kind === 'tt') radio('Time trial. Leave the garage when ready; DRS is free in the zones.', 'info', 6);
  $('board').classList.toggle('hidden', kind === 'tt'); $('tl').classList.toggle('hidden', kind === 'tt');
  $('startLights').classList.add('hidden'); $('garageBar').classList.remove('hidden');
  $('trackTag').textContent = (settings.mode === 'champ' ? 'ROUND ' + (settings.track + 1) + ' · ' : '') + Tr.def.name.toUpperCase() + ' · ' + sessionLabel();
  $('radio').innerHTML = ''; updatePenTag();
  world.setRaceLine(settings.line === 'on');
  setCam(game.camMode, true);
}
const sessionLabel = () => ({ Q1: 'QUALIFYING 1', Q2: 'QUALIFYING 2', Q3: 'QUALIFYING 3', Q: 'QUALIFYING', race: 'RACE', tt: 'TIME TRIAL' })[game.session];

function leaveGarage() {
  const p = game.player; if (!p.pit || p.pit.stage !== 'garage') return;
  p.pit.stage = 'out'; game.phase = 'run'; $('garageBar').classList.add('hidden');
}

function endQualiSession() {
  const q = game.q, s = q.cur, p = game.player;
  for (const r of s.reveal) s.times[r.c.code] = r.t;
  s.times.YOU = p.sessBest;
  const ent = q.entrants.slice().sort((a, b) => (s.times[a.code] ?? 1e9) - (s.times[b.code] ?? 1e9));
  const elim = q.elim[s.name] || 0, keep = ent.slice(0, ent.length - elim), out = ent.slice(ent.length - elim);
  q.results[s.name] = ent.map(c => ({ c, t: s.times[c.code] }));
  q.out = out.concat(q.out);  // later sessions' eliminations go in front
  q.entrants = keep;
  game.phase = 'idle'; p.active = false;
  showQualiResults(s.name, ent, elim);
}
function nextQualiStep() {
  const q = game.q, p = game.player;
  q.idx++;
  const playerIn = q.entrants.includes(p);
  if (q.idx < q.stages.length && playerIn) return startSession(q.stages[q.idx]);
  // simulate remaining sessions without the player
  while (q.idx < q.stages.length) {
    const name = q.stages[q.idx], f = { Q2: 0.998, Q3: 0.996 }[name] || 1;
    const times = {}; q.entrants.forEach(c => times[c.code] = estimateLap(game.T, Math.min(1, c.pace), c.lateBrake ? game.T.vprof2 : game.T.vprof, c.boost || 1) * f * 1.012 * (1 + (Math.random() - 0.5) * 0.006));
    const ent = q.entrants.slice().sort((a, b) => times[a.code] - times[b.code]), elim = q.elim[name] || 0;
    q.results[name] = ent.map(c => ({ c, t: times[c.code] }));
    q.out = ent.slice(ent.length - elim).concat(q.out); q.entrants = ent.slice(0, ent.length - elim);
    q.idx++;
  }
  const last = q.results[q.stages[q.stages.length - 1]];
  game.grid = last.map(r => r.c).concat(q.out);
  showStrategy();
}

/* ---------------- Strategy ---------------- */
function strategyOptions() {
  const L = game.laps, wetNow = weather.average();
  if (wetNow > 0.3) return [
    { name: 'Start on Intermediates', stints: [['inter', 0]], note: 'Pit when the engineer calls it' },
    { name: 'Start on Full Wets', stints: [['wet', 0]], note: 'Safest if the rain gets heavier' },
  ];
  if (L < 5) return [
    { name: 'Flat out on Softs', stints: [['soft', 0]], note: 'Short race: no stop needed' },
    { name: 'Mediums, no stop', stints: [['medium', 0]], note: 'Less grip, more consistent' },
    { name: 'Hards, no stop', stints: [['hard', 0]], note: 'Lowest grip, never fades' },
  ];
  const o = [
    { name: '1-stop: Medium → Hard', stints: [['medium', 0], ['hard', Math.round(L * 0.5)]] },
    { name: '1-stop: Soft → Hard', stints: [['soft', 0], ['hard', Math.max(2, Math.round(L * 0.36))]] },
  ];
  if (L >= 8) o.push({ name: '2-stop: Soft → Medium → Soft', stints: [['soft', 0], ['medium', Math.round(L * 0.3)], ['soft', Math.round(L * 0.68)]] });
  else o.push({ name: '1-stop: Soft → Medium', stints: [['soft', 0], ['medium', Math.round(L * 0.45)]] });
  return o;
}
function forecastText() {
  const t = weather.nextRain(0), dur = game.lapEst * game.laps;
  if (weather.average() > 0.3) return 'Wet race: the track is soaked.';
  if (t < dur) return 'Forecast: rain likely around lap ' + Math.max(1, Math.round(t / game.lapEst)) + '.';
  return game.wxMode === 'dry' ? 'Forecast: dry all race.' : 'Forecast: dry, small chance of showers.';
}
function showStrategy() {
  // prepare race weather now so the forecast is meaningful
  game.session = 'race-prep';
  weather.setup(game.T, game.wxMode, game.lapEst * game.laps, game.seed + 99);
  const opts = strategyOptions(), box = $('stratCards');
  $('stratSub').textContent = game.T.def.name + ' · ' + game.laps + ' laps · Grid P' + (game.grid.indexOf(game.player) + 1) + ' of ' + game.grid.length;
  $('stratWx').textContent = forecastText() + (game.laps >= 5 && weather.average() < 0.3 ? ' Rule: dry races need two different dry compounds.' : '');
  box.innerHTML = '';
  opts.forEach((o, k) => {
    const el = document.createElement('button'); el.className = 'scard panel' + (k === 0 ? ' on' : '');
    el.innerHTML = '<div class="sn">' + o.name + '</div><div class="tyres">' + o.stints.map(([c, lap]) => '<span class="tb" style="--tc:' + COMP[c].color + '">' + COMP[c].s + '</span>' + (lap ? '<small>box lap ' + lap + '</small>' : '')).join('<i>→</i>') + '</div>' + (o.note ? '<div class="note">' + o.note + '</div>' : '');
    el.onclick = () => { box.querySelectorAll('.scard').forEach(b => b.classList.remove('on')); el.classList.add('on'); game.stratPick = k; };
    box.appendChild(el);
  });
  game.stratPick = 0; game.stratOpts = opts;
  hideAllOverlays(); $('hud').classList.add('hidden'); $('strategy').classList.remove('hidden');
  game.phase = 'idle';
}

function aiPlan(c, L) {
  const wetNow = weather.average();
  if (wetNow > 0.3) return [[wetNow > 0.6 && Math.random() < 0.6 ? 'wet' : 'inter', 0]];
  if (L < 5) return [[Math.random() < 0.6 ? 'soft' : 'medium', 0]];
  const opts = [[['medium', 0], ['hard', Math.round(L * 0.5)]], [['soft', 0], ['hard', Math.round(L * 0.36)]], [['soft', 0], ['medium', Math.round(L * 0.45)]], [['hard', 0], ['medium', Math.round(L * 0.6)]]];
  return opts[Math.floor(Math.random() * opts.length)].map(([cmp, lap]) => [cmp, lap ? Math.max(2, lap + Math.round((Math.random() - 0.5) * 2)) : 0]);
}

function startRace() {
  const Tr = game.T;
  hideAllOverlays(); $('hud').classList.remove('hidden');
  game.session = 'race'; game.raceTime = 0; game.finishCount = 0; game.paused = false; game.resultsAt = 0; game.state = 'race'; game.fastest = Infinity;
  clearSC(); game.flag = null; game.dnfTimes = []; game.redWx = false; game.drsHoldLap = 0; $('flag').className = 'hidden';
  game.drsCross = Tr.drs.map(() => ({})); game.to = { issued: null }; game.wx = { announced: 0, level: 0, raining: false, forecastSaid: false };
  for (const c of game.cars) { resetState(c); c.stints = []; c.active = true; c.group.visible = true; }
  world.resetCrews(); placeGrid(game.grid, Tr);
  const pick = game.stratOpts[game.stratPick || 0];
  game.player.plan = pick.stints.map(s => s.slice());
  for (const c of game.cars) { if (!c.isPlayer) c.plan = aiPlan(c, game.laps); c.planIdx = 0; setTyres(c, c.plan[0][0]); }
  game.phase = 'lights'; game.lightsT = 0; game.goAt = 5.6 + Math.random() * 1.4;
  world.setStartLights(0);
  $('board').classList.remove('hidden'); $('tl').classList.remove('hidden'); $('garageBar').classList.add('hidden');
  $('startLights').classList.remove('hidden');
  $('trackTag').textContent = (settings.mode === 'champ' ? 'ROUND ' + (settings.track + 1) + ' · ' : '') + Tr.def.name.toUpperCase() + ' · RACE';
  $('radio').innerHTML = ''; updatePenTag();
  world.setRaceLine(settings.line === 'on');
  setCam(game.camMode, true);
  radio(forecastText() + ' Starting on ' + COMP[game.player.tyre.comp].name + 's.', 'info', 7);
}

/* ---------------- Physics ---------------- */
function surfaceOf(c, Tr) {
  const a = Math.abs(c.lat);
  if (a <= W + 0.3) return 0;
  if (a <= W + KERB) return 1;
  if (Tr.street) return 2;
  const s = c.lat > 0 ? 1 : -1;
  if (a <= W + KERB + 2.4) return 2;
  if (Tr.gravel[c.idx] === s) return 3;
  return 4;
}
const GRIP = [1, 0.93, 0.88, 0.45, 0.6];
const DRAG = [0, 0, 0, 0.95, 0.4];

function setVel(c, vx, vz) {
  const sp = Math.hypot(vx, vz), fwd = vx * Math.sin(c.h) + vz * Math.cos(c.h);
  if (sp < 1e-3) { c.v = 0; return; }
  if (fwd >= 0) { c.v = sp; c.vh = Math.atan2(vx, vz); } else { c.v = -sp; c.vh = Math.atan2(-vx, -vz); }
}

function stepCar(c, inp, dt, Tr) {
  if (c.pit) return pitStep(c, dt, Tr);
  if (c.dnf) return retireStep(c, dt, Tr);
  const surf = c.surf = surfaceOf(c, Tr), wet = weather.wetAt(c.idx);
  // gravity along the slope: uphill slows the car, downhill speeds it up
  if (Tr.grade[c.idx] && Math.abs(c.v) > 1) c.v -= 9.81 * Tr.grade[c.idx] * Math.sign(c.v) * dt;
  const tg = tyreGrip(c.tyre.comp, c.tyre.wear, wet), d = c.dmg;
  const dmgF = 1 - 0.2 * d.fw - 0.1 * d.susp - (d.punct ? 0.3 : 0);
  const boost = c.boost || 1;
  const grip = c.gripNow = GRIP[surf] * tg * dmgF * (surf >= 3 ? 1 - 0.3 * wet : 1) * boost;
  c.gripTD = tg * dmgF;
  let v = c.v;
  const vm = VMAX * (c.drsOpen ? 1.08 : 1) * (1 + 0.04 * (c.tow || 0)) * (1 - 0.05 * d.rw) * (d.punct ? 0.35 : 1) * Math.sqrt(boost);
  let yaw, slip;
  if ((c.isPlayer && !c.autopilot) || c.dynamic) {
    // the player's car uses a proper chassis/tyre model
    const st = clamp(inp.steer + d.pull, -1, 1);
    const bankA = Tr.bankSin[c.idx] * 9.81 * 1.6 * (st * Tr.curv[c.idx] > 0 ? 1 : -0.3);
    yaw = dynStep(c, inp, dt, grip, vm, bankA, st, surf, d);
    slip = c.slip; v = c.v;
  } else {
  if (inp.throttle > 0) {
    if (v < -0.2) v += 28 * dt * inp.throttle;
    else { const f = 1 - Math.pow(Math.max(v, 0) / vm, 2); v += 11.5 * boost * inp.throttle * Math.max(f, 0) * (surf >= 3 ? 0.55 : 1) * Math.min(1, 0.45 + 0.6 * grip) * dt; }
  }
  if (inp.brake > 0) {
    if (v > 0.4) v = Math.max(0, v - 36 * grip * inp.brake * dt);
    else if (inp.throttle === 0) v = Math.max(v - 7 * dt, -12);
  }
  const dec = (0.3 + dragK(c) * v * v + (inp.throttle === 0 ? 1.2 : 0) + DRAG[surf] * Math.abs(v) + (d.punct ? 0.05 * Math.abs(v) : 0)) * dt;
  if (v > 0) v = Math.max(0, v - dec); else if (v < 0) v = Math.min(0, v + dec);

  const st = clamp(inp.steer + d.pull, -1, 1);
  const bankA = Tr.bankSin[c.idx] * 9.81 * 1.6 * (st * Tr.curv[c.idx] > 0 ? 1 : -0.3);
  const sp = Math.abs(v), geo = sp * Math.tan(0.42) / 3.6, dyn = ((18 + 0.25 * sp) * grip + bankA) / Math.max(sp, 1);
  yaw = st * Math.min(geo, dyn) * (v < 0 ? -1 : 1);
  // throttle-on oversteer when grip is low (wet, worn tyres, rear wing damage)
  const loose = Math.max(0, 0.84 - grip + 0.15 * d.rw) * inp.throttle * Math.min(1, sp / 30);
  c.h += (yaw + st * loose * 0.9 + c.spin) * dt;
  c.spin *= Math.exp(-2.2 * dt);
  c.scrub = (geo > dyn && Math.abs(st) > 0.6 && sp > 15) ? Math.abs(st) : 0;
  if (c.scrub) v -= Math.sign(v) * c.scrub * 2.2 * dt;
  // the direction of travel lags the nose when grip is low: the car slides
  const relax = clamp(16 * grip * grip - 4 * d.rw, 1.4, 16);
  c.vh += angDiff(c.h, c.vh) * Math.min(1, relax * dt);
  slip = c.slip = angDiff(c.h, c.vh);
  if (Math.abs(slip) > 0.12 && sp > 2) v -= Math.sign(v) * Math.min(sp, Math.abs(slip) * 7 * dt * (1 + sp / 40));
  c.x += Math.sin(c.vh) * v * dt; c.z += Math.cos(c.vh) * v * dt; c.v = v;
  }
  const sp = Math.abs(v);

  // tyre wear: faster when cornering hard, much faster for wet-weather tyres on a dry track
  const lapsLife = isRace() ? Math.max(2, COMP[c.tyre.comp].life * game.laps) : COMP[c.tyre.comp].life * 20;
  const load = Math.min(1, Math.abs(yaw * sp) / 30) + Math.abs(slip);
  const dryPen = !SLICK(c.tyre.comp) ? (c.tyre.comp === 'inter' ? 1 + 2.5 * Math.max(0, 0.25 - wet) * 4 : 1 + 4 * Math.max(0, 0.4 - wet) * 2.5) : 1;
  if (isRace()) c.tyre.wear += sp * dt / DS / (lapsLife * Tr.N) * (0.7 + 0.6 * load) * dryPen;

  const ni = locate(Tr, c.x, c.z, c.idx);
  let dn = ni - c.idx; if (dn > Tr.N / 2) dn -= Tr.N; else if (dn < -Tr.N / 2) dn += Tr.N;
  c.idx = ni; c.prog += dn;
  c.lat = (c.x - Tr.px[ni]) * Tr.nx[ni] + (c.z - Tr.pz[ni]) * Tr.nz[ni];
  // pit entry/exit roads: the pit-side wall has gaps there, and inside the pit lane the pit wall and outer wall apply
  const P = Tr.pit, kk = (ni - P.entry + Tr.N) % Tr.N, inRange = kk < P.len, pl = P.side * c.lat;
  const gap = inRange && (kk < 40 || kk > P.len - 40);
  if (gap && pl > P.wall - 0.3) c.inPitRoad = true;
  if (!inRange || pl < P.wall - 1.2) c.inPitRoad = false;
  const s = c.lat >= 0 ? 1 : -1, lim = (s > 0 ? Tr.limL[ni] : Tr.limR[ni]) - 1.05;
  if (inRange && s === P.side && (gap || c.inPitRoad)) {
    if (pl > P.outer - 1.05) wallHit(c, Tr, ni, s, P.outer - 1.05);
    else if (!gap && c.inPitRoad) wallHit(c, Tr, ni, -s, -(P.wall + 1.65));
  } else if (Math.abs(c.lat) > lim) wallHit(c, Tr, ni, s, lim);
}
/* ---- Player chassis model ----
   Bicycle model with Pacejka-style tyres: separate front/rear slip angles, a friction circle per axle
   (braking or driving uses up cornering grip), lock-ups, longitudinal weight transfer (trail-braking
   rotation, power oversteer), yaw inertia, and speed-dependent grip from downforce. The total grip
   envelope matches the AI's (18 + 0.25 v) m/s², so racing stays fair. Forces are per unit mass. */
// rearGrip > 1 gives the slight stability bias real cars run; muX = tyres grip harder in a straight line than sideways
// air drag: DRS opens the rear wing (big cut), a tow behind another car cuts it further
const dragK = c => 0.00028 * (c.drsOpen ? 0.58 : 1) * (1 - 0.35 * (c.tow || 0));
const DYN = { L: 3.6, a: 1.98, b: 1.62, h: 0.3, k2: 2.0, B: 16.7, C: 1.6, brakeF: 0.6, rearGrip: 1.1, muX: 1.35 };
const tyreCurve = a => Math.sin(DYN.C * Math.atan(DYN.B * a));
function dynStep(c, inp, dt, grip, vm, bankA, st, surf, d) {
  const P = DYN, sh0 = Math.sin(c.h), ch0 = Math.cos(c.h);
  const vx0 = c.v * Math.sin(c.vh), vz0 = c.v * Math.cos(c.vh);
  let u = vx0 * sh0 + vz0 * ch0, vl = vx0 * ch0 - vz0 * sh0, r = (c.r || 0) + c.spin; c.spin = 0;
  c.lock = false; c.scrub = 0;
  if (u < 6) {
    // walking pace and reverse: simple, stable kinematic steering
    if (inp.throttle > 0) u += (u < -0.2 ? 28 : 9 * Math.min(1, 0.45 + 0.6 * grip)) * inp.throttle * dt;
    if (inp.brake > 0) { if (u > 0.4) u = Math.max(0, u - 36 * grip * inp.brake * dt); else if (inp.throttle === 0) u = Math.max(u - 7 * dt, -12); }
    const dec = (0.3 + (inp.throttle === 0 ? 1.2 : 0) + DRAG[surf] * Math.abs(u)) * dt;
    if (u > 0) u = Math.max(0, u - dec); else if (u < 0) u = Math.min(0, u + dec);
    vl *= Math.exp(-10 * dt);
    const rk = u * Math.tan(st * 0.42) / P.L;
    r += (rk - r) * Math.min(1, dt * 12);
  } else {
    const mu = 2.0 * grip, Ntot = 9 + 0.125 * u + Math.max(0, bankA) / 2;
    const Cfast = P.B * P.C * mu * Ntot;                       // total cornering stiffness (per rad)
    const n = Math.min(10, Math.max(1, Math.ceil(dt / (0.7 * u / Cfast))));
    const h = dt / n;
    for (let k = 0; k < n; k++) {
      const drive = inp.throttle > 0 ? 11.5 * (c.boost || 1) * inp.throttle * Math.max(0, 1 - (u / vm) ** 2) * (surf >= 3 ? 0.55 : 1) : 0;
      // braking is the original strong, consistent braking (no lock-ups)
      const brake = inp.brake > 0 ? 36 * grip * inp.brake : 0;
      const drag = 0.3 + dragK(c) * u * u + (inp.throttle === 0 ? 1.2 : 0) + DRAG[surf] * u + (d.punct ? 0.05 * u : 0);
      // longitudinal weight transfer: braking loads the front, acceleration loads the rear
      const dN = clamp((drive - drag) * P.h / P.L, -4, 4);
      const Nf = Math.max(0.5, Ntot * 0.45 - dN), Nr = Math.max(0.5, Ntot * 0.55 + dN);
      // speed-sensitive steering: plenty of lock in slow corners, much less at high speed
      // (peak front grip arrives a little before full lock, so there is steering in reserve)
      const delta = st * clamp(0.05 + 1.2 * P.L * mu * Ntot / (u * u), 0.05, 0.4);
      const muR = mu * P.rearGrip, xF = P.muX * mu * Nf, xR = P.muX * muR * Nr;
      // braking/driving use up some cornering grip (friction ellipse), never all of it
      const useF = 0, useR = Math.min(0.85, drive / xR);
      const capF = mu * Nf * Math.sqrt(1 - useF * useF), capR = muR * Nr * Math.sqrt(1 - useR * useR);
      const af = Math.atan2(vl + P.a * r, u) - delta, ar = Math.atan2(vl - P.b * r, u);
      const Fyf = -capF * tyreCurve(af), Fyr = -capR * tyreCurve(ar);
      const cd = Math.cos(delta), sd = Math.sin(delta);
      const du = drive - brake - Fyf * sd - drag + vl * r;
      const dvl = Fyf * cd + Fyr - u * r;
      const dr = (P.a * Fyf * cd - P.b * Fyr) / P.k2;
      u = Math.max(0, u + du * h); vl += dvl * h; r += dr * h;
      // yaw damping grows with speed: aero stability keeps the car calm in fast corners
      r *= Math.exp(-(0.5 + 0.02 * u) * h);
      c.scrub = Math.max(c.scrub, Math.abs(af) > 0.14 ? Math.min(1, (Math.abs(af) - 0.14) * 6) : 0);
    }
  }
  c.r = r; c.h += r * dt;
  const sh = Math.sin(c.h), ch = Math.cos(c.h), wx = u * sh + vl * ch, wz = u * ch - vl * sh;
  setVel(c, wx, wz);
  c.x += wx * dt; c.z += wz * dt;
  c.slip = Math.abs(c.v) > 2 ? angDiff(c.h, c.vh) : 0;
  return r;
}

/* push the car back from a barrier on side d (+1 left, -1 right) at lateral distance L along d, and bounce */
function wallHit(c, Tr, ni, d, L) {
  const pen = c.lat * d - L; if (pen <= 0) return;
  const ox = Tr.nx[ni] * d, oz = Tr.nz[ni] * d;
  c.x -= ox * pen; c.z -= oz * pen; c.lat -= d * pen;
  let vx = c.v * Math.sin(c.vh), vz = c.v * Math.cos(c.vh);
  const vn = vx * ox + vz * oz;
  if (vn <= 0) return;
  // bounce off the barrier, keep most of the sliding speed along it
  vx -= 1.25 * vn * ox; vz -= 1.25 * vn * oz;
  const fr = 1 - 0.35 * Math.min(1, vn / 12); vx *= fr; vz *= fr;
  setVel(c, vx, vz);
  const fx = Math.sin(c.h), fz = Math.cos(c.h), fdot = fx * ox + fz * oz;
  const th = Math.atan2(Tr.tx[ni], Tr.tz[ni]), tgt = (fx * Tr.tx[ni] + fz * Tr.tz[ni]) >= 0 ? th : th + Math.PI;
  c.h += angDiff(tgt, c.h) * Math.min(0.5, 0.15 + vn * 0.02);
  c.spin += -d * (fdot > 0 ? 1 : -1) * Math.min(3, vn * 0.12) * (1 - Math.abs(fdot));
  if (vn > 4) { c.hitT = Math.min(1, vn / 25); c.hitSide = d; if (c.isPlayer) c.impact = Math.min(1, vn / 20); damage(c, vn, fdot > 0.55 ? 'front' : fdot < -0.55 ? 'rear' : 'side'); }
}

/* Car retiring: coast to the side of the track and park */
function retire(c, why) {
  if (c.dnf) return;
  c.dnf = true; c.drsOpen = false; c.retire = { why, side: c.lat >= 0 ? 1 : -1, dmg: { ...c.dmg } };
  if (c.isPlayer) { radio(why === 'accident' ? 'Car is too badly damaged. We have to retire it. Sorry.' : 'We have to retire the car.', 'bad', 8); game.resultsAt = game.raceTime + 3; }
  else if (isRace()) radio('Yellow flag: ' + c.code + ' is out of the race.', 'warn', 4);
  if (why === 'accident') incident(c.code + ' has crashed');
}
function retireStep(c, dt, Tr) {
  c.v = Math.max(0, c.v - 10 * dt);
  const lim = (c.retire.side > 0 ? Tr.limL[c.idx] : Tr.limR[c.idx]) - 1.6;
  c.lat += (c.retire.side * lim - c.lat) * Math.min(1, dt * 0.8);
  const ds = c.v * dt / DS; c.prog += ds;
  const i0 = Math.floor(((c.prog % Tr.N) + Tr.N) % Tr.N) % Tr.N;
  c.idx = i0; c.x = Tr.px[i0] + Tr.nx[i0] * c.lat; c.z = Tr.pz[i0] + Tr.nz[i0] * c.lat;
  c.h += angDiff(Math.atan2(Tr.tx[i0], Tr.tz[i0]) + c.retire.side * 0.5, c.h) * Math.min(1, dt); c.vh = c.h;
}

/* ---------------- Pit lane ---------------- */
/* Between the two blue limiter lines the car runs on the limiter: it follows the fast lane,
   swings into its box (box lane) if it is stopping, then back out to the fast lane. Entry and
   exit roads either side of the limiter lines are driven normally. */
function pitLat(c, k, Tr) {
  const P = Tr.pit, kb = boxK(c, Tr);
  let lat = P.fast;
  if (k < P.limIn + 14) lat = c.pit.lat0 + (P.fast - c.pit.lat0) * smooth(P.limIn - 1, P.limIn + 14, k);
  if (c.pit.stopAtBox) {
    if (k > kb - 16 && k <= kb) lat = P.fast + (P.lat - P.fast) * smooth(kb - 16, kb, k);
    else if (k > kb && k < kb + 16) lat = P.lat + (P.fast - P.lat) * smooth(kb, kb + 16, k);
  }
  return lat;
}
function pitPose(c, Tr) {
  const P = Tr.pit, k = c.pit.k, i0 = (P.entry + Math.floor(k)) % Tr.N, i1 = (i0 + 1) % Tr.N, f = k - Math.floor(k);
  const lat = pitLat(c, k, Tr), lat2 = pitLat(c, k + 1, Tr);
  const px = Tr.px[i0] + (Tr.px[i1] - Tr.px[i0]) * f, pz = Tr.pz[i0] + (Tr.pz[i1] - Tr.pz[i0]) * f;
  c.x = px + Tr.nx[i0] * lat; c.z = pz + Tr.nz[i0] * lat; c.idx = i0; c.lat = lat;
  c.h = c.vh = Math.atan2(Tr.tx[i0], Tr.tz[i0]) - Math.atan2(lat2 - lat, DS) * 1;
}
function pitStep(c, dt, Tr) {
  const p = c.pit, P = Tr.pit, kb = boxK(c, Tr);
  if (p.stage === 'garage') { c.v = 0; pitPose(c, Tr); return; }
  if (p.stage === 'stop') {
    c.v = 0; p.wait -= dt;
    const prog = clamp(1 - p.wait / p.total, 0, 1);
    world.crewAnim(c.teamIdx, prog);
    c.lift = 0.08 * clamp((prog - 0.04) / 0.06, 0, 1) * (1 - clamp((prog - 0.8) / 0.06, 0, 1));
    // wheels come off and go back on in the middle of the stop
    const tyresOff = p.wait < p.total * 0.75 && p.wait > p.total * 0.3;
    c.wheels.forEach(w => w.spin.visible = !tyresOff);
    if (p.wait <= 0) { p.stage = 'out'; c.lift = 0; c.wheels.forEach(w => w.spin.visible = true); if (c.isPlayer) radio('Go, go, go!', 'good', 2); }
    pitPose(c, Tr); return;
  }
  let target = 22;
  if (p.stage === 'in' && p.stopAtBox) {
    const d = (kb - p.k) * DS; target = Math.min(22, Math.sqrt(Math.max(0, 2 * 9 * d)));
    if (d < 90 && !p.crewReady) { p.crewReady = true; world.crewPose(c.teamIdx, true, c); }
    if (d <= 0.5) { p.stage = 'stop'; c.v = 0; serviceCar(c); p.total = p.wait; if (!p.crewReady) { p.crewReady = true; world.crewPose(c.teamIdx, true, c); } world.crewAnim(c.teamIdx, 0); pitPose(c, Tr); return; }
  }
  if (p.stage === 'out' && !p.crewBack && p.k > kb + 10) { p.crewBack = true; world.crewPose(c.teamIdx, null); }
  else if (p.stage === 'out' && !p.crewBack && p.crewReady) world.crewAnim(c.teamIdx, 1 + (p.k - kb) / 10);
  else if (p.stage === 'in' && p.crewReady) world.crewAnim(c.teamIdx, -1);
  c.v = c.v > target ? Math.max(target, c.v - 28 * dt) : Math.min(target, c.v + 9 * dt);
  const dk = c.v * dt / DS; p.k += dk; c.prog += dk;
  if (p.k >= P.limOut) {
    // past the exit limiter line: hand control back to the driver on the pit-exit road
    if (!p.crewBack) world.crewPose(c.teamIdx, null);
    pitPose(c, Tr); c.pit = null; c.inPitRoad = true; c.pitReq = false; c.pitExitT = game.raceTime;
    c.laneOff = 0; c.laneTarget = 0;
    if (c.isPlayer) radio('Limiter off. Watch the white line on pit exit.', 'info', 3);
    return;
  }
  pitPose(c, Tr);
}
function nextCompound(c) {
  const w = weather.average(), used = c.stints || [];
  if (w > 0.55) return 'wet';
  if (w > 0.2) return 'inter';
  const plan = c.plan && c.plan[c.planIdx + 1];
  if (plan && SLICK(plan[0]) && !SLICK(c.tyre.comp) === false) return plan[0];
  if (plan) return plan[0];
  const lapsLeft = game.laps - curLap(c);
  if (!used.includes('hard') && lapsLeft > game.laps * 0.4) return 'hard';
  return used.includes('medium') ? (lapsLeft < game.laps * 0.35 ? 'soft' : 'hard') : 'medium';
}
function serviceCar(c) {
  let t = 2.2 + Math.random() * 0.6; const notes = [];
  if (Math.random() < 0.05) { t += 2.5; notes.push('slow stop, sorry'); }
  if (c.dmg.fw > 0.05) { t += 6.5; c.dmg.fw = 0; c.fwing.visible = true; notes.push('new front wing'); }
  if (c.dmg.rw > 0.05) { t += 8; c.dmg.rw = 0; c.rwing.visible = true; notes.push('new rear wing'); }
  c.dmg.punct = false;
  if (isRace() || c.isPlayer) {
    const wq = weather.average(), comp = isRace() ? nextCompound(c) : (wq > 0.55 ? 'wet' : wq > 0.2 ? 'inter' : 'soft');
    if (c.plan && c.plan[c.planIdx + 1] && c.plan[c.planIdx + 1][0] === comp) c.planIdx++;
    else if (c.plan) c.planIdx++;
    setTyres(c, comp);
  }
  c.pits++; c.pitReq = false; c.pit.wait = t;
  if (c.isPlayer) radio('Stop ' + t.toFixed(1) + 's. ' + COMP[c.tyre.comp].name + 's fitted' + (notes.length ? ', ' + notes.join(', ') : '') + '.', 'info', 5);
}

/* ---------------- Damage ---------------- */
function damage(c, impact, where, scale = 1) {
  if (settings.damage === 'off') return;
  const k = (settings.damage === 'reduced' ? 0.5 : 1) * scale, d = c.dmg, before = { ...d };
  if (impact < 5 || k <= 0) return;
  if (where === 'front') d.fw = Math.min(1, d.fw + impact * k / 22);
  else if (where === 'rear') d.rw = Math.min(1, d.rw + impact * k / 28);
  else { d.susp = Math.min(1, d.susp + Math.max(0, impact - 9) * k / 40); d.pull = clamp(d.pull + (Math.random() < 0.5 ? -1 : 1) * Math.max(0, impact - 7) * k / 300, -0.14, 0.14); }
  if (impact > 15 && Math.random() < 0.3 * k) d.punct = true;
  if (d.fw >= 0.85 && c.fwing.visible) { c.fwing.visible = false; debris(c, 1.9); if (racing() && !game.flag && Math.random() < 0.35) deployFlag('vsc', 'debris on track'); }
  if (d.rw >= 0.9 && c.rwing.visible) { c.rwing.visible = false; debris(c, -2.3); }
  if (impact > 30 / Math.max(k, 0.3) || d.susp >= 1) { retire(c, 'accident'); return; }
  if (c.isPlayer && isRace()) {
    if (d.fw - before.fw > 0.15) radio(d.fw > 0.6 ? 'Front wing is badly damaged. Box this lap.' : 'We have some front wing damage. Car will understeer.', d.fw > 0.6 ? 'bad' : 'warn');
    else if (d.rw - before.rw > 0.15) radio('Rear wing damage. Expect less grip at the rear.', 'warn');
    else if (d.susp - before.susp > 0.1) radio('Suspension damage. The car will pull to one side.', 'warn');
    if (d.punct && !before.punct) radio('Puncture! Bring it back to the pits.', 'bad');
    if (d.fw > 0.6 || d.punct) c.pitReq = true;
  }
}
const DEBRIS = new THREE.Color('#1a1b1f');
function debris(c, zOff) {
  const fx = Math.sin(c.h), fz = Math.cos(c.h), ey = c.group.position.y;
  for (let k = 0; k < 26; k++) smoke.spawn(c.x + fx * zOff, ey + 0.3, c.z + fz * zOff, fx * c.v * 0.6 + (Math.random() - 0.5) * 6, 2 + Math.random() * 4, fz * c.v * 0.6 + (Math.random() - 0.5) * 6, 1.6 + Math.random(), 0.35, 0.3, 1, DEBRIS, 0.6, 9.8);
}

/* ---------------- Driver inputs ---------------- */
function playerInput(c, dt) {
  const tgt = (keys.a ? 1 : 0) - (keys.d ? 1 : 0);
  const slow = 1 + Math.max(0, Math.abs(c.v) - 25) / 35;
  const rate = (tgt === 0 ? 7 : (c.steer !== 0 && Math.sign(tgt) !== Math.sign(c.steer) ? 9 : 4.2)) / slow;
  c.steer += clamp(tgt - c.steer, -rate * dt, rate * dt);
  return { throttle: keys.w ? 1 : 0, brake: keys.s ? 1 : 0, steer: c.steer };
}

function aiInput(c, dt, Tr) {
  const N = Tr.N;
  c.blockT -= dt; c.yieldT -= dt;
  if (c.blockT <= 0) c.laneTarget *= Math.pow(0.5, dt);
  let follow = Infinity;
  for (const o of game.cars) {
    if (o === c || !o.active || o.pit) continue;
    const dp = o.prog - c.prog;
    if (Math.abs(dp) <= 3 && Math.abs(o.lat - c.lat) < 3.6) {
      const want = clamp(o.lat + (c.lat >= o.lat ? 3.8 : -3.8), -(W - 1.2), W - 1.2);
      if (Math.abs(want - o.lat) >= 3) { c.laneTarget = want - Tr.race[c.idx]; c.blockT = Math.max(c.blockT, 0.8); }
    }
    if (dp > 0 && dp < 16 && Math.abs(o.lat - c.lat) < 2.6) {
      if (c.v > o.v - 0.5 || o.dnf) {
        const leftRoom = W - 1.4 - o.lat, rightRoom = o.lat + W - 1.4;
        c.laneTarget = clamp((leftRoom > rightRoom ? o.lat + 3.0 : o.lat - 3.0) - Tr.race[c.idx], -2 * W, 2 * W); c.blockT = 1.6;
      }
      if (dp < 5 && !o.dnf) follow = Math.min(follow, o.v - 0.5);
    }
  }
  const P = Tr.pit, toEntry = (P.entry - c.idx + N) % N, inEntryRoad = ((c.idx - P.entry + N) % N) < P.limIn + 2;
  const pitting = c.pitReq && !c.pit && ((toEntry < 140 && toEntry > 0) || inEntryRoad);
  if (c.yieldT > 0) { c.laneTarget = clamp((c.lat >= 0 ? W - 1.6 : -(W - 1.6)) - Tr.race[c.idx], -2 * W, 2 * W); c.blockT = 0.5; }
  if (game.flag && game.flag.type === 'sc') { c.laneTarget = 0; c.blockT = 0; }
  c.laneOff += (c.laneTarget - c.laneOff) * Math.min(1, dt * 1.6);
  // precise line following: short look-ahead + feed-forward of the line's curvature + lateral error correction
  const sp0 = Math.max(Math.abs(c.v), 5);
  const ti = (c.idx + Math.round((5 + sp0 * 0.2) / DS)) % N;
  const edge = W - 1.1;
  let off = clamp(Tr.race[ti] + c.laneOff, -edge, edge);
  const pathAhead = pitPathLat(c, ti, Tr), pathHere = pitPathLat(c, c.idx, Tr);
  if (pathAhead !== null) off = pathAhead;
  const wide = Math.abs(c.lat) - (W - 0.5);
  if (wide > 0) off -= Math.sign(c.lat) * Math.min(3, wide * 2);
  let tgtH = Math.atan2(Tr.px[ti] + Tr.nx[ti] * off - c.x, Tr.pz[ti] + Tr.nz[ti] * off - c.z);
  // after a spin, line the car back up with the track before going again
  const trackH = Math.atan2(Tr.tx[c.idx], Tr.tz[c.idx]), facing = Math.abs(angDiff(trackH, c.h));
  if (facing > 1.2 && Math.abs(c.v) < 6) { c.h += angDiff(trackH, c.h) * Math.min(1, dt * 1.5); c.vh = c.h; }
  const err = angDiff(tgtH, c.h) - c.slip * 0.6;
  const maxYaw = Math.max(0.05, Math.min(sp0 * Math.tan(0.42) / 3.6, (18 + 0.25 * sp0) * (c.gripNow || 1) / sp0));
  const ahead = (c.idx + Math.round(sp0 * 0.06 / DS)) % N;
  const ff = pathHere !== null ? 0 : Tr.rk[ahead] * sp0 / maxYaw;
  const latErr = (pathHere !== null ? pathHere : clamp(Tr.race[c.idx] + c.laneOff, -edge, edge)) - c.lat;
  const want = clamp(ff + err * 2.2 + latErr * (pathHere !== null ? 0.12 : 0.05), -1, 1);
  c.steer += clamp(want - c.steer, -10 * dt, 10 * dt);
  let target = Infinity;
  const prof = c.lateBrake ? Tr.vprof2 : Tr.vprof;
  for (let k = 1; k <= 6; k++) target = Math.min(target, prof[(c.idx + k) % N]);
  // going over the limit only pays in slow corners; in fast sweepers the best AI drive exactly on it
  const pace = c.pace > 1 ? 1 + (c.pace - 1) * clamp((72 - target) / 30, 0, 1) : c.pace;
  target = Math.min(target * pace * Math.sqrt(Math.min(1.04, c.gripTD || 1) * (c.boost || 1)) * (c.yieldT > 0 ? 0.9 : 1), follow);
  if (wide > 0) target = Math.min(target, c.v * (1 - Math.min(0.08, wide * 0.03)));
  if (c.surf >= 3) target = Math.min(target, 35);
  if (c.dmg.punct) target = Math.min(target, 28);
  if (pitting) { const dl = ((P.entry + P.limIn - c.idx + N) % N) * DS; target = Math.min(target, Math.sqrt(21.5 * 21.5 + 2 * 16 * dl)); }
  if (game.flag && racing()) target = Math.min(target, flagSpeed(c, Tr, target));
  let throttle = 0, brake = 0;
  if (c.v < target - 0.25) throttle = facing > 1.2 ? 0.4 : 1; else if (c.v > target + 0.6) brake = clamp((c.v - target) / 3, 0.3, 1); else throttle = 0.7;
  return { throttle, brake, steer: c.steer };
}

/* lateral target for an AI car on the pit entry or pit exit road (null when not relevant) */
function pitPathLat(c, i, Tr) {
  const P = Tr.pit, N = Tr.N, kk = (i - P.entry + N) % N, before = (P.entry - i + N) % N, edge = P.side * (W + 0.6);
  if (c.pitReq && !c.pit) {
    if (before > 0 && before < 75) return Tr.race[i] + (edge - Tr.race[i]) * smooth(75, 0, before);
    if (kk <= P.limIn + 2) return edge + (P.fast - edge) * smooth(0, P.limIn - 6, kk);
  }
  if (c.inPitRoad && !c.pit && kk >= P.limOut - 2 && kk < P.len) return P.fast + (P.side * (W - 1.5) - P.fast) * smooth(P.limOut, P.len - 4, kk);
  return null;
}

/* slipstream: being close behind another car (and roughly in line with it) at speed */
function computeTow() {
  const cars = game.cars;
  for (const c of cars) {
    c.tow = 0;
    if (!c.active || c.pit || c.dnf || Math.abs(c.v) < 30) continue;
    const fx = Math.sin(c.h), fz = Math.cos(c.h), lx = Math.cos(c.h), lz = -Math.sin(c.h);
    for (const o of cars) {
      if (o === c || !o.active || o.pit || o.dnf || Math.abs(o.v) < 25) continue;
      const dx = o.x - c.x, dz = o.z - c.z, ahead = dx * fx + dz * fz, side = Math.abs(dx * lx + dz * lz);
      if (ahead < 4 || ahead > 45 || side > 3) continue;
      c.tow = Math.max(c.tow, (1 - (ahead - 4) / 41) * (1 - side / 3));
    }
  }
}

/* ---------------- Collisions (impulse based) ---------------- */
function collide() {
  const cars = game.cars.filter(c => c.active && !c.pit && !(c.dnf && Math.abs(c.v) < 1));
  for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
    const A = cars[a], B = cars[b], dx0 = B.x - A.x, dz0 = B.z - A.z;
    if (dx0 * dx0 + dz0 * dz0 > 64) continue;
    const fa = [Math.sin(A.h), Math.cos(A.h)], fb = [Math.sin(B.h), Math.cos(B.h)];
    let best = null;
    for (const oa of [1.35, -1.35]) for (const ob of [1.35, -1.35]) {
      const ax = A.x + fa[0] * oa, az = A.z + fa[1] * oa, bx = B.x + fb[0] * ob, bz = B.z + fb[1] * ob, d = Math.hypot(bx - ax, bz - az);
      if (d < 2.15 && d > 1e-4 && (!best || d < best.d)) best = { d, dx: (bx - ax) / d, dz: (bz - az) / d, oa, ob };
    }
    if (!best) continue;
    const { d, dx, dz, oa, ob } = best, push = (2.15 - d) / 2;
    A.x -= dx * push; A.z -= dz * push; B.x += dx * push; B.z += dz * push;
    const vax = A.v * Math.sin(A.vh), vaz = A.v * Math.cos(A.vh), vbx = B.v * Math.sin(B.vh), vbz = B.v * Math.cos(B.vh);
    const vn = (vbx - vax) * dx + (vbz - vaz) * dz;
    if (vn >= 0) continue;
    const cs = -vn, j = cs * (1 + 0.3) / 2;
    setVel(A, vax - j * dx, vaz - j * dz); setVel(B, vbx + j * dx, vbz + j * dz);
    // off-centre hits make cars rotate
    const la = Math.cos(A.h) * dx - Math.sin(A.h) * dz, lb = Math.cos(B.h) * dx - Math.sin(B.h) * dz;
    if (cs > 3) { A.spin += clamp(-oa * j * la * 0.09, -2.5, 2.5); B.spin += clamp(ob * j * lb * 0.09, -2.5, 2.5); }
    if (cs > 5) {
      const aF = fa[0] * dx + fa[1] * dz, bF = -(fb[0] * dx + fb[1] * dz);
      if (A.isPlayer || B.isPlayer) game.player.impact = Math.min(1, cs / 18);
      A.hitT = B.hitT = Math.min(1, cs / 20); A.hitSide = la > 0 ? 1 : -1; B.hitSide = lb > 0 ? -1 : 1;
      // AI-vs-AI bumps in the pack are softened so races are not decided by AI jostling
      const sc = (A.isPlayer || B.isPlayer) ? 1 : 0.35;
      damage(A, cs * 0.85, aF > 0.55 ? 'front' : aF < -0.55 ? 'rear' : 'side', sc);
      damage(B, cs * 0.85, bF > 0.55 ? 'front' : bF < -0.55 ? 'rear' : 'side', sc);
      if (aF > bF) contactFault(A, B, cs); else contactFault(B, A, cs);
    }
  }
}

/* ---------------- Race rules ---------------- */
function addPenalty(c, secs, why) {
  c.penalty += secs; (c.penLog = c.penLog || []).push(why);
  if (c.isPlayer) { radio(secs + ' second time penalty: ' + why + '.', 'bad'); updatePenTag(); }
  else if (Math.abs(positionOf(c) - positionOf(game.player)) <= 3) radio(c.code + ' gets a ' + secs + 's penalty for ' + why + '.', 'info', 4);
}
function contactFault(hitter, victim, cs) {
  if (!racing() || !(hitter.isPlayer || victim.isPlayer) || game.raceTime - hitter.contactT < 3) return;
  hitter.contactT = game.raceTime;
  if (cs >= 11) addPenalty(hitter, 5, 'causing a collision');
  else if (hitter.isPlayer) radio('Careful, that contact with ' + victim.code + ' is being looked at.', 'warn');
}
/* pit entry and exit roads count as track: no track-limit strikes on the pit side while using them */
function onPitRoad(c, Tr) {
  if (c.pit || c.inPitRoad) return true;
  const P = Tr.pit, N = Tr.N;
  if (c.lat * P.side <= 0) return false;
  const kk = (c.idx - P.entry + N) % N, before = (P.entry - c.idx + N) % N;
  if (kk < P.limIn + 20 || (kk > P.limOut - 20 && kk < P.len)) return true;    // entry and exit roads
  if (before <= 40 && c.pitReq) return true;                                     // diving across to the pit entry
  const dt0 = game.raceTime - (c.pitExitT ?? -99); return dt0 >= 0 && dt0 < 5;                               // rejoining after the pit exit
}
function trackLimits(c) {
  const out = Math.abs(c.lat) > W + KERB + 0.9 && !c.dnf && !onPitRoad(c, game.T);
  if (out && !c.offLimits && Math.abs(c.v) > 12) {
    if (c.isPlayer && !c.lapInvalid && !isRace() && game.session !== 'tt' && c.maxDone >= 0) radio('Lap deleted for track limits.', 'bad', 3);
    if (c.isPlayer) c.lapInvalid = true;
    if (racing()) {
      c.strikes++;
      if (c.strikes > 3 && c.isPlayer) addPenalty(c, 5, 'track limits');
      else if (c.isPlayer) { radio(c.strikes === 3 ? 'Black and white flag. One more and it is a penalty.' : 'Track limits warning, ' + c.strikes + ' of 3.', c.strikes === 3 ? 'bad' : 'warn'); updatePenTag(); }
    }
  }
  c.offLimits = out;
}
const crossed = (N, from, to, mark) => { const span = (to - from + N) % N; const m = (mark - from + N) % N; return span > 0 && span < N / 2 && m > 0 && m <= span; };
const inZone = (N, i, z) => ((i - z.start + N) % N) <= ((z.end - z.start + N) % N);
function carAhead(c) {
  let best = null, bd = Infinity;
  for (const o of game.cars) { if (o === c || !o.active || o.finished || o.dnf || o.pit) continue; const d = o.prog - c.prog; if (d > 0 && d < bd) { bd = d; best = o; } }
  return best;
}
const freeDrs = () => !isRace() && weather.average() < 0.25;
const drsEnabled = c => freeDrs() || (racing() && !game.flag && c.maxDone >= 1 && c.maxDone >= (game.drsHoldLap || 0) && weather.average() < 0.25);
function drsLogic(c, prevIdx, Tr) {
  if (c.pit || c.dnf) { c.drsOpen = false; return; }
  const N = Tr.N;
  Tr.drs.forEach((z, k) => {
    if (crossed(N, prevIdx, c.idx, z.detect)) {
      game.drsCross[k][c.code] = game.raceTime;
      const a = carAhead(c), t = a ? game.drsCross[k][a.code] : undefined;
      c.drsGap = t !== undefined ? game.raceTime - t : Infinity;
      c.drsArmed = (freeDrs() || (drsEnabled(c) && c.drsGap < 1.0)) ? k : -1;
      if (c.isPlayer && racing() && c.maxDone >= 1) {
        if (weather.average() >= 0.25) radio('DRS disabled: track is too wet.', 'info', 2.5);
        else radio(c.drsArmed === k ? 'DRS enabled, gap ' + c.drsGap.toFixed(2) + 's.' : (isFinite(c.drsGap) ? 'No DRS, gap ' + c.drsGap.toFixed(2) + 's.' : 'No DRS this time.'), c.drsArmed === k ? 'good' : 'info', 2.5);
      }
    }
    if (crossed(N, prevIdx, c.idx, z.start) && c.drsArmed === k) c.drsOpen = true;
  });
  if (c.drsOpen) { const z = Tr.drs[c.drsArmed]; if (!z || c.inp.brake > 0 || !inZone(N, c.idx, z)) { c.drsOpen = false; c.drsArmed = -1; } }
}

/* Pit decisions: evaluated ~300 m before pit entry each lap */
function pitDecision(c, prevIdx, Tr) {
  if (game.phase === 'run' && c.isPlayer) return qualiPitDecision(c, prevIdx, Tr);
  if (!racing() || c.pit || c.dnf || c.finished) return;
  const evalAt = (Tr.pit.entry - 150 + Tr.N) % Tr.N;
  if (!crossed(Tr.N, prevIdx, c.idx, evalAt)) return;
  const lap = curLap(c), lapsLeft = game.laps - lap, w = weather.average(), comp = c.tyre.comp;
  if (lap >= game.laps) return;
  let reason = null;
  if (SLICK(comp) && w > 0.32) reason = w > 0.6 ? 'wet' : 'inter';
  else if (comp === 'inter' && w < 0.12 && lapsLeft >= 1) reason = 'slicks';
  else if (comp === 'wet' && w < 0.45) reason = 'inter';
  else if (c.dmg.fw > 0.45 || c.dmg.punct || c.dmg.rw > 0.5) reason = 'damage';
  else if (c.plan && c.plan[c.planIdx + 1] && lap >= c.plan[c.planIdx + 1][1] && lapsLeft >= 1) reason = 'plan';
  else if (c.tyre.wear > 1.15 && lapsLeft >= 2) reason = 'wear';
  if (!reason) return;
  if (c.isPlayer) {
    if (c.pitReq) return;
    c.pitReq = true;
    const msg = { wet: 'Box, box. Heavy rain, we are going to full wets.', inter: 'Box, box. Rain is here, box for intermediates.', slicks: 'Track is drying. Box, box for slicks.', damage: 'Box this lap, we will fix the car.', plan: 'Box, box. Box this lap for ' + COMP[nextCompound(c)].name + 's.', wear: 'Tyres are finished. Box this lap.' }[reason];
    radio(msg + ' (P to stay out)', 'warn', 8);
  } else c.pitReq = true;
}

/* ---------------- Flags: VSC, Safety Car, Red flag ---------------- */
let scObj = null, sc = null;
function clearSC() { if (sc && scObj) scene.remove(scObj.group); sc = null; }
function flagBanner(text, cls) { const el = $('flag'); el.textContent = text; el.className = cls; }
function flagSpeed(c, Tr, target) {
  const f = game.flag;
  if (f.type === 'vsc') return Math.max(20, Tr.vprof[c.idx] * 0.6);
  if (f.type === 'sc') {
    // no overtaking: queue up behind the car (or the safety car) ahead with a ~14 m gap
    let ahead = null, bd = Infinity;
    for (const o of game.cars) { if (o === c || !o.active || o.dnf || o.pit || o.finished) continue; const dp = o.prog - c.prog; if (dp > 0 && dp < bd) { bd = dp; ahead = o; } }
    if (sc) { const dp = sc.prog - c.prog; if (dp > 0 && dp < bd) { bd = dp; ahead = { v: sc.v }; } }
    // everyone slows to the safety-car delta straight away (a little quicker if far behind, to close up)
    let cap = Math.min(55, Tr.vprof[c.idx] * 0.62);
    if (!ahead || bd * DS > 200) cap = Math.min(62, Tr.vprof[c.idx] * 0.7);
    if (ahead && bd * DS < 80) cap = Math.min(cap, Math.max(0, ahead.v + (bd * DS - 14) * 0.6));
    return cap;
  }
  return target;
}
function deployFlag(type, why) {
  if (!racing() || game.flag || game.phase !== 'race') return;
  if (type === 'red') return redFlag(why);
  const p = game.player;
  game.flag = { type, t: game.raceTime, end: type === 'vsc' ? game.raceTime + 30 + Math.random() * 20 : Infinity, ahead: new Set(standings().slice(0, Math.max(0, positionOf(p) - 1)).map(c => c.code)), vscOver: 0, passT: 0, delta: 1.0, deltaLow: 0, dProg: null };
  for (const c of game.cars) { c.drsOpen = false; c.drsArmed = -1; }
  if (type === 'vsc') { radio('Virtual Safety Car: ' + why + '. Slow down and keep to the delta.', 'warn', 6); flagBanner('VIRTUAL SAFETY CAR', 'vsc'); }
  else {
    radio('Safety Car deployed: ' + why + '. No overtaking, close up to the car ahead.', 'warn', 7); flagBanner('SAFETY CAR', 'sc');
    const L = standings()[0];
    if (!scObj) scObj = makeSafetyCar();
    scene.add(scObj.group);
    sc = { prog: L.prog + 140, v: 40, inLap: false, last: 0 }; game.flag.startLap = L.maxDone;
  }
}
function clearFlag() {
  game.flag = null; $('delta').className = 'hidden'; game.drsHoldLap = standings()[0].maxDone + 1;
  flagBanner('GREEN FLAG', 'green'); setTimeout(() => { if (!game.flag) $('flag').className = 'hidden'; }, 2500);
  radio('Green flag! Racing resumes.', 'good', 4);
}
function updateFlags(dt) {
  const f = game.flag; if (!f || !racing()) { if ($('delta').className !== 'hidden') $('delta').className = 'hidden'; return; }
  const Tr = game.T, st = standings(), L = st[0], p = game.player;
  if (f.type === 'vsc') {
    if (game.raceTime > f.end - 6 && !f.ending) { f.ending = true; radio('VSC ending. Get ready to go.', 'info', 4); flagBanner('VSC ENDING', 'vsc'); }
    // the player must keep the delta positive (slower than the VSC reference lap)
    deltaStep(f, p, Tr, dt, true);
    if (game.raceTime >= f.end) clearFlag();
    return;
  }
  if (f.type === 'sc') {
    // until the player has caught the queue, they must also keep to the Safety Car delta
    deltaStep(f, p, Tr, dt, !closeBehind(p));
    if (sc) {
      const gapS = (sc.prog - L.prog) * DS;
      const i = Math.floor(((sc.prog % Tr.N) + Tr.N) % Tr.N) % Tr.N;
      let tgt = clamp(Tr.vprof[i] * 0.58, 24, 48); if (gapS > 160) tgt = 18;
      sc.v += clamp(tgt - sc.v, -10 * dt, 6 * dt); sc.prog += sc.v * dt / DS;
      const i2 = Math.floor(((sc.prog % Tr.N) + Tr.N) % Tr.N) % Tr.N;
      scObj.group.position.set(Tr.px[i2], bankH(Tr, i2, 0), Tr.pz[i2]); scObj.group.rotation.y = Math.atan2(Tr.tx[i2], Tr.tz[i2]);
      scObj.lamps.forEach((l, k) => l.color.set(sc.inLap ? '#222222' : ((performance.now() / 250 | 0) + k) % 2 ? '#ffb000' : '#3a2a00'));
      if (!sc.inLap && L.maxDone - f.startLap >= 2 && gapS < 40) { sc.inLap = true; radio('Safety Car in this lap. Leader controls the restart.', 'info', 5); flagBanner('SAFETY CAR IN THIS LAP', 'sc'); }
      if (sc.inLap && crossed(Tr.N, sc.last, i2, Tr.pit.entry)) { scene.remove(scObj.group); sc = null; f.restartLap = L.maxDone; }
      else sc.last = i2;
    } else if (f.restartLap !== undefined && L.maxDone > f.restartLap) clearFlag();
    // no overtaking under the safety car
    const passed = [...f.ahead].map(code => game.cars.find(c => c.code === code)).filter(c => c && !c.dnf && !c.pit && c.prog < p.prog - 2);
    if (passed.length && !p.pit) {
      f.passT += dt;
      if (f.passT > 0.5 && !f.toldBack) { f.toldBack = true; radio('You overtook ' + passed[0].code + ' under the Safety Car. Give the place back!', 'bad', 6); }
      if (f.passT > 12) { addPenalty(p, 5, 'overtaking under the Safety Car'); passed.forEach(c => f.ahead.delete(c.code)); f.passT = 0; f.toldBack = false; }
    } else { f.passT = 0; f.toldBack = false; }
  }
}
/* F1-style delta: time taken since the flag minus the reference time for the same distance at the
   VSC / Safety Car reference pace. Positive = slower than the reference (fine), negative = too fast. */
function refSpeed(f, Tr, i) { return f.type === 'vsc' ? Math.max(20, Tr.vprof[i] * 0.6) * 1.03 : Math.min(56, Tr.vprof[i] * 0.64); }
function closeBehind(c) {
  for (const o of game.cars) { if (o === c || !o.active || o.dnf || o.pit) continue; const d = (o.prog - c.prog) * DS; if (d > 0 && d < 150) return true; }
  return sc ? (sc.prog - c.prog) * DS > 0 && (sc.prog - c.prog) * DS < 150 : false;
}
function deltaStep(f, p, Tr, dt, enforce) {
  const el = $('delta');
  if (p.pit || p.dnf || p.finished) { f.dProg = null; el.className = 'hidden'; return; }
  if (f.dProg === null) f.dProg = p.prog;
  const ds = Math.max(0, p.prog - f.dProg) * DS; f.dProg = p.prog;
  f.delta += dt - ds / refSpeed(f, Tr, p.idx);
  f.delta = Math.min(f.delta, 9.9);
  const d = f.delta;
  el.className = d >= 0.3 ? 'ok' : d >= -0.3 ? 'close' : 'bad';
  $('deltaVal').textContent = (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1);
  if (!enforce) { f.deltaLow = 0; return; }
  if (d < -0.3) {
    f.deltaLow += dt;
    if (f.deltaLow > 1.5 && !f.warned) { f.warned = true; radio('Delta is negative. Slow down and get back above the delta!', 'bad', 4); }
    if (f.deltaLow > 5 && !f.penal) { f.penal = true; addPenalty(p, 5, f.type === 'vsc' ? 'not respecting the VSC delta' : 'not respecting the Safety Car delta'); }
  } else f.deltaLow = Math.max(0, f.deltaLow - dt);
}
function redFlag(why) {
  $('delta').className = 'hidden';
  game.flag = { type: 'red', t: game.raceTime }; game.phase = 'red'; game.redT = 4;
  if (sc) { scene.remove(scObj.group); sc = null; }
  radio('RED FLAG: ' + why + '. Session suspended, back to the grid.', 'bad', 8); flagBanner('RED FLAG', 'red');
}
function restartFromRed() {
  const Tr = game.T, order = standings().filter(c => !c.dnf), L = Math.max(0, order[0].maxDone);
  if (game.laps - L < 1) { for (const c of order) if (!c.finished) { c.finished = true; c.finishTime = game.raceTime; c.finishOrder = ++game.finishCount; } game.phase = 'finished'; showResults(); return; }
  placeGrid(order, Tr);
  const w = weather.average();
  for (const c of order) {
    c.prog += L * Tr.N; c.maxDone = L; c.lapStart = game.raceTime; c.splits = {}; c.lastBucket = Math.floor(c.prog / 25);
    c.v = 0; c.spin = 0; c.pit = null; c.inPitRoad = false; c.pitReq = false; c.drsOpen = false; c.drsArmed = -1;
    c.dmg = { fw: 0, rw: 0, susp: Math.min(c.dmg.susp, 0.5), punct: false, pull: 0 }; c.fwing.visible = c.rwing.visible = true;
    setTyres(c, w > 0.55 ? 'wet' : w > 0.2 ? 'inter' : (SLICK(c.tyre.comp) && c.tyre.comp !== 'soft' ? c.tyre.comp : 'medium'));
  }
  game.flag = null; game.phase = 'lights'; game.lightsT = 0; game.goAt = 5.6 + Math.random() * 1.2; game.drsHoldLap = L + 1;
  $('startLights').classList.remove('hidden'); flagBanner('RESTART', 'green'); setTimeout(() => { if (!game.flag) $('flag').className = 'hidden'; }, 3000);
  radio('Standing restart. ' + (game.laps - L) + ' laps to go. Fresh tyres fitted.', 'info', 6);
}
function incident(why) {
  if (!racing()) return;
  game.dnfTimes = (game.dnfTimes || []).filter(t => game.raceTime - t < 15); game.dnfTimes.push(game.raceTime);
  if (game.dnfTimes.length >= 3) return deployFlag('red', 'multiple cars crashed');
  if (game.flag) return;
  deployFlag(Math.random() < 0.55 ? 'sc' : 'vsc', why);
}

function qualiPitDecision(c, prevIdx, Tr) {
  if (c.pit || c.pitReq) return;
  const evalAt = (Tr.pit.entry - 150 + Tr.N) % Tr.N;
  if (!crossed(Tr.N, prevIdx, c.idx, evalAt)) return;
  const w = weather.average(), comp = c.tyre.comp, q = game.session !== 'tt';
  let msg = null;
  if (SLICK(comp) && w > 0.32) msg = (q ? 'We know it is quali, but it is raining too hard for slicks. ' : 'Too wet for slicks now. ') + (w > 0.6 ? 'Box, box for full wets.' : 'Box, box for inters.');
  else if (comp === 'inter' && w < 0.12) msg = 'Track is dry enough now. Box for softs, there is time to find.';
  else if (comp === 'wet' && w < 0.45) msg = 'Rain has eased. Box for inters.';
  else if (c.dmg.fw > 0.45 || c.dmg.punct) msg = 'We need to fix the car. Box this lap.';
  if (!msg) return;
  c.pitReq = true; radio(msg + (q ? ' This lap will not count against your flying laps.' : '') + ' (P to stay out)', 'warn', 8);
}

/* ---------------- Laps & sessions ---------------- */
function checkLaps(c, Tr) {
  const done = Math.floor(c.prog / Tr.N), bucket = Math.floor(c.prog / 25);
  if (bucket > c.lastBucket) { c.splits[bucket] = game.raceTime; c.lastBucket = bucket; }
  trackLimits(c);
  if (done <= c.maxDone) return;
  if (done === 0 && !isRace()) { c.lapStart = game.raceTime; c.lapInvalid = false; if (c.isPlayer && game.session !== 'tt') radio('Flying lap. Push now.', 'info', 2.5); }
  if (done >= 1) {
    const lt = game.raceTime - c.lapStart, valid = !(c.isPlayer && c.lapInvalid);
    c.lastLap = lt; c.lapTimes.push(lt);
    if (valid && lt < c.bestLap) c.bestLap = lt;
    c.lapStart = game.raceTime;
    if (isRace() && valid && lt < game.fastest && done >= 1) { game.fastest = lt; if (c.isPlayer && done > 1) radio('Purple! Fastest lap of the race: ' + fmt(lt) + '.', 'good', 4); }
    const notTimed = c.isPlayer && !isRace() && (c.pit || c.outLap);
    if (notTimed) { c.outLap = !!c.pit; c.lapTimes.pop(); if (c.bestLap === lt) c.bestLap = Math.min(Infinity, ...c.lapTimes); flashMsg(c.pit ? 'IN LAP' : 'FLYING LAP', 1.5); c.lapInvalid = false; }
    else if (c.isPlayer) {
      if (valid && (!game.record || lt < game.record) && (game.session === 'tt' || !isRace())) { game.record = lt; store.set(bestKey(Tr), String(lt)); flashMsg('NEW RECORD', 2.5, fmt(lt)); }
      else if (!valid) flashMsg('LAP INVALID', 2, fmt(lt) + ' · track limits');
      else if (isRace() && done === game.laps - 1) flashMsg('FINAL LAP', 2, fmt(lt));
      else flashMsg('LAP ' + (done + 1), 1.8, fmt(lt));
      if (!isRace() && game.session !== 'tt') {
        c.timedLaps++;
        if (valid && lt < c.sessBest) c.sessBest = lt;
        if (c.timedLaps >= 2) { radio('Session over for us. ' + (isFinite(c.sessBest) ? 'Best ' + fmt(c.sessBest) + '.' : 'No time set.'), 'info', 4); c.lapInvalid = false; game.sessionEndAt = game.raceTime + 1.2; }
      }
      if (isRace()) lapRadio(c, done);
      c.lapInvalid = false;
    }
  }
  c.maxDone = done;
  if (c.isPlayer && isRace() && done === 1 && Tr.drs.length) radio('DRS is now enabled. Within one second at detection.', 'info', 4);
  if (isRace() && done >= game.laps && !c.finished) {
    c.finished = true; c.finishTime = game.raceTime; c.finishOrder = ++game.finishCount;
    if (c.isPlayer) onPlayerFinish();
  }
}
function onPlayerFinish() {
  const p = game.player;
  game.phase = 'finished'; p.autopilot = true; p.pace = 0.8;
  flashMsg(p.finishOrder === 1 ? 'YOU WIN!' : 'FINISHED P' + positionOf(p), 3, fmt(p.finishTime));
  radio(p.finishOrder === 1 ? 'Get in there! That is the win!' : 'Chequered flag. P' + positionOf(p) + '. Good job.', 'good', 6);
  game.resultsAt = game.raceTime + 3.2;
}
function standings() {
  const cars = game.cars.filter(c => c.active);
  return cars.sort((a, b) => {
    if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
    if (a.finished && b.finished) return a.finishOrder - b.finishOrder;
    if (a.finished) return -1; if (b.finished) return 1;
    return b.prog - a.prog;
  });
}
const positionOf = c => standings().indexOf(c) + 1;

/* ---------------- Race engineer & team orders ---------------- */
let radioQ = [], radioNext = 0;
function radio(text, kind = 'info', dur = 6) {
  if (performance.now() < radioNext && kind !== 'bad') { if (radioQ.length < 3) radioQ.push([text, kind, dur]); return; }
  showRadio(text, kind, dur);
}
function showRadio(text, kind, dur) {
  radioNext = performance.now() + 1800;
  const box = $('radio'), el = document.createElement('div');
  el.className = 'rmsg ' + kind; el.innerHTML = '<span class="who">RACE ENGINEER</span>' + text;
  box.prepend(el); while (box.children.length > 4) box.lastChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 500); }, dur * 1000);
}
function pumpRadio() { if (radioQ.length && performance.now() >= radioNext) showRadio(...radioQ.shift()); }
function gapTo(a, b) {
  const bk = Math.min(a.lastBucket, b.lastBucket), ta = a.splits[bk], tb = b.splits[bk];
  return ta !== undefined && tb !== undefined ? Math.abs(ta - tb) : null;
}
function lapRadio(p, done) {
  if (done >= game.laps) return;
  const st = standings(), i = st.indexOf(p), ahead = st[i - 1], behind = st[i + 1];
  const parts = ['P' + (i + 1) + '.'];
  if (ahead) { const g = gapTo(p, ahead); if (g !== null) parts.push('Gap to ' + ahead.code + ' ' + g.toFixed(1) + '.'); }
  if (behind) { const g = gapTo(p, behind); if (g !== null) parts.push(behind.code + ' is ' + g.toFixed(1) + ' behind.'); }
  if (done === game.laps - 1) parts.push('Last lap, bring it home.');
  radio(parts.join(' '), 'info', 5);
}
function engineerTick() {
  const p = game.player; if (!(racing() || game.phase === 'run') || p.dnf) return;
  const quali = !isRace();
  const wx = game.wx, t = game.raceTime, g = weather.global(t);
  if (racing() && !game.redWx && weather.average() > 0.93) { game.redWx = true; deployFlag('red', 'too much standing water'); }
  // weather calls
  const nr = weather.nextRain(t);
  if (!wx.forecastSaid && nr - t < 70 && nr - t > 10 && g < 0.05) { wx.forecastSaid = true; radio('Rain expected in about a minute.', 'warn'); }
  if (!wx.raining && g > 0.05) {
    wx.raining = true; wx.level = Math.max(g, 0.3); wx.lastT = t;
    const sr = weather.sectorRain(), worst = sr.indexOf(Math.max(...sr)) + 1;
    radio((quali ? 'Rain is starting to fall, heaviest in sector ' + worst + '. Get a lap in now before it gets worse.' : "It's starting to rain. Heaviest in sector " + worst + '.'), 'warn');
  } else if (wx.raining) {
    if (t - (wx.lastT || 0) < 30) { /* don't nag */ }
    else if (g > wx.level + 0.3) { wx.lastT = t; wx.level = g; const sr = weather.sectorRain(), worst = sr.indexOf(Math.max(...sr)) + 1; radio('Rain is getting heavier, especially in sector ' + worst + '.', 'warn'); }
    else if (g < wx.level - 0.25 && g > 0.04) { wx.lastT = t; wx.level = g; radio('Rain is getting lighter.', 'info'); }
    else if (g < 0.03) { wx.raining = false; wx.level = 0; radio('Rain has stopped. The track will start drying.', 'info'); }
  }
  if (quali) return;
  // tyres
  if (p.tyre.wear > 0.7 && p.wearWarn < 1) { p.wearWarn = 1; radio('Tyres are starting to go off.', 'info'); }
  if (p.tyre.wear > 1.0 && p.wearWarn < 2) { p.wearWarn = 2; radio('Tyres are gone. Expect a lot less grip.', 'warn'); }
  if (SLICK(p.tyre.comp) && weather.wetAt(p.idx) > 0.45 && !p.pitReq && !wx.slickWarn) { wx.slickWarn = true; radio('Careful, very slippery on slicks here.', 'warn'); }
  // compound rule reminder
  const lapsLeft = game.laps - curLap(p);
  if (game.laps >= 5 && lapsLeft === 3 && !wx.ruleSaid && !(p.stints || []).some(s => !SLICK(s)) && new Set(p.stints.filter(SLICK)).size < 2) { wx.ruleSaid = true; radio('Reminder: we must use a second dry compound. We need to box.', 'warn'); }
  teamOrders();
}
function teamOrders() {
  const p = game.player, m = game.mate, to = game.to;
  if (settings.mode !== 'champ' || !m || m.dnf || p.dnf || m.pit || p.pit || m.finished || p.finished) return;
  const gap = m.prog - p.prog, close = Math.abs(gap) < 45, lapsLeft = game.laps - curLap(p), t = game.raceTime;
  if (to.issued === 'let') {
    if (m.prog > p.prog + 8) { to.issued = 'done'; radio('Thank you. Good team play.', 'good'); }
    else if (t > to.deadline) { to.issued = 'done'; radio('You ignored a team order. That will be discussed after the race.', 'bad'); }
    return;
  }
  if (to.issued) return;
  if (!close || t < 45) { to.closeT = 0; return; }
  to.closeT = (to.closeT || 0) + 1;
  if (to.closeT < 8 || Math.random() > 0.15) return;
  if (lapsLeft <= 1) { to.issued = 'hold'; radio('Team order: hold position. No racing your teammate.', 'warn'); return; }
  if (gap < 0 && m.lastLap && p.lastLap && m.lastLap < p.lastLap - 0.25) { to.issued = 'let'; to.deadline = t + 50; radio('Team order: ' + m.code + ' is faster. Let them through, please.', 'warn', 8); }
  else if (gap > 0 && m.lastLap && p.lastLap && p.lastLap < m.lastLap - 0.25) { to.issued = 'swap'; m.yieldT = 14; radio('We have told ' + m.code + ' to let you by. Get past on the next straight.', 'good', 7); }
}

/* ---------------- Effects ---------------- */
const tmpC = new THREE.Color();
const SMOKE = new THREE.Color('#e9e9ea'), DUST = new THREE.Color('#c9b48a'), GRASS = new THREE.Color('#6b7a3a'), SPARK = new THREE.Color(3, 1.6, 0.5), SPRAY = new THREE.Color('#c5ccd4');
function carEffects(c, dt) {
  if (!c.active || !c.group.visible) return;
  const camD = Math.hypot(c.x - camera.position.x, c.z - camera.position.z);
  if (camD > 220) { for (let k = 0; k < 2; k++) skids.lift(c.code + k); return; }
  const fx = Math.sin(c.h), fz = Math.cos(c.h), lx = Math.cos(c.h), lz = -Math.sin(c.h), sp = Math.abs(c.v);
  const wheel = (side, z) => [c.x + lx * side * 0.83 + fx * z, c.z + lz * side * 0.83 + fz * z];
  const wet = weather.wetAt(c.idx), ey = c.group.position.y;
  const lock = c.isPlayer && !c.autopilot && c.inp.brake > 0.8 && sp > 25 && Math.abs(c.steer) > 0.5;
  const sliding = lock || c.scrub > 0.9 || Math.abs(c.slip) > 0.35;
  [[1, AXLE_F], [-1, AXLE_F]].forEach(([s, z], k) => {
    const [x, wz] = wheel(s, z);
    if (sliding && c.surf <= 2 && wet < 0.3) {
      skids.mark(c.code + k, x, wz, fx, fz, 0.55, ey);
      if (Math.random() < dt * 40) smoke.spawn(x, ey + 0.3, wz, -fx * sp * 0.15 + (Math.random() - 0.5), 0.6 + Math.random(), -fz * sp * 0.15 + (Math.random() - 0.5), 1.4 + Math.random(), 0.8, 4.5, 0.32, SMOKE, 1.2);
    } else skids.lift(c.code + k);
  });
  // spray off the rear tyres in the wet
  if (wet > 0.2 && sp > 15 && Math.random() < dt * 60 * wet) {
    const [x, wz] = wheel(Math.random() < 0.5 ? 1 : -1, -1.7);
    smoke.spawn(x, ey + 0.5, wz, -fx * sp * 0.35 + (Math.random() - 0.5) * 2, 0.8 + Math.random(), -fz * sp * 0.35 + (Math.random() - 0.5) * 2, 0.9 + Math.random() * 0.6, 1.2, 6, 0.16 + 0.12 * wet, SPRAY, 1.6);
  }
  if (c.surf >= 3 && sp > 6) {
    for (const s of [1, -1]) {
      const [x, wz] = wheel(s, AXLE_R);
      if (Math.random() < dt * 30) { tmpC.copy(c.surf === 3 ? DUST : GRASS); smoke.spawn(x, ey + 0.25, wz, -fx * sp * 0.2 + (Math.random() - 0.5) * 2, 1 + Math.random() * 2, -fz * sp * 0.2 + (Math.random() - 0.5) * 2, 1.6, 1, 5, c.surf === 3 ? 0.55 : 0.35, tmpC, 1); }
    }
  }
  c.sparkT -= dt;
  const sparkRate = wet > 0.3 ? 0 : (sp > 62 && Math.abs(T().curv[c.idx]) < 0.003 ? 0.6 : 0) + (c.surf === 1 && sp > 35 ? 3 : 0);
  if (c.sparkT <= 0 && sparkRate > 0 && Math.random() < sparkRate * dt * 8) {
    c.sparkT = 0.15 + Math.random() * 0.4;
    for (let k = 0; k < 14; k++) sparks.spawn(c.x - fx * 1.9 + (Math.random() - 0.5) * 0.6, ey + 0.06, c.z - fz * 1.9 + (Math.random() - 0.5) * 0.6, -fx * sp * 0.35 + (Math.random() - 0.5) * 4, 0.5 + Math.random() * 2.5, -fz * sp * 0.35 + (Math.random() - 0.5) * 4, 0.25 + Math.random() * 0.35, 0.22, 0.08, 1, SPARK, 2, 9.8);
  }
  if (c.hitT > 0.05) {
    for (let k = 0; k < 30 * c.hitT; k++) sparks.spawn(c.x + lx * (c.hitSide || 1) * 0.9, ey + 0.4, c.z + lz * (c.hitSide || 1) * 0.9, fx * sp * 0.5 + (Math.random() - 0.5) * 8, Math.random() * 5, fz * sp * 0.5 + (Math.random() - 0.5) * 8, 0.3 + Math.random() * 0.4, 0.25, 0.1, 1, SPARK, 1.5, 9.8);
    smoke.spawn(c.x, ey + 0.6, c.z, 0, 1, 0, 1.5, 1, 6, 0.3 * c.hitT, SMOKE, 1);
    c.hitT = 0;
  }
  if (c.dmg.punct && sp > 8 && Math.random() < dt * 20) sparks.spawn(c.x, ey + 0.05, c.z, -fx * sp * 0.3, Math.random() * 2, -fz * sp * 0.3, 0.3, 0.2, 0.08, 1, SPARK, 2, 9.8);
}

/* ---------------- Update ---------------- */
let msgTimer = 0, tickT = 0;
function flashMsg(text, dur, sub) { $('msg').innerHTML = text + (sub ? '<small>' + sub + '</small>' : ''); $('msg').classList.add('show'); msgTimer = dur; }
function setStartLights(n) { world.setStartLights(n); [...$('startLights').children].forEach((p, k) => p.classList.toggle('on', k < n)); }

function update(dt) {
  const Tr = game.T, p = game.player;
  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) $('msg').classList.remove('show'); }
  pumpRadio();
  if (game.phase === 'idle') return;
  if (game.phase === 'red') { game.redT -= dt; if (game.redT <= 0) restartFromRed(); return; }
  if (game.phase === 'garage') { p.rpm += (4000 - p.rpm) * Math.min(1, dt * 2); if (keys.w) leaveGarage(); return; }
  if (game.phase === 'lights') {
    game.lightsT += dt;
    setStartLights(Math.min(5, Math.floor(game.lightsT)));
    if (game.lightsT >= game.goAt) { game.phase = 'race'; setStartLights(0); flashMsg('GO!', 1.2); }
    const rev = keys.w ? 1 : 0;
    p.rpm += ((rev ? 11000 : 4000) - p.rpm) * Math.min(1, dt * (rev ? 4 : 2));
    audio.set(p.rpm, rev, true);
    return;
  }
  game.raceTime += dt;
  weather.update(dt, game.raceTime);
  if (game.raceTime > 1 && !$('startLights').classList.contains('hidden')) $('startLights').classList.add('hidden');
  computeTow();
  const steps = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / steps;
  for (let s = 0; s < steps; s++) {
    for (const c of game.cars) {
      if (!c.active) continue;
      let inp = (c.isPlayer && !c.autopilot) ? playerInput(c, h) : aiInput(c, h, Tr);
      if (c.startDelay > 0) { c.startDelay -= h; inp = { throttle: 0, brake: 0, steer: 0 }; }
      c.inp = inp;
      const prev = c.idx; const wasPit = !!c.pit;
      stepCar(c, inp, h, Tr);
      if (!c.pit && !wasPit && c.inPitRoad && crossed(Tr.N, prev, c.idx, (Tr.pit.entry + Tr.pit.limIn) % Tr.N) && !c.dnf) {
        if (racing() && c.v > 25.5) addPenalty(c, 5, 'speeding in the pit lane');
        c.pit = { stage: 'in', k: Tr.pit.limIn, lat0: c.lat, wait: 0, stopAtBox: c.pitReq && !c.finished }; c.drsOpen = false;
        if (c.isPlayer) radio(c.pit.stopAtBox ? 'Pit limiter on. Crew are ready.' : 'Pit limiter on. Drive-through, we are not stopping.', 'info', 2.5);
      }
      drsLogic(c, prev, Tr);
      pitDecision(c, prev, Tr);
    }
    collide();
    for (const c of game.cars) if (c.active) checkLaps(c, Tr);
  }
  // quali: reveal rival lap times as the session goes on
  if (game.q && game.q.cur && !isRace() && game.session !== 'tt') {
    for (const r of game.q.cur.reveal) if (!r.shown && game.raceTime >= r.at) { r.shown = true; game.q.cur.times[r.c.code] = r.t; }
    if (game.sessionEndAt && game.raceTime >= game.sessionEndAt) { game.sessionEndAt = 0; endQualiSession(); }
  }
  tickT -= dt; if (tickT <= 0) { tickT = 1; engineerTick(); }
  updateFlags(dt);
  if (isRace() && game.resultsAt && game.raceTime >= game.resultsAt && $('results').classList.contains('hidden')) showResults();
}

function updateCarVisuals(dt) {
  for (const c of game.cars) {
    if (!c.group.visible) continue;
    c.group.position.set(c.x, 0, c.z); c.group.rotation.order = 'YXZ'; c.group.rotation.y = c.h;
    c.wheelRot += c.v * dt / 0.36;
    for (const w of c.wheels) { w.spin.rotation.x = c.wheelRot; if (w.front) w.pivot.rotation.y = c.steer * 0.32; }
    c.steering.rotation.z = -c.steer * 0.9;
    const tgtPitch = (c.inp.brake ? 0.012 : 0) - (c.inp.throttle && c.v < 60 ? 0.006 : 0) - Math.atan(game.T.grade[c.idx] || 0) * Math.cos(angDiff(c.h, Math.atan2(game.T.tx[c.idx], game.T.tz[c.idx]))), tgtRoll = -c.steer * Math.min(1, Math.abs(c.v) / 50) * 0.012 + c.dmg.pull * 0.15;
    c.group.rotation.x += (tgtPitch - c.group.rotation.x) * Math.min(1, dt * 6);
    c.roll = (c.roll || 0) + (tgtRoll - (c.roll || 0)) * Math.min(1, dt * 6); c.group.rotation.z = c.roll;
    const Tb = game.T, bh = bankH(Tb, c.idx, c.lat), inBank = Math.abs(c.lat) < W + KERB + 2 ? Math.atan(Tb.bank[c.idx]) : 0;
    c.group.rotation.z += inBank;
    c.group.position.y = bh + (c.lift || 0) + ((c.surf === 1 && Math.abs(c.v) > 10) ? Math.sin(performance.now() * 0.08 + c.x) * 0.012 : (c.dmg.punct ? -0.05 : 0));
    const sp = Math.abs(c.v);
    if (c.v < -0.5) { c.gear = -1; c.rpm = 4500 + sp * 400; }
    else {
      let g = 1; while (g < 8 && sp > GEARS[g]) g++;
      c.gear = sp < 0.3 ? 0 : g;
      const lo = GEARS[g - 1], hi = GEARS[g] === 200 ? 95 : GEARS[g];
      c.rpm = c.gear === 0 ? 4000 : 5200 + clamp((sp - lo) / (hi - lo), 0, 1) * 6800;
    }
    if (game.phase !== 'lights' && game.phase !== 'garage') carEffects(c, dt);
  }
  smoke.update(dt); sparks.update(dt);
}

/* ---------------- Camera ---------------- */
const tmpV = new THREE.Vector3(), tmpL = new THREE.Vector3(), camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function setCam(m, silent) {
  game.camMode = m; $('camName').textContent = CAMS[m];
  if (game.player) game.player.cockpitHide.forEach(o => o.visible = m !== 0);
  store.set('apexgp-cam', String(m)); camPos.set(0, 0, 0);
  if (!silent) flashMsg(CAMS[m], 0.9);
}
function updateCamera(dt, time) {
  const c = game.player, g = c.group; g.updateMatrixWorld();
  if (c.pit && c.pit.stage === 'garage') {
    const ps = game.T.pit.side;
    g.localToWorld(tmpV.set(ps * 5.5, 2.4, 4.2)); g.localToWorld(tmpL.set(0, 0.5, 0.4));
    camera.position.copy(tmpV); camera.lookAt(tmpL); camera.fov = 50; camera.updateProjectionMatrix(); camPos.set(0, 0, 0); return;
  }
  const sp = Math.abs(c.v), shake = (c.surf === 1 ? 0.012 : 0.002) * Math.min(1, sp / 60);
  const jx = (Math.random() - 0.5) * shake, jy = (Math.random() - 0.5) * shake;
  if (game.camMode === 0) {
    g.localToWorld(tmpV.set(jx, 0.92 + jy, 0.05)); g.localToWorld(tmpL.set(c.steer * 0.6, 0.95, 14));
    camera.position.copy(tmpV); camera.lookAt(tmpL); camera.fov = 72;
  } else if (game.camMode === 1) {
    g.localToWorld(tmpV.set(jx, 1.36 + jy, -0.5)); g.localToWorld(tmpL.set(0, 0.8, 12));
    camera.position.copy(tmpV); camera.lookAt(tmpL); camera.fov = 68;
  } else {
    // chase cam follows the direction of travel so slides are visible
    const slipLook = clamp(c.slip, -0.6, 0.6);
    g.localToWorld(tmpV.set(Math.sin(slipLook) * 9.8, 2.9, -9.8 * Math.cos(slipLook))); g.localToWorld(tmpL.set(-c.steer * 1.2, 1.0, 5));
    if (camPos.lengthSq() === 0) { camPos.copy(tmpV); camLook.copy(tmpL); }
    camPos.lerp(tmpV, 1 - Math.exp(-dt * 7)); camLook.lerp(tmpL, 1 - Math.exp(-dt * 12));
    camPos.y = Math.max(camPos.y, bankH(game.T, c.idx, c.lat) + 1.0);
    camera.position.copy(camPos).add(tmpV.set(jx * 4, jy * 4, 0)); camera.lookAt(camLook); camera.fov = 60 + sp * 0.1;
  }
  camera.updateProjectionMatrix();
}
function updateMenuCamera(dt) {
  const Tr = getTrack(settings.track);
  game.orbit += dt * 0.035;
  const i = Math.floor((game.orbit * 60) % Tr.N), j = (i + 40) % Tr.N, s = Math.sin(game.orbit * 0.7);
  camera.position.set(Tr.px[i] + Tr.nx[i] * (14 + 8 * s), elevAt(Tr, i) + 6 + 3 * Math.sin(game.orbit * 0.5), Tr.pz[i] + Tr.nz[i] * (14 + 8 * s));
  camera.lookAt(Tr.px[j], elevAt(Tr, j) + 1.5, Tr.pz[j]); camera.fov = 55; camera.updateProjectionMatrix();
}

/* ---------------- HUD ---------------- */
const mm = { ctx: $('minimap').getContext('2d'), bg: null, map: null };
function trackPath(pts, xs, zs, size, pad) {
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0; i < pts; i++) { minX = Math.min(minX, xs(i)); maxX = Math.max(maxX, xs(i)); minZ = Math.min(minZ, zs(i)); maxZ = Math.max(maxZ, zs(i)); }
  const sx = maxX - minX, sz = maxZ - minZ, sc = (size - pad * 2) / Math.max(sx, sz), ox = (size - sx * sc) / 2, oz = (size - sz * sc) / 2;
  const map = (x, z) => [ox + (x - minX) * sc, oz + (z - minZ) * sc];
  const path = new Path2D();
  for (let i = 0; i <= pts; i++) { const [x, y] = map(xs(i % pts), zs(i % pts)); i === 0 ? path.moveTo(x, y) : path.lineTo(x, y); }
  path.closePath();
  return { path, map };
}
function drawShape(ctx, path, map, start, lw) {
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = lw * 2.2; ctx.stroke(path);
  ctx.strokeStyle = '#e9edf3'; ctx.lineWidth = lw; ctx.stroke(path);
  const [sx, sy] = map(start[0], start[1]); ctx.fillStyle = '#ffcc00'; ctx.beginPath(); ctx.arc(sx, sy, lw * 1.4, 0, Math.PI * 2); ctx.fill();
}
function buildMinimap(Tr) {
  const off = document.createElement('canvas'); off.width = off.height = 400;
  const { path, map } = trackPath(Math.floor(Tr.N / 3), i => Tr.px[i * 3], i => Tr.pz[i * 3], 400, 26);
  const g = off.getContext('2d');
  drawShape(g, path, map, [Tr.px[0], Tr.pz[0]], 7);
  for (const z of Tr.drs) {
    g.strokeStyle = '#22e05a'; g.lineWidth = 9; g.lineCap = 'round'; g.beginPath();
    const len = (z.end - z.start + Tr.N) % Tr.N;
    for (let k = 0; k <= len; k += 3) { const i = (z.start + k) % Tr.N, [x, y] = map(Tr.px[i], Tr.pz[i]); k === 0 ? g.moveTo(x, y) : g.lineTo(x, y); }
    g.stroke();
    const d = z.detect, [x, y] = map(Tr.px[d], Tr.pz[d]), nx = Tr.nx[d], nz = Tr.nz[d];
    g.strokeStyle = '#ffffff'; g.lineWidth = 4; g.beginPath(); g.moveTo(x - nx * 13, y - nz * 13); g.lineTo(x + nx * 13, y + nz * 13); g.stroke();
  }
  mm.bg = off; mm.map = map; mm.T = Tr;
}
function drawMinimap() {
  const ctx = mm.ctx; ctx.clearRect(0, 0, 400, 400); ctx.drawImage(mm.bg, 0, 0);
  // rain overlay along the lap
  const Tr = mm.T;
  if (weather.N && weather.global(game.raceTime) > 0.02) {
    ctx.lineWidth = 16; ctx.lineCap = 'butt';
    for (let i = 0; i < Tr.N; i += 6) { const r = weather.rainAt(i); if (r < 0.05) continue; const j = Math.min(Tr.N - 1, i + 6), [x1, y1] = mm.map(Tr.px[i], Tr.pz[i]), [x2, y2] = mm.map(Tr.px[j], Tr.pz[j]); ctx.strokeStyle = 'rgba(60,140,255,' + (0.15 + 0.5 * r) + ')'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  }
  for (const c of game.cars) { if (c.isPlayer || !c.active || !c.group.visible) continue; const [x, y] = mm.map(c.x, c.z); ctx.fillStyle = c.dnf ? '#555' : c.color; ctx.strokeStyle = c.mate ? '#ffcc00' : '#000'; ctx.lineWidth = c.mate ? 4 : 2; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  const p = game.player, [x, y] = mm.map(p.x, p.z);
  ctx.fillStyle = '#ffcc00'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}
function updatePenTag() {
  const p = game.player, el = $('penTag'); if (!p) return;
  const parts = [];
  if (p.strikes) parts.push('TRACK LIMITS ' + Math.min(p.strikes, 3) + '/3');
  if (p.penalty) parts.push('+' + p.penalty + 's PENALTY');
  el.textContent = parts.join(' · '); el.classList.toggle('hidden', !parts.length);
}
function updateDrsHud() {
  const p = game.player, Tr = game.T, el = $('drs'), N = Tr.N;
  $('tow').className = (p.tow || 0) > 0.15 ? 'on' : 'hidden'; $('tow').textContent = 'SLIPSTREAM ' + Math.round((p.tow || 0) * 100) + '%';
  if (!Tr.drs.length || game.phase === 'lights' || game.phase === 'garage' || p.pit) { el.className = 'hidden'; return; }
  if (freeDrs() && !p.drsOpen) { let bd = Infinity; Tr.drs.forEach(z => { bd = Math.min(bd, ((z.start - p.idx + N) % N) * DS); }); if (bd <= 450) { el.className = 'armed'; el.textContent = 'DRS AVAILABLE · ' + Math.round(bd) + 'm'; } else el.className = 'hidden'; return; }
  if (p.drsOpen) { el.className = 'open'; el.textContent = 'DRS OPEN'; return; }
  let best = Infinity, bz = -1;
  Tr.drs.forEach((z, k) => { const d = ((z.start - p.idx + N) % N) * DS; if (d < best) { best = d; bz = k; } });
  if (best > 450) { el.className = 'hidden'; return; }
  if (p.drsArmed === bz) { el.className = 'armed'; el.textContent = 'DRS AVAILABLE · ' + Math.round(best) + 'm'; }
  else if (!drsEnabled(p)) { el.className = 'off'; el.textContent = 'DRS ZONE · ' + Math.round(best) + 'm · ' + (weather.average() >= 0.25 ? 'DISABLED (WET)' : 'DISABLED LAP 1'); }
  else { el.className = 'off'; el.textContent = 'DRS ZONE · ' + Math.round(best) + 'm' + (isFinite(p.drsGap) ? ' · GAP ' + p.drsGap.toFixed(1) + 's' : ''); }
}
function dmgColor(v) { return v < 0.05 ? '#2fd56a' : v < 0.4 ? '#f5c400' : v < 0.8 ? '#ff7a1a' : '#ff2a2a'; }
let boardT = 0;
function updateHUD(dt) {
  const p = game.player, Tr = game.T, sess = game.session;
  $('hSpd').textContent = Math.round(Math.abs(p.v) * 3.6);
  $('hGear').textContent = p.pit ? 'P' : p.gear === -1 ? 'R' : p.gear === 0 ? 'N' : p.gear;
  $('hRpm').textContent = Math.round(p.rpm / 100) * 100;
  const lit = clamp(Math.floor((p.rpm - 7000) / 450), 0, 10);
  [...$('shift').children].forEach((el, k) => el.className = k < lit ? (k < 4 ? 'g' : k < 8 ? 'r' : 'b') : '');
  const timing = isRace() ? game.phase !== 'lights' : p.maxDone >= 0;
  const cur = timing ? game.raceTime - p.lapStart : 0;
  $('hCur').textContent = cur > 0 ? fmt(cur) : (isRace() ? '0:00.000' : 'OUT LAP');
  $('hCur').classList.toggle('invalid', p.lapInvalid && timing);
  $('hLast').textContent = fmt(p.lastLap); $('hBest').textContent = fmt(isRace() || sess === 'tt' ? p.bestLap : p.sessBest); $('hRec').textContent = fmt(game.record);
  const fwd = Math.sin(p.h) * Tr.tx[p.idx] + Math.cos(p.h) * Tr.tz[p.idx];
  $('wrongway').classList.toggle('hidden', !(fwd < -0.3 && p.v > 3 && game.phase === 'race' && !p.pit));
  // tyres, damage, pit, weather widgets
  const comp = COMP[p.tyre.comp], wearPct = Math.max(0, Math.round(100 - p.tyre.wear * 100));
  $('tyreBadge').textContent = comp.s; $('tyreBadge').style.setProperty('--tc', comp.color);
  $('tyreWear').textContent = wearPct + '%'; $('tyreWear').style.color = wearPct > 40 ? '#e9edf3' : wearPct > 10 ? '#f5c400' : '#ff3b3b';
  $('tyreName').textContent = comp.name.toUpperCase();
  const d = p.dmg;
  $('dFW').style.background = dmgColor(d.fw); $('dRW').style.background = dmgColor(d.rw); $('dSus').style.background = dmgColor(d.susp);
  ['dTL', 'dTR', 'dBL', 'dBR'].forEach(id => $(id).style.background = d.punct ? '#ff2a2a' : dmgColor(Math.min(1, p.tyre.wear) * 0.6));
  const pitEl = $('pitTag');
  if (p.pit && p.pit.stage !== 'garage') { pitEl.className = 'on'; pitEl.textContent = p.pit.stage === 'stop' ? 'PIT STOP · ' + Math.max(0, p.pit.wait).toFixed(1) + 's' : 'PIT LIMITER · 80'; }
  else if (p.pitReq) { pitEl.className = 'req'; pitEl.textContent = 'BOX THIS LAP · P TO CANCEL'; }
  else pitEl.className = 'hidden';
  const rain = weather.N ? weather.rainAt(p.idx) : 0, wetL = weather.N ? weather.wetAt(p.idx) : 0;
  $('wx').textContent = rain > 0.05 ? (rain > 0.6 ? 'HEAVY RAIN' : rain > 0.3 ? 'RAIN' : 'LIGHT RAIN') + ' · TRACK ' + Math.round(wetL * 100) + '% WET' : wetL > 0.08 ? 'DRYING · ' + Math.round(wetL * 100) + '% WET' : 'DRY';
  $('wx').className = rain > 0.05 || wetL > 0.08 ? 'wet' : '';
  if (sess !== 'tt') {
    if (isRace()) $('hLap').innerHTML = 'LAP <b>' + Math.min(game.laps, Math.max(1, p.maxDone + 1)) + '</b>/' + game.laps;
    else $('hLap').innerHTML = '<b>' + sess + '</b> · ' + (p.maxDone < 0 || p.outLap ? 'OUT LAP' : p.pit || p.pitReq ? 'IN LAP' : 'FLYING LAP ' + Math.min(2, p.timedLaps + 1) + '/2');
    boardT -= dt;
    if (boardT <= 0) { boardT = 0.25; isRace() ? raceBoard() : qualiBoard(); }
  }
  updateDrsHud();
  updateProximity(p);
  const P = Tr.pit, toEntry = ((P.entry - p.idx + Tr.N) % Tr.N) * DS;
  if (world.pitGuide) world.pitGuide.visible = !!(p.pitReq && !p.pit && !p.dnf);
  const hint = $('pitHint');
  if (p.pitReq && !p.pit && !p.inPitRoad && toEntry < 500) { hint.className = 'on'; hint.textContent = (P.side > 0 ? '◀ PIT ENTRY ' : 'PIT ENTRY ▶ ') + Math.round(toEntry) + 'm'; }
  else if (p.inPitRoad && !p.pit && ((p.idx - P.entry + Tr.N) % Tr.N) < P.limIn) { hint.className = 'on'; hint.textContent = 'SLOW TO 80 KM/H FOR THE LIMITER LINE'; }
  else hint.className = 'hidden';
  drawMinimap();
}
function updateProximity(p) {
  let L = 0, R = 0, B = 0; const h = p.h, sh = Math.sin(h), ch = Math.cos(h);
  for (const o of game.cars) {
    if (o === p || !o.active || o.pit || !o.group.visible) continue;
    const dx = o.x - p.x, dz = o.z - p.z, fwd = dx * sh + dz * ch, left = dx * ch - dz * sh;
    if (fwd < -16 || fwd > 5 || Math.abs(left) > 7) continue;
    const k = 1 - Math.min(1, Math.abs(fwd) / 16);
    if (Math.abs(left) > 1.4) { if (left > 0) L = Math.max(L, k); else R = Math.max(R, k); } else if (fwd < -3) B = Math.max(B, k);
  }
  $('proxL').style.opacity = L; $('proxR').style.opacity = R; $('proxB').style.opacity = B;
}
function raceBoard() {
  const Tr = game.T, p = game.player, st = standings(), L = st[0];
  $('hPos').textContent = 'P' + (st.indexOf(p) + 1); $('hPosOf').textContent = '/' + st.length;
  let html = '';
  st.forEach((c, k) => {
    let gap;
    if (c.dnf) gap = 'OUT';
    else if (c.pit) gap = 'PIT';
    else if (k === 0) gap = c.finished ? 'FINISH' : 'LEADER';
    else if (c.finished && L.finished) gap = '+' + (c.finishTime - L.finishTime).toFixed(1);
    else if (L.prog - c.prog >= Tr.N) gap = '+' + Math.floor((L.prog - c.prog) / Tr.N) + ' LAP';
    else { const b = c.lastBucket, tl = L.splits[b], tc = c.splits[b]; gap = (tl !== undefined && tc !== undefined) ? '+' + Math.max(0, tc - tl).toFixed(1) : '—'; }
    html += '<div class="r' + (c.isPlayer ? ' me' : '') + (c.mate ? ' mate' : '') + (c.dnf ? ' out' : '') + '"><span class="p">' + (k + 1) + '</span><span class="c" style="background:' + c.color + '"></span><span class="n">' + c.code + '<i class="ty" style="--tc:' + COMP[c.tyre.comp].color + '">' + COMP[c.tyre.comp].s + '</i>' + (c.drsOpen ? '<i class="d">DRS</i>' : '') + (c.penalty ? '<i class="pen">+' + c.penalty + '</i>' : '') + '</span><span class="g">' + gap + '</span></div>';
  });
  $('board').innerHTML = html;
}
function qualiBoard() {
  const q = game.q, s = q.cur, p = game.player;
  const times = Object.assign({}, s.times, { YOU: p.sessBest });
  const ent = q.entrants.slice().sort((a, b) => (times[a.code] ?? 1e9) - (times[b.code] ?? 1e9));
  const cut = ent.length - (q.elim[s.name] || 0), best = times[ent[0].code];
  const myPos = ent.indexOf(p) + 1;
  $('hPos').textContent = 'P' + myPos; $('hPosOf').textContent = '/' + ent.length;
  let html = '';
  ent.forEach((c, k) => {
    const t = times[c.code], tStr = t && isFinite(t) ? (k === 0 ? fmt(t) : '+' + (t - best).toFixed(3)) : 'NO TIME';
    html += (k === cut ? '<div class="cut">KNOCK-OUT ZONE</div>' : '') + '<div class="r' + (c.isPlayer ? ' me' : '') + (k >= cut ? ' ko' : '') + '"><span class="p">' + (k + 1) + '</span><span class="c" style="background:' + c.color + '"></span><span class="n">' + c.code + '</span><span class="g">' + tStr + '</span></div>';
  });
  $('board').innerHTML = html;
}

/* ---------------- Results overlays ---------------- */
function showQualiResults(name, ent, elim) {
  const s = game.q.results[name], best = s[0].t, p = game.player, myPos = ent.indexOf(p) + 1, out = myPos > ent.length - elim;
  $('qTitle').textContent = (name === 'Q' ? 'Qualifying' : name) + ': P' + myPos + (out ? ', knocked out' : '');
  $('qTable').innerHTML = '<tr><th>Pos</th><th>Driver</th><th>Team</th><th>Time</th></tr>' + s.map((r, k) => '<tr class="' + (r.c.isPlayer ? 'me' : '') + (k >= ent.length - elim ? ' ko' : '') + '"><td>' + (k + 1) + '</td><td><span class="sw" style="background:' + r.c.color + '"></span>' + r.c.name + '</td><td>' + r.c.team + '</td><td>' + (isFinite(r.t) ? (k === 0 ? fmt(r.t) : '+' + (r.t - best).toFixed(3)) : 'No time') + '</td></tr>').join('');
  const last = game.q.idx >= game.q.stages.length - 1 || out;
  $('qNext').textContent = last ? 'Continue to strategy' : 'Go to ' + game.q.stages[game.q.idx + 1];
  $('hud').classList.add('hidden'); $('qres').classList.remove('hidden');
}
function showResults() {
  const Tr = game.T, champ = settings.mode === 'champ';
  // two-compound rule for dry races
  if (game.laps >= 5) for (const c of game.cars) { const st = c.stints || []; if (!c.dnf && !st.some(x => !SLICK(x)) && new Set(st).size < 2 && !c.rulePen) { c.rulePen = true; c.penalty += 30; } }
  const rows = game.cars.map(c => {
    let t = c.finishTime, est = false;
    if (!c.finished && !c.dnf) { t = game.raceTime + (game.laps * Tr.N - c.prog) * DS / Math.max(Math.abs(c.v), 30); est = true; }
    return { c, t: c.dnf ? Infinity : t + c.penalty, est };
  }).sort((a, b) => (a.t - b.t) || (b.c.prog - a.c.prog));
  let fl = Infinity; rows.forEach(r => fl = Math.min(fl, r.c.bestLap));
  const pIdx = rows.findIndex(r => r.c.isPlayer) + 1, pr = rows[pIdx - 1];
  $('resTitle').textContent = pr.c.dnf ? 'Retired' : pIdx === 1 ? 'Victory!' : 'Finished P' + pIdx;
  $('resSub').textContent = (champ ? 'Round ' + (settings.track + 1) + ' of ' + TRACKS.length + ' · ' : '') + Tr.def.name + ' · ' + game.laps + ' laps';
  let html = '<tr><th>Pos</th><th>Driver</th><th>Team</th><th>Time</th><th>Best lap</th><th>Tyres</th>' + (champ ? '<th>Pts</th>' : '') + '</tr>';
  rows.forEach((r, k) => {
    const time = r.c.dnf ? 'DNF' : k === 0 ? fmt(r.t) : '+' + (r.t - rows[0].t).toFixed(3) + (r.est ? '*' : '');
    const pts = !r.c.dnf && POINTS[k] ? POINTS[k] : 0;
    html += '<tr class="' + (r.c.isPlayer ? 'me' : '') + '"><td>' + (r.c.dnf ? '-' : k + 1) + '</td><td><span class="sw" style="background:' + r.c.color + '"></span>' + r.c.name + '</td><td>' + r.c.team + '</td><td>' + time + (r.c.penalty ? ' <span class="pen">(+' + r.c.penalty + 's)</span>' : '') + '</td><td class="' + (r.c.bestLap === fl ? 'fl' : '') + '">' + fmt(r.c.bestLap) + '</td><td>' + (r.c.stints || []).map(s => '<i class="tb sm" style="--tc:' + COMP[s].color + '">' + COMP[s].s + '</i>').join('') + '</td>' + (champ ? '<td><b>' + (pts ? '+' + pts : '') + '</b></td>' : '') + '</tr>';
    r.pts = pts;
  });
  $('resTable').innerHTML = html;
  $('champBox').classList.add('hidden');
  $('rAgain').textContent = 'Race again';
  if (champ) {
    const s = game.season;
    rows.forEach(r => { s.pts[r.c.code] = (s.pts[r.c.code] || 0) + r.pts; });
    s.round++; s.finished = s.round >= TRACKS.length; saveSeason(s);
    const names = { YOU: ['You', LIVERIES[settings.livery]] };
    s.lineup.forEach((l, k) => { names[DRIVERS[l.di][1]] = [DRIVERS[l.di][0], k === 0 ? LIVERIES[settings.livery] : TEAMS[teamIdxOf(l.di)].color]; });
    const tab = Object.entries(s.pts).sort((a, b) => b[1] - a[1]);
    const myPos = tab.findIndex(e => e[0] === 'YOU') + 1;
    $('champTitle').textContent = s.finished ? (myPos === 1 ? 'You are World Champion!' : 'Season complete: P' + myPos) : 'Championship after round ' + s.round;
    $('champTable').innerHTML = tab.slice(0, 10).map((e, k) => '<tr class="' + (e[0] === 'YOU' ? 'me' : '') + '"><td>' + (k + 1) + '</td><td><span class="sw" style="background:' + names[e[0]][1] + '"></span>' + names[e[0]][0] + '</td><td><b>' + e[1] + '</b></td></tr>').join('') + (myPos > 10 ? '<tr class="me"><td>' + myPos + '</td><td>You</td><td><b>' + s.pts.YOU + '</b></td></tr>' : '');
    $('champBox').classList.remove('hidden');
    $('rAgain').textContent = s.finished ? 'New season' : 'Next round: ' + TRACKS[s.round].name;
  }
  $('results').classList.remove('hidden');
}

/* ---------------- Menu ---------------- */
function refreshMenu() {
  document.querySelectorAll('.seg').forEach(seg => { const k = seg.dataset.opt; seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', String(settings[k]) === b.dataset.v)); });
  const mode = settings.mode, s = loadSeason();
  ['optLaps', 'optOpp', 'optDiff'].forEach(id => $(id).style.opacity = mode === 'tt' || (mode === 'champ' && s && !s.finished) ? 0.35 : 1);
  $('optQuali').style.opacity = mode === 'tt' ? 0.35 : 1; $('optWx').style.opacity = mode === 'tt' ? 0.35 : 1;
  $('seasonBox').classList.toggle('hidden', mode !== 'champ');
  if (mode === 'champ') {
    if (s && !s.finished) { settings.track = s.round; $('seasonInfo').innerHTML = 'Round <b>' + (s.round + 1) + '</b> of ' + TRACKS.length + ' · You have <b>' + (s.pts.YOU || 0) + '</b> pts<br><small>' + s.laps + ' laps · AI ' + (s.ai ?? 50) + '/100 · ' + s.opp + ' rivals · your teammate: ' + DRIVERS[s.lineup[0].di][0] + '</small>'; $('newSeason').classList.remove('hidden'); }
    else { settings.track = 0; $('seasonInfo').innerHTML = 'A 24-round season. 25-18-15-12-10-8-6-4-2-1 points.<br><small>Uses the laps, rivals and AI skill above. You get a teammate.</small>'; $('newSeason').classList.add('hidden'); }
  }
  $('startBtn').textContent = mode === 'tt' ? 'Start Time Trial' : mode === 'champ' ? (s && !s.finished ? 'Start Round ' + (s.round + 1) : 'Start Season') : 'Start Weekend';
  document.querySelectorAll('#swatches button').forEach((b, k) => b.classList.toggle('on', k === settings.livery));
  $('aiSlider').value = settings.ai; $('aiVal').textContent = settings.ai; $('aiDesc').textContent = aiLabel(settings.ai);
  document.querySelectorAll('.tcard').forEach((c, k) => { c.classList.toggle('on', k === settings.track); c.classList.toggle('locked', mode === 'champ'); });
  const d = TRACKS[settings.track];
  $('tiName').textContent = d.name; $('tiBlurb').textContent = d.loc + ' · ' + (d.type === 'street' ? 'Street circuit · ' : 'Permanent circuit · ') + d.blurb;
  const on = document.querySelector('.tcard.on'); if (on) on.scrollIntoView({ block: 'nearest' });
}
function aiLabel(s) { return s < 20 ? 'Rookie' : s < 40 ? 'Amateur' : s < 60 ? 'Club racer' : s < 75 ? 'Pro' : s < 90 ? 'Elite: brakes late' : 'Legend: right on the limit'; }
function showLoading(on) { $('loading').classList.toggle('hidden', !on); }
function withLoading(fn) { showLoading(true); setTimeout(() => { try { fn(); } finally { showLoading(false); } }, 30); }
function selectTrack(i) { if (settings.mode === 'champ') return; settings.track = i; saveSettings(); refreshMenu(); withLoading(() => buildTrack(i)); }
function cardStats(i) {
  const d = TRACKS[i], pv = previewPoints(d, 60), rec = parseFloat(store.get('apexgp2-best-' + d.id));
  return '<b>' + (pv.length / 1000).toFixed(2) + ' km</b> · ' + (d.type === 'street' ? 'Street' : 'Circuit') + (isFinite(rec) ? ' · <b>' + fmt(rec) + '</b>' : '');
}
function initMenu() {
  document.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const k = seg.dataset.opt, v = b.dataset.v;
    settings[k] = (k === 'laps' || k === 'opp') ? parseInt(v, 10) : v; saveSettings();
    if (k === 'line') world.setRaceLine(v === 'on');
    const prev = settings.track; refreshMenu();
    if (k === 'mode' && settings.track !== prev) withLoading(() => buildTrack(settings.track));
  }));
  $('aiSlider').addEventListener('input', e => { settings.ai = parseInt(e.target.value, 10); saveSettings(); $('aiVal').textContent = settings.ai; $('aiDesc').textContent = aiLabel(settings.ai); });
  $('acceptBtn').onclick = () => { $('splash').classList.add('hidden'); audio.init(); audio.set(0, 0, false); };
  LIVERIES.forEach((c, k) => { const b = document.createElement('button'); b.style.background = c; b.title = 'Livery ' + (k + 1); b.onclick = () => { settings.livery = k; saveSettings(); refreshMenu(); }; $('swatches').appendChild(b); });
  TRACKS.forEach((d, i) => {
    const el = document.createElement('div'); el.className = 'tcard panel';
    const cv = document.createElement('canvas'); cv.width = 160; cv.height = 120;
    const pv = previewPoints(d, 200), g = cv.getContext('2d'); g.translate(20, 0);
    const { path, map } = trackPath(pv.pts.length, k => pv.pts[k][0], k => pv.pts[k][1], 120, 10);
    const s = d.scale || 1, a = d.pts[0], b = d.pts[1];
    drawShape(g, path, map, [(a[0] + (b[0] - a[0]) * 0.6) * s, (a[1] + (b[1] - a[1]) * 0.6) * s], 3);
    el.innerHTML = '<div class="rnd">' + String(i + 1).padStart(2, '0') + '</div><div class="pv"></div><div><div class="nm">' + d.name + '</div><div class="lc">' + d.loc + '</div><div class="st">' + cardStats(i) + '</div></div>';
    el.querySelector('.pv').appendChild(cv);
    el.onclick = () => selectTrack(i);
    $('trackList').appendChild(el);
  });
  $('startBtn').onclick = () => withLoading(startWeekend);
  $('newSeason').onclick = () => { store.del('apexgp2-season'); refreshMenu(); withLoading(() => buildTrack(settings.track)); };
  for (let k = 0; k < 5; k++) { const pod = document.createElement('div'); pod.className = 'pod'; pod.innerHTML = '<i></i><i></i>'; $('startLights').appendChild(pod); }
  for (let k = 0; k < 10; k++) $('shift').appendChild(document.createElement('i'));
  $('pResume').onclick = () => togglePause(false);
  $('pRestart').onclick = () => { if (settings.mode === 'champ') return; withLoading(startWeekend); };
  $('pEnd').onclick = () => { togglePause(false); if (!isRace() && game.session !== 'tt') { game.player.lapInvalid = false; endQualiSession(); } };
  $('pQuit').onclick = toMenu; $('rMenu').onclick = toMenu;
  $('rAgain').onclick = () => { if (settings.mode === 'champ') { const s = loadSeason(); if (s && s.finished) store.del('apexgp2-season'); } withLoading(startWeekend); };
  $('qNext').onclick = () => { $('qres').classList.add('hidden'); $('hud').classList.remove('hidden'); withLoading(nextQualiStep); };
  $('stratGo').onclick = () => withLoading(startRace);
  $('leaveGarage').onclick = leaveGarage;
  refreshMenu();
  withLoading(() => buildTrack(settings.track));
}
function toMenu() {
  clearSC(); game.flag = null; $('flag').className = 'hidden';
  game.state = 'menu'; game.paused = false; game.phase = 'idle'; game.session = null; audio.set(0, 0, false); clearCars(); smoke.clear(); sparks.clear(); skids.clear();
  weather.N = 0; weather.lines.visible = false; world.setWeather(0, 0);
  ['hud', 'pause', 'results', 'qres', 'strategy', 'garageBar'].forEach(id => $(id).classList.add('hidden')); $('menu').classList.remove('hidden');
  document.querySelectorAll('.tcard .st').forEach((el, i) => el.innerHTML = cardStats(i));
  refreshMenu(); withLoading(() => buildTrack(settings.track));
}
function togglePause(force) {
  if (game.state !== 'race' || !$('results').classList.contains('hidden') || !$('qres').classList.contains('hidden') || !$('strategy').classList.contains('hidden')) return;
  game.paused = typeof force === 'boolean' ? force : !game.paused;
  $('pause').classList.toggle('hidden', !game.paused);
  $('pRestart').classList.toggle('hidden', settings.mode === 'champ');
  $('pEnd').classList.toggle('hidden', isRace() || game.session === 'tt');
  if (game.paused) audio.set(0, 0, false);
}

/* ---------------- Input ---------------- */
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'a' || k === 's' || k === 'd') { keys[k] = true; e.preventDefault(); }
  if (e.repeat) return;
  if (k === 'c' && game.state === 'race' && !game.paused) setCam((game.camMode + 1) % 3);
  if (k === 'escape') togglePause();
  if (k === 'l' && game.state === 'race') { settings.line = settings.line === 'on' ? 'off' : 'on'; saveSettings(); world.setRaceLine(settings.line === 'on'); flashMsg('RACING LINE ' + settings.line.toUpperCase(), 0.9); }
  if (k === 'p' && (racing() || game.phase === 'run') && game.player && !game.player.pit) { const p = game.player; p.pitReq = !p.pitReq; radio(p.pitReq ? 'Copy, box this lap.' : 'Copy, staying out.', 'info', 3); }
  if (k === 'm') { audio.muted = !audio.muted; store.set('apexgp-muted', audio.muted ? '1' : '0'); if (game.state === 'race') flashMsg(audio.muted ? 'SOUND OFF' : 'SOUND ON', 0.9); }
});
addEventListener('keyup', e => { const k = e.key.toLowerCase(); if (k in keys) keys[k] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (game.state === 'race' && (game.phase === 'race' || game.phase === 'run')) togglePause(true); });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

/* ---------------- Main loop ---------------- */
let last = performance.now(), clock = 0;
const focus = new THREE.Vector3();
function renderWeather(dt) {
  const p = game.player;
  if (game.state === 'race' && p && weather.N) {
    const rain = weather.rainAt(p.idx), wet = weather.wetAt(p.idx);
    world.setWeather(Math.max(rain, weather.global(game.raceTime) * 0.6), wet);
    weather.render(dt, camera, rain);
  } else { weather.render(dt, camera, 0); }
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
  if (game.state === 'race' && game.player) {
    if (!game.paused) {
      update(dt); updateCarVisuals(dt);
      audio.set(game.player.rpm, game.phase === 'lights' ? (keys.w ? 1 : 0) : game.player.inp.throttle, game.phase !== 'idle');
    }
    if (!window.__camLock) updateCamera(dt, clock);
    updateHUD(dt);
    focus.set(game.player.x, game.player.group.position.y, game.player.z);
  } else {
    if (!window.__camLock) updateMenuCamera(dt);
    focus.copy(camera.position).setY(0);
  }
  renderWeather(dt);
  world.update(dt, focus, camera);
  renderer.render(scene, camera);
  updateSound(dt);
}
function updateSound(dt) {
  const p = game.player;
  if (!(game.state === 'race' && p && !game.paused && game.phase !== 'idle' && game.phase !== 'red')) { sound.update(dt, { on: false }); return; }
  let rival = null, bd = 60;
  for (const o of game.cars) { if (o === p || !o.active || !o.group.visible) continue; const d = Math.hypot(o.x - p.x, o.z - p.z); if (d < bd) { bd = d; rival = { rpm: o.rpm, thr: o.inp.throttle, gain: (1 - d / 60) ** 2 * 0.8 }; } }
  const lock = p.inp.brake > 0.8 && Math.abs(p.v) > 25 && Math.abs(p.steer) > 0.5;
  sound.update(dt, { on: true, rpm: p.rpm, throttle: game.phase === 'lights' ? (keys.w ? 1 : 0) : p.inp.throttle, gear: p.gear, speed: Math.abs(p.v), kerb: p.surf === 1, slide: Math.max(Math.abs(p.slip) * 2.5, lock ? 0.6 : 0, p.scrub > 0.9 ? 0.4 : 0) * (weather.N && weather.wetAt(p.idx) > 0.3 ? 0.2 : 1), rain: weather.N ? weather.rainAt(p.idx) : 0, impact: p.impact || 0, rival });
  p.impact = 0;
}
await loadCarModel('js/car.bin?v=95106973');
initMenu();
requestAnimationFrame(frame);

// debugging hooks for automated checks
window.__apex = {
  deployFlag, game, settings, update, updateCarVisuals, updateCamera, updateHUD, setCam, startWeekend, startRace, startSession, leaveGarage, nextQualiStep, endQualiSession, showStrategy,
  buildTrack, getTrack, world, weather, renderer, scene, camera, standings, positionOf, keys, estimateLap, aiPace,
  frameOnce: () => { renderWeather(0.016); world.update(0.016, focus.set(game.player ? game.player.x : 0, game.player ? game.player.group.position.y : 0, game.player ? game.player.z : 0), camera); renderer.render(scene, camera); },
};

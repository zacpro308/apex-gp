import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { W, KERB, DS, TRACKS, getTrack, previewPoints, locate } from './tracks.js';
import { World } from './world.js';
import { makeCar, disposeCar } from './car.js';
import { Particles, Skids } from './fx.js';
import { clamp, angDiff, rng, fmt, store, setMaxAniso } from './util.js';

const $ = id => document.getElementById(id);
const VMAX = 100;

/* ---------------- Teams & drivers (fictional) ---------------- */
const TEAMS = [
  { name: 'Halcyon Racing', color: '#14b8a6', accent: '#0f172a' },
  { name: 'Ironclad GP', color: '#f97316', accent: '#1f2937' },
  { name: 'Solaris Motorsport', color: '#a3e635', accent: '#111827' },
  { name: 'Corvid Racing', color: '#7c3aed', accent: '#e5e7eb' },
  { name: 'Brightwater', color: '#38bdf8', accent: '#0b1324' },
  { name: 'Vermilion Works', color: '#dc2626', accent: '#fde68a' },
  { name: 'Pinnacle Engineering', color: '#22c55e', accent: '#f8fafc' },
  { name: 'Atlas Velocity', color: '#ec4899', accent: '#1e1b4b' },
];
const DRIVERS = [
  ['Marco Ferrante', 'FER'], ['Lena Hoffmann', 'HOF'], ['Kai Tanaka', 'TAN'], ['Rafael Duarte', 'DUA'],
  ['Sofia Lindqvist', 'LIN'], ['Theo Marchetti', 'MAR'], ['Amara Okafor', 'OKA'], ['Jonas Brandt', 'BRA'],
  ['Elise Moreau', 'MOR'], ['Diego Salvador', 'SAL'], ['Niko Virtanen', 'VIR'], ['Priya Raman', 'RAM'],
  ['Oscar Whitfield', 'WHI'], ['Yuki Mori', 'MRI'], ['Felix Arnaud', 'ARN'], ['Mateo Rojas', 'ROJ'],
];
const LIVERIES = ['#ffcc00', '#f8fafc', '#ef4444', '#3b82f6', '#10b981', '#a855f7', '#111827'];
const POINTS = [20, 16, 13, 11, 9, 7, 5, 3, 2, 1];
const DIFF = { easy: 0.86, medium: 0.925, hard: 0.975 };
const GEARS = [0, 22, 33, 44, 54, 64, 74, 84, 200];
const CAMS = ['COCKPIT', 'T-CAM', 'CHASE'];

/* ---------------- Renderer ---------------- */
const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
setMaxAniso(Math.min(16, renderer.capabilities.getMaxAnisotropy()));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.08, 20000);
const world = new World(renderer, scene);
const smoke = new Particles(scene, 900, false);
const sparks = new Particles(scene, 500, true);
const skids = new Skids(scene);
let composer = null, bloom = null;

const settings = Object.assign({ track: 0, mode: 'race', laps: 3, opp: 9, diff: 'medium', livery: 0, gfx: 1 }, store.json('apexgp2-settings', {}));
if (settings.track >= TRACKS.length) settings.track = 0;
const saveSettings = () => store.set('apexgp2-settings', JSON.stringify(settings));

function setupPost() {
  const q = settings.gfx;
  renderer.setPixelRatio(q === 0 ? 1 : q === 1 ? Math.min(devicePixelRatio || 1, 1.5) : Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = q > 0;
  if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); composer = null; }
  if (q > 0) {
    const pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(innerWidth * pr, innerHeight * pr, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.3, 0.5, 0.85);
    composer.addPass(bloom); composer.addPass(new OutputPass());
  }
  applyBloom();
}
function applyBloom() {
  if (!bloom) return;
  // day skies are very bright in HDR, so only let truly hot pixels (sun glints, lamps, sparks) bloom
  bloom.strength = world.night ? (world.bloomStrength || 0.8) : Math.min(0.25, world.bloomStrength || 0.2);
  bloom.threshold = world.night ? 0.6 : 6;
  bloom.radius = world.night ? 0.6 : 0.3;
}
setupPost();
let builtFor = null;
function buildTrack(i, force) {
  const key = i + ':' + settings.gfx;
  if (builtFor === key && !force) return getTrack(i);
  const T = getTrack(i);
  world.build(T, settings.gfx, TEAMS.map(t => t.color));
  applyBloom(); builtFor = key;
  smoke.clear(); sparks.clear(); skids.clear();
  return T;
}

/* ---------------- Audio ---------------- */
const audio = {
  ctx: null, muted: store.get('apexgp-muted') === '1',
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext, ctx = this.ctx = new AC();
      this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth'; this.o2 = ctx.createOscillator(); this.o2.type = 'square';
      this.f = ctx.createBiquadFilter(); this.f.type = 'lowpass'; this.f.frequency.value = 900; this.f.Q.value = 3;
      this.g = ctx.createGain(); this.g.gain.value = 0; const g2 = ctx.createGain(); g2.gain.value = 0.35;
      this.o1.connect(this.f); this.o2.connect(g2); g2.connect(this.f); this.f.connect(this.g); this.g.connect(ctx.destination);
      this.o1.start(); this.o2.start();
    } catch (e) { this.ctx = null; }
  },
  set(rpm, thr, on) {
    if (!this.ctx) return; const t = this.ctx.currentTime, f = 28 + rpm / 12500 * 240;
    this.o1.frequency.setTargetAtTime(f, t, 0.03); this.o2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    this.f.frequency.setTargetAtTime(450 + thr * 1900, t, 0.05);
    this.g.gain.setTargetAtTime(on && !this.muted ? 0.035 + 0.06 * thr : 0, t, 0.05);
  },
};

/* ---------------- Championship ---------------- */
function loadSeason() { return store.json('apexgp2-season', null); }
function saveSeason(s) { store.set('apexgp2-season', JSON.stringify(s)); }
function newSeason() {
  const r = rng(Date.now() & 0xfffff);
  const order = DRIVERS.map((d, i) => i).sort(() => r() - 0.5).slice(0, settings.opp);
  const s = { round: 0, laps: settings.laps, diff: settings.diff, opp: settings.opp, lineup: order.map(di => ({ di, rating: 0.96 + r() * 0.035 })), pts: {}, finished: false };
  s.pts.YOU = 0; order.forEach(di => s.pts[DRIVERS[di][1]] = 0);
  saveSeason(s); return s;
}

/* ---------------- Game state ---------------- */
const game = { state: 'menu', T: null, cars: [], player: null, phase: 'lights', lightsT: 0, goAt: 0, raceTime: 0, camMode: 2, paused: false, finishCount: 0, orbit: 0, resultsAt: 0, season: null, laps: 3 };
const cm = parseInt(store.get('apexgp-cam'), 10); if (cm >= 0 && cm < 3) game.camMode = cm;
const keys = {};
const bestKey = T => 'apexgp2-best-' + T.def.id;
const recordFor = T => { const v = parseFloat(store.get(bestKey(T))); return isFinite(v) ? v : 0; };

function clearCars() { for (const c of game.cars) { scene.remove(c.group); disposeCar(c); } game.cars = []; game.player = null; }

function setupRace() {
  const champ = settings.mode === 'champ';
  if (champ) { game.season = loadSeason() || newSeason(); settings.track = game.season.round; }
  const T = game.T = buildTrack(settings.track);
  clearCars();
  const tt = settings.mode === 'tt';
  const laps = champ ? game.season.laps : settings.laps, diff = champ ? game.season.diff : settings.diff;
  game.laps = tt ? Infinity : laps;
  const r = rng((Date.now() & 0xffff) + 1);
  let lineup;
  if (champ) lineup = game.season.lineup.slice();
  else if (tt) lineup = [];
  else lineup = DRIVERS.map((d, i) => i).sort(() => r() - 0.5).slice(0, settings.opp).map(di => ({ di, rating: 0.96 + r() * 0.035 }));
  lineup.sort(() => r() - 0.5);
  const n = lineup.length + 1, playerSlot = tt ? 0 : Math.floor(n * 0.55), base = DIFF[diff];
  let ai = 0;
  for (let s = 0; s < n; s++) {
    const isP = s === playerSlot; let c;
    if (isP) {
      const colr = LIVERIES[settings.livery];
      c = Object.assign(makeCar({ color: colr, accent: colr === '#111827' ? '#ffcc00' : '#111827', helmet: '#ffffff', number: 1, compound: 'soft' }), { name: 'You', code: 'YOU', team: 'Your Team', color: colr, isPlayer: true, pace: 1 });
    } else {
      const L = lineup[ai++], di = L.di, tm = TEAMS[Math.floor(di / 2) % TEAMS.length];
      c = Object.assign(makeCar({ color: tm.color, accent: tm.accent, helmet: ['#ffffff', '#ffcc00', '#ff4d4d', '#4da6ff'][di % 4], number: [4, 7, 11, 14, 16, 22, 27, 31, 33, 44, 55, 63, 77, 81, 88, 99][di], compound: ['soft', 'medium', 'hard'][di % 3] }),
        { name: DRIVERS[di][0], code: DRIVERS[di][1], team: tm.name, color: tm.color, isPlayer: false, pace: base * L.rating * (1 - (s / n) * 0.02) });
    }
    const back = 8 + s * 8, idx = (T.N - Math.round(back / DS)) % T.N, lane = (s % 2 === 0 ? 1 : -1) * 3.2;
    Object.assign(c, {
      x: T.px[idx] + T.nx[idx] * lane, z: T.pz[idx] + T.nz[idx] * lane, h: Math.atan2(T.tx[idx], T.tz[idx]), v: 0, steer: 0,
      idx, prog: idx - T.N, lat: lane, surf: 0, maxDone: -1, lapStart: 0, lastLap: 0, bestLap: Infinity, lapInvalid: false, lapTimes: [],
      finished: false, finishTime: 0, splits: {}, lastBucket: -1e9, laneOff: lane - T.race[idx], laneTarget: (r() - 0.5) * 1.2, blockT: 0,
      startDelay: isP ? 0 : 0.12 + r() * 0.35, autopilot: false, inp: { throttle: 0, brake: 0, steer: 0 }, gear: 0, rpm: 4000, wheelRot: 0, hitT: 0, scrub: 0, sparkT: r(),
    });
    c.group.position.set(c.x, 0, c.z); c.group.rotation.y = c.h;
    scene.add(c.group); game.cars.push(c);
    if (isP) game.player = c;
  }
  game.player.steering.visible = true;
  game.phase = 'lights'; game.lightsT = 0; game.goAt = 5.6 + r() * 1.4; game.raceTime = 0; game.finishCount = 0; game.paused = false; game.resultsAt = 0;
  game.state = 'race'; game.record = recordFor(T);
  world.setStartLights(0);
  buildMinimap(T);
  $('menu').classList.add('hidden'); $('results').classList.add('hidden'); $('pause').classList.add('hidden'); $('hud').classList.remove('hidden');
  $('board').classList.toggle('hidden', tt); $('tl').classList.toggle('hidden', tt);
  $('startLights').classList.remove('hidden');
  $('trackTag').textContent = (champ ? 'ROUND ' + (settings.track + 1) + ' · ' : '') + T.def.name.toUpperCase();
  setCam(game.camMode, true);
  audio.init();
}

/* ---------------- Physics ---------------- */
function surfaceOf(c, T) {
  const a = Math.abs(c.lat);
  if (a <= W + 0.3) return 0;           // road
  if (a <= W + KERB) return 1;          // kerb
  if (T.street) return 2;               // asphalt run-off
  const s = c.lat > 0 ? 1 : -1;
  if (a <= W + KERB + 2.4) return 2;    // painted apron
  if (T.gravel[c.idx] === s) return 3;  // gravel
  return 4;                             // grass
}
const GRIP = [1, 0.93, 0.88, 0.45, 0.6];
const DRAG = [0, 0, 0, 0.95, 0.4];
function stepCar(c, inp, dt, T) {
  const surf = c.surf = surfaceOf(c, T), grip = GRIP[surf];
  let v = c.v;
  if (inp.throttle > 0) {
    if (v < -0.2) v += 28 * dt * inp.throttle;
    else { const f = 1 - Math.pow(Math.max(v, 0) / VMAX, 2); v += 11.5 * inp.throttle * Math.max(f, 0) * (surf >= 3 ? 0.55 : 1) * dt; }
  }
  if (inp.brake > 0) {
    if (v > 0.4) v = Math.max(0, v - 36 * grip * inp.brake * dt);
    else if (inp.throttle === 0) v = Math.max(v - 7 * dt, -12);
  }
  const dec = (0.3 + 0.00028 * v * v + (inp.throttle === 0 ? 1.2 : 0) + DRAG[surf] * Math.abs(v)) * dt;
  if (v > 0) v = Math.max(0, v - dec); else if (v < 0) v = Math.min(0, v + dec);
  const sp = Math.abs(v), geo = sp * Math.tan(0.42) / 3.6, dyn = (18 + 0.25 * sp) * grip / Math.max(sp, 1);
  c.h += inp.steer * Math.min(geo, dyn) * (v < 0 ? -1 : 1) * dt;
  c.scrub = (geo > dyn && Math.abs(inp.steer) > 0.6 && sp > 15) ? Math.abs(inp.steer) : 0;
  if (c.scrub) v -= Math.sign(v) * c.scrub * 2.2 * dt;
  c.x += Math.sin(c.h) * v * dt; c.z += Math.cos(c.h) * v * dt; c.v = v;
  const ni = locate(T, c.x, c.z, c.idx);
  let d = ni - c.idx; if (d > T.N / 2) d -= T.N; else if (d < -T.N / 2) d += T.N;
  c.idx = ni; c.prog += d;
  c.lat = (c.x - T.px[ni]) * T.nx[ni] + (c.z - T.pz[ni]) * T.nz[ni];
  const s = c.lat >= 0 ? 1 : -1, lim = (s > 0 ? T.limL[ni] : T.limR[ni]) - 1.05;
  if (Math.abs(c.lat) > lim) {
    const push = Math.abs(c.lat) - lim;
    c.x -= T.nx[ni] * s * push; c.z -= T.nz[ni] * s * push; c.lat -= s * push;
    const fx = Math.sin(c.h), fz = Math.cos(c.h), into = (fx * T.nx[ni] + fz * T.nz[ni]) * s * Math.sign(c.v || 1);
    if (into > 0) {
      const impact = Math.abs(c.v) * into;
      c.v *= Math.max(0.25, 1 - into * 1.3);
      const th = Math.atan2(T.tx[ni], T.tz[ni]), tgt = (fx * T.tx[ni] + fz * T.tz[ni]) >= 0 ? th : th + Math.PI;
      c.h += angDiff(tgt, c.h) * 0.5;
      if (impact > 4) c.hitT = Math.min(1, impact / 30), c.hitSide = s;
    }
  }
}

function playerInput(c, dt) {
  const tgt = (keys.a ? 1 : 0) - (keys.d ? 1 : 0);
  const rate = tgt === 0 ? 7 : (c.steer !== 0 && Math.sign(tgt) !== Math.sign(c.steer) ? 9 : 4.2);
  c.steer += clamp(tgt - c.steer, -rate * dt, rate * dt);
  return { throttle: keys.w ? 1 : 0, brake: keys.s ? 1 : 0, steer: c.steer };
}

function aiInput(c, dt, T) {
  const N = T.N;
  c.blockT -= dt;
  if (c.blockT <= 0) c.laneTarget *= Math.pow(0.5, dt);
  let follow = Infinity;
  for (const o of game.cars) {
    if (o === c) continue;
    const dp = o.prog - c.prog;
    if (Math.abs(dp) <= 3 && Math.abs(o.lat - c.lat) < 3.6) {
      const want = clamp(o.lat + (c.lat >= o.lat ? 3.8 : -3.8), -(W - 1.2), W - 1.2);
      if (Math.abs(want - o.lat) >= 3) { c.laneTarget = want - T.race[c.idx]; c.blockT = Math.max(c.blockT, 0.8); }
    }
    if (dp > 0 && dp < 16 && Math.abs(o.lat - c.lat) < 2.6) {
      if (c.v > o.v - 0.5) {
        const leftRoom = W - 1.4 - o.lat, rightRoom = o.lat + W - 1.4;
        c.laneTarget = clamp((leftRoom > rightRoom ? o.lat + 3.0 : o.lat - 3.0) - T.race[c.idx], -2 * W, 2 * W); c.blockT = 1.6;
      }
      if (dp < 5) follow = Math.min(follow, o.v - 0.5);
    }
  }
  c.laneOff += (c.laneTarget - c.laneOff) * Math.min(1, dt * 1.6);
  const ti = (c.idx + Math.round((10 + Math.max(c.v, 10) * 0.42) / DS)) % N;
  const off = clamp(T.race[ti] + c.laneOff, -(W - 1.2), W - 1.2);
  const err = angDiff(Math.atan2(T.px[ti] + T.nx[ti] * off - c.x, T.pz[ti] + T.nz[ti] * off - c.z), c.h);
  c.steer += clamp(clamp(err * 2.6, -1, 1) - c.steer, -8 * dt, 8 * dt);
  let target = Infinity;
  for (let k = 1; k <= 6; k++) target = Math.min(target, T.vprof[(c.idx + k) % N]);
  target = Math.min(target * c.pace, follow);
  if (c.surf >= 3) target = Math.min(target, 35);
  let throttle = 0, brake = 0;
  if (c.v < target - 0.8) throttle = 1; else if (c.v > target + 1.2) brake = clamp((c.v - target) / 5, 0.25, 1); else throttle = 0.35;
  return { throttle, brake, steer: c.steer };
}

function collide() {
  const cars = game.cars;
  for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
    const A = cars[a], B = cars[b], dx0 = B.x - A.x, dz0 = B.z - A.z;
    if (dx0 * dx0 + dz0 * dz0 > 64) continue;
    const fa = [Math.sin(A.h), Math.cos(A.h)], fb = [Math.sin(B.h), Math.cos(B.h)];
    let best = null;
    for (const oa of [1.35, -1.35]) for (const ob of [1.35, -1.35]) {
      const ax = A.x + fa[0] * oa, az = A.z + fa[1] * oa, bx = B.x + fb[0] * ob, bz = B.z + fb[1] * ob, d = Math.hypot(bx - ax, bz - az);
      if (d < 2.15 && d > 1e-4 && (!best || d < best.d)) best = { d, dx: (bx - ax) / d, dz: (bz - az) / d };
    }
    if (!best) continue;
    const { d, dx, dz } = best, push = (2.15 - d) / 2;
    A.x -= dx * push; A.z -= dz * push; B.x += dx * push; B.z += dz * push;
    const aInto = fa[0] * dx + fa[1] * dz, bInto = -(fb[0] * dx + fb[1] * dz);
    if (aInto > 0.5 && A.v > B.v) { const dv = A.v - B.v; A.v -= dv * 0.6; B.v += dv * 0.3; if (dv > 6) A.hitT = B.hitT = Math.min(1, dv / 25); }
    else if (bInto > 0.5 && B.v > A.v) { const dv = B.v - A.v; B.v -= dv * 0.6; A.v += dv * 0.3; if (dv > 6) A.hitT = B.hitT = Math.min(1, dv / 25); }
    else { const side = (x, z, h) => Math.cos(h) * x - Math.sin(h) * z; A.h += clamp(side(-dx, -dz, A.h), -1, 1) * 0.002; B.h += clamp(side(dx, dz, B.h), -1, 1) * 0.002; }
  }
}

function checkLaps(c, T) {
  const done = Math.floor(c.prog / T.N), bucket = Math.floor(c.prog / 25);
  if (bucket > c.lastBucket) { c.splits[bucket] = game.raceTime; c.lastBucket = bucket; }
  if (c.isPlayer && Math.abs(c.lat) > W + KERB + 0.9) c.lapInvalid = true;
  if (done > c.maxDone) {
    if (done >= 1) {
      const lt = game.raceTime - c.lapStart, valid = !(c.isPlayer && c.lapInvalid);
      c.lastLap = lt; c.lapTimes.push(lt);
      if (valid && lt < c.bestLap) c.bestLap = lt;
      c.lapStart = game.raceTime;
      if (c.isPlayer) {
        if (valid && (!game.record || lt < game.record)) { game.record = lt; store.set(bestKey(T), String(lt)); flashMsg('NEW RECORD', 2.5, fmt(lt)); }
        else if (!valid) flashMsg('LAP INVALID', 2, fmt(lt) + ' · track limits');
        else if (done === game.laps - 1) flashMsg('FINAL LAP', 2, fmt(lt));
        else flashMsg('LAP ' + (done + 1), 1.8, fmt(lt));
        c.lapInvalid = false;
      }
    }
    c.maxDone = done;
    if (done >= game.laps && !c.finished) {
      c.finished = true; c.finishTime = game.raceTime; c.finishOrder = ++game.finishCount;
      if (c.isPlayer) onPlayerFinish();
    }
  }
}
function onPlayerFinish() {
  const p = game.player;
  game.phase = 'finished'; p.autopilot = true; p.pace = 0.8;
  flashMsg(p.finishOrder === 1 ? 'YOU WIN!' : 'FINISHED P' + positionOf(p), 3, fmt(p.finishTime));
  game.resultsAt = game.raceTime + 3.2;
}
function standings() {
  return game.cars.slice().sort((a, b) => {
    if (a.finished && b.finished) return a.finishOrder - b.finishOrder;
    if (a.finished) return -1; if (b.finished) return 1;
    return b.prog - a.prog;
  });
}
const positionOf = c => standings().indexOf(c) + 1;

/* ---------------- Effects ---------------- */
const tmpC = new THREE.Color();
const SMOKE = new THREE.Color('#e9e9ea'), DUST = new THREE.Color('#c9b48a'), GRASS = new THREE.Color('#6b7a3a'), SPARK = new THREE.Color(3, 1.6, 0.5);
function carEffects(c, dt) {
  const camD = Math.hypot(c.x - camera.position.x, c.z - camera.position.z);
  if (camD > 220) { for (let k = 0; k < 2; k++) skids.lift(c.code + k); return; }
  const fx = Math.sin(c.h), fz = Math.cos(c.h), lx = Math.cos(c.h), lz = -Math.sin(c.h), sp = Math.abs(c.v);
  const wheel = (side, z) => [c.x + lx * side * 0.83 + fx * z, c.z + lz * side * 0.83 + fz * z];
  // lock-ups only for the player (hard braking while turning) or anyone heavily understeering
  const lock = c.isPlayer && !c.autopilot && c.inp.brake > 0.8 && sp > 25 && Math.abs(c.steer) > 0.5;
  const sliding = lock || c.scrub > 0.9;
  // tyre smoke + skid marks
  [[1, 1.66], [-1, 1.66]].forEach(([s, z], k) => {
    const [x, wz] = wheel(s, z);
    if (sliding && c.surf <= 2) {
      skids.mark(c.code + k, x, wz, fx, fz, 0.55);
      if (Math.random() < dt * 40) smoke.spawn(x, 0.3, wz, -fx * sp * 0.15 + (Math.random() - 0.5), 0.6 + Math.random(), -fz * sp * 0.15 + (Math.random() - 0.5), 1.4 + Math.random(), 0.8, 4.5, 0.32, SMOKE, 1.2);
    } else skids.lift(c.code + k);
  });
  // dust/grass when off track
  if (c.surf >= 3 && sp > 6) {
    for (const s of [1, -1]) {
      const [x, wz] = wheel(s, -1.55);
      if (Math.random() < dt * 30) { tmpC.copy(c.surf === 3 ? DUST : GRASS); smoke.spawn(x, 0.25, wz, -fx * sp * 0.2 + (Math.random() - 0.5) * 2, 1 + Math.random() * 2, -fz * sp * 0.2 + (Math.random() - 0.5) * 2, 1.6, 1, 5, c.surf === 3 ? 0.55 : 0.35, tmpC, 1); }
    }
  }
  // sparks from the plank at speed / over kerbs, and on impacts
  c.sparkT -= dt;
  const sparkRate = (sp > 62 && Math.abs(T().curv[c.idx]) < 0.003 ? 0.6 : 0) + (c.surf === 1 && sp > 35 ? 3 : 0);
  if (c.sparkT <= 0 && sparkRate > 0 && Math.random() < sparkRate * dt * 8) {
    c.sparkT = 0.15 + Math.random() * 0.4;
    for (let k = 0; k < 14; k++) sparks.spawn(c.x - fx * 1.9 + (Math.random() - 0.5) * 0.6, 0.06, c.z - fz * 1.9 + (Math.random() - 0.5) * 0.6, -fx * sp * 0.35 + (Math.random() - 0.5) * 4, 0.5 + Math.random() * 2.5, -fz * sp * 0.35 + (Math.random() - 0.5) * 4, 0.25 + Math.random() * 0.35, 0.22, 0.08, 1, SPARK, 2, 9.8);
  }
  if (c.hitT > 0.05) {
    for (let k = 0; k < 30 * c.hitT; k++) sparks.spawn(c.x + lx * (c.hitSide || 1) * 0.9, 0.4, c.z + lz * (c.hitSide || 1) * 0.9, fx * sp * 0.5 + (Math.random() - 0.5) * 8, Math.random() * 5, fz * sp * 0.5 + (Math.random() - 0.5) * 8, 0.3 + Math.random() * 0.4, 0.25, 0.1, 1, SPARK, 1.5, 9.8);
    smoke.spawn(c.x, 0.6, c.z, 0, 1, 0, 1.5, 1, 6, 0.3 * c.hitT, SMOKE, 1);
    c.hitT = 0;
  }
}
const T = () => game.T;

/* ---------------- Update ---------------- */
let msgTimer = 0;
function flashMsg(text, dur, sub) { $('msg').innerHTML = text + (sub ? '<small>' + sub + '</small>' : ''); $('msg').classList.add('show'); msgTimer = dur; }
function setStartLights(n) { world.setStartLights(n); [...$('startLights').children].forEach((p, k) => p.classList.toggle('on', k < n)); }

function update(dt) {
  const Tr = game.T, p = game.player;
  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) $('msg').classList.remove('show'); }
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
  if (game.raceTime > 1 && !$('startLights').classList.contains('hidden')) $('startLights').classList.add('hidden');
  const steps = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / steps;
  for (let s = 0; s < steps; s++) {
    for (const c of game.cars) {
      let inp = (c.isPlayer && !c.autopilot) ? playerInput(c, h) : aiInput(c, h, Tr);
      if (c.startDelay > 0) { c.startDelay -= h; inp = { throttle: 0, brake: 0, steer: 0 }; }
      c.inp = inp; stepCar(c, inp, h, Tr);
    }
    collide();
    for (const c of game.cars) checkLaps(c, Tr);
  }
  if (game.resultsAt && game.raceTime >= game.resultsAt && $('results').classList.contains('hidden')) showResults();
}

function updateCarVisuals(dt) {
  for (const c of game.cars) {
    c.group.position.set(c.x, 0, c.z); c.group.rotation.y = c.h;
    c.wheelRot += c.v * dt / 0.36;
    for (const w of c.wheels) { w.spin.rotation.x = c.wheelRot; if (w.front) w.pivot.rotation.y = c.steer * 0.32; }
    c.steering.rotation.z = -c.steer * 0.9;
    // pitch / roll for weight transfer
    const tgtPitch = (c.inp.brake ? 0.012 : 0) - (c.inp.throttle && c.v < 60 ? 0.006 : 0), tgtRoll = -c.steer * Math.min(1, Math.abs(c.v) / 50) * 0.012;
    c.group.rotation.x += (tgtPitch - c.group.rotation.x) * Math.min(1, dt * 6);
    c.group.rotation.z += (tgtRoll - c.group.rotation.z) * Math.min(1, dt * 6);
    if (c.surf === 1 && Math.abs(c.v) > 10) c.group.position.y = Math.sin(performance.now() * 0.08 + c.x) * 0.012;
    const sp = Math.abs(c.v);
    if (c.v < -0.5) { c.gear = -1; c.rpm = 4500 + sp * 400; }
    else {
      let g = 1; while (g < 8 && sp > GEARS[g]) g++;
      c.gear = sp < 0.3 ? 0 : g;
      const lo = GEARS[g - 1], hi = GEARS[g] === 200 ? 95 : GEARS[g];
      c.rpm = c.gear === 0 ? 4000 : 5200 + clamp((sp - lo) / (hi - lo), 0, 1) * 6800;
    }
    if (game.phase !== 'lights') carEffects(c, dt);
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
  const sp = Math.abs(c.v), shake = (c.surf === 1 ? 0.012 : 0.002) * Math.min(1, sp / 60);
  const jx = (Math.random() - 0.5) * shake, jy = (Math.random() - 0.5) * shake;
  if (game.camMode === 0) {
    g.localToWorld(tmpV.set(jx, 0.82 + jy, 0.28)); g.localToWorld(tmpL.set(c.steer * 0.6, 0.86, 14));
    camera.position.copy(tmpV); camera.lookAt(tmpL); camera.fov = 72;
  } else if (game.camMode === 1) {
    g.localToWorld(tmpV.set(jx, 1.25 + jy, -0.42)); g.localToWorld(tmpL.set(0, 0.75, 12));
    camera.position.copy(tmpV); camera.lookAt(tmpL); camera.fov = 68;
  } else {
    g.localToWorld(tmpV.set(0, 2.9, -9.8)); g.localToWorld(tmpL.set(-c.steer * 1.2, 1.0, 5));
    if (camPos.lengthSq() === 0) { camPos.copy(tmpV); camLook.copy(tmpL); }
    camPos.lerp(tmpV, 1 - Math.exp(-dt * 7)); camLook.lerp(tmpL, 1 - Math.exp(-dt * 12));
    camPos.y = Math.max(camPos.y, 1.0);
    camera.position.copy(camPos).add(tmpV.set(jx * 4, jy * 4, 0)); camera.lookAt(camLook); camera.fov = 60 + sp * 0.1;
  }
  camera.updateProjectionMatrix();
}
function updateMenuCamera(dt) {
  const Tr = getTrack(settings.track);
  game.orbit += dt * 0.035;
  // swoop along the track at low altitude for a cinematic menu backdrop
  const i = Math.floor((game.orbit * 60) % Tr.N), j = (i + 40) % Tr.N, s = Math.sin(game.orbit * 0.7);
  camera.position.set(Tr.px[i] + Tr.nx[i] * (14 + 8 * s), 6 + 3 * Math.sin(game.orbit * 0.5), Tr.pz[i] + Tr.nz[i] * (14 + 8 * s));
  camera.lookAt(Tr.px[j], 1.5, Tr.pz[j]); camera.fov = 55; camera.updateProjectionMatrix();
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
  drawShape(off.getContext('2d'), path, map, [Tr.px[0], Tr.pz[0]], 7);
  mm.bg = off; mm.map = map;
}
function drawMinimap() {
  const ctx = mm.ctx; ctx.clearRect(0, 0, 400, 400); ctx.drawImage(mm.bg, 0, 0);
  for (const c of game.cars) { if (c.isPlayer) continue; const [x, y] = mm.map(c.x, c.z); ctx.fillStyle = c.color; ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  const p = game.player, [x, y] = mm.map(p.x, p.z);
  ctx.fillStyle = '#ffcc00'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}
let boardT = 0;
function updateHUD(dt) {
  const p = game.player, Tr = game.T, tt = settings.mode === 'tt';
  $('hSpd').textContent = Math.round(Math.abs(p.v) * 3.6);
  $('hGear').textContent = p.gear === -1 ? 'R' : p.gear === 0 ? 'N' : p.gear;
  $('hRpm').textContent = Math.round(p.rpm / 100) * 100;
  const lit = clamp(Math.floor((p.rpm - 7000) / 450), 0, 10);
  [...$('shift').children].forEach((el, k) => el.className = k < lit ? (k < 4 ? 'g' : k < 8 ? 'r' : 'b') : '');
  const cur = game.phase === 'lights' ? 0 : game.raceTime - p.lapStart;
  $('hCur').textContent = cur > 0 ? fmt(cur) : '0:00.000';
  $('hCur').classList.toggle('invalid', p.lapInvalid);
  $('hLast').textContent = fmt(p.lastLap); $('hBest').textContent = fmt(p.bestLap); $('hRec').textContent = fmt(game.record);
  const fwd = Math.sin(p.h) * Tr.tx[p.idx] + Math.cos(p.h) * Tr.tz[p.idx];
  $('wrongway').classList.toggle('hidden', !(fwd < -0.3 && p.v > 3 && game.phase === 'race'));
  if (!tt) {
    $('hLap').innerHTML = 'LAP <b>' + Math.min(game.laps, Math.max(1, p.maxDone + 1)) + '</b>/' + game.laps;
    boardT -= dt;
    if (boardT <= 0) {
      boardT = 0.25;
      const st = standings(), L = st[0];
      $('hPos').textContent = 'P' + (st.indexOf(p) + 1); $('hPosOf').textContent = '/' + st.length;
      let html = '';
      st.forEach((c, k) => {
        let gap;
        if (k === 0) gap = c.finished ? 'FINISH' : 'LEADER';
        else if (c.finished && L.finished) gap = '+' + (c.finishTime - L.finishTime).toFixed(1);
        else if (L.prog - c.prog >= Tr.N) gap = '+' + Math.floor((L.prog - c.prog) / Tr.N) + ' LAP';
        else { const b = c.lastBucket, tl = L.splits[b], tc = c.splits[b]; gap = (tl !== undefined && tc !== undefined) ? '+' + Math.max(0, tc - tl).toFixed(1) : '—'; }
        html += '<div class="r' + (c.isPlayer ? ' me' : '') + '"><span class="p">' + (k + 1) + '</span><span class="c" style="background:' + c.color + '"></span><span class="n">' + c.code + '</span><span class="g">' + gap + '</span></div>';
      });
      $('board').innerHTML = html;
    }
  }
  drawMinimap();
}

/* ---------------- Results & championship ---------------- */
function showResults() {
  const Tr = game.T, champ = settings.mode === 'champ';
  const rows = game.cars.map(c => {
    let t = c.finishTime, est = false;
    if (!c.finished) { t = game.raceTime + (game.laps * Tr.N - c.prog) * DS / Math.max(Math.abs(c.v), 30); est = true; }
    return { c, t, est };
  }).sort((a, b) => a.t - b.t);
  let fl = Infinity; rows.forEach(r => fl = Math.min(fl, r.c.bestLap));
  const pIdx = rows.findIndex(r => r.c.isPlayer) + 1;
  $('resTitle').textContent = pIdx === 1 ? 'Victory!' : 'Finished P' + pIdx;
  $('resSub').textContent = (champ ? 'Round ' + (settings.track + 1) + ' of ' + TRACKS.length + ' · ' : '') + Tr.def.name + ' · ' + game.laps + ' laps';
  let html = '<tr><th>Pos</th><th>Driver</th><th>Team</th><th>Time</th><th>Best lap</th>' + (champ ? '<th>Pts</th>' : '') + '</tr>';
  rows.forEach((r, k) => {
    const time = k === 0 ? fmt(r.t) : '+' + (r.t - rows[0].t).toFixed(3) + (r.est ? '*' : '');
    html += '<tr class="' + (r.c.isPlayer ? 'me' : '') + '"><td>' + (k + 1) + '</td><td><span class="sw" style="background:' + r.c.color + '"></span>' + r.c.name + '</td><td>' + r.c.team + '</td><td>' + time + '</td><td class="' + (r.c.bestLap === fl ? 'fl' : '') + '">' + fmt(r.c.bestLap) + '</td>' + (champ ? '<td><b>' + (POINTS[k] ? '+' + POINTS[k] : '') + '</b></td>' : '') + '</tr>';
  });
  $('resTable').innerHTML = html;
  $('champBox').classList.add('hidden');
  $('rAgain').textContent = 'Race again';
  if (champ) {
    const s = game.season;
    rows.forEach((r, k) => { s.pts[r.c.code] = (s.pts[r.c.code] || 0) + (POINTS[k] || 0); });
    s.round++; s.finished = s.round >= TRACKS.length; saveSeason(s);
    const names = { YOU: ['You', LIVERIES[settings.livery]] };
    s.lineup.forEach(l => { names[DRIVERS[l.di][1]] = [DRIVERS[l.di][0], TEAMS[Math.floor(l.di / 2) % TEAMS.length].color]; });
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
  $('seasonBox').classList.toggle('hidden', mode !== 'champ');
  if (mode === 'champ') {
    if (s && !s.finished) { settings.track = s.round; $('seasonInfo').innerHTML = 'Round <b>' + (s.round + 1) + '</b> of ' + TRACKS.length + ' · You have <b>' + (s.pts.YOU || 0) + '</b> pts<br><small>' + s.laps + ' laps · ' + s.diff + ' AI · ' + s.opp + ' rivals</small>'; $('newSeason').classList.remove('hidden'); }
    else { settings.track = 0; $('seasonInfo').innerHTML = 'A 24-round season. Points for the top 10.<br><small>Uses the laps, rivals and difficulty above.</small>'; $('newSeason').classList.add('hidden'); }
  }
  $('startBtn').textContent = mode === 'tt' ? 'Start Time Trial' : mode === 'champ' ? (s && !s.finished ? 'Start Round ' + (s.round + 1) : 'Start Season') : 'Start Race';
  document.querySelectorAll('#swatches button').forEach((b, k) => b.classList.toggle('on', k === settings.livery));
  document.querySelectorAll('.tcard').forEach((c, k) => { c.classList.toggle('on', k === settings.track); c.classList.toggle('locked', mode === 'champ'); });
  const d = TRACKS[settings.track];
  $('tiName').textContent = d.name; $('tiBlurb').textContent = d.loc + ' · ' + d.blurb;
  const on = document.querySelector('.tcard.on'); if (on) on.scrollIntoView({ block: 'nearest' });
}
function showLoading(on) { $('loading').classList.toggle('hidden', !on); }
function withLoading(fn) { showLoading(true); setTimeout(() => { try { fn(); } finally { showLoading(false); } }, 30); }
function selectTrack(i) {
  if (settings.mode === 'champ') return;
  settings.track = i; saveSettings(); refreshMenu();
  withLoading(() => buildTrack(i));
}
function cardStats(i) {
  const d = TRACKS[i], pv = previewPoints(d, 60), rec = parseFloat(store.get('apexgp2-best-' + d.id));
  return '<b>' + (pv.length / 1000).toFixed(2) + ' km</b>' + (isFinite(rec) ? ' · <b>' + fmt(rec) + '</b>' : '');
}
function initMenu() {
  document.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const k = seg.dataset.opt, v = b.dataset.v;
    settings[k] = (k === 'laps' || k === 'opp' || k === 'gfx') ? parseInt(v, 10) : v; saveSettings();
    if (k === 'gfx') { setupPost(); withLoading(() => buildTrack(settings.track, true)); }
    const prev = settings.track; refreshMenu();
    if (k === 'mode' && settings.track !== prev) withLoading(() => buildTrack(settings.track));
  }));
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
  $('startBtn').onclick = () => withLoading(setupRace);
  $('newSeason').onclick = () => { store.del('apexgp2-season'); refreshMenu(); withLoading(() => buildTrack(settings.track)); };
  for (let k = 0; k < 5; k++) { const pod = document.createElement('div'); pod.className = 'pod'; pod.innerHTML = '<i></i><i></i>'; $('startLights').appendChild(pod); }
  for (let k = 0; k < 10; k++) $('shift').appendChild(document.createElement('i'));
  $('pResume').onclick = () => togglePause(false);
  $('pRestart').onclick = () => { if (settings.mode === 'champ') return; withLoading(setupRace); };
  $('pQuit').onclick = toMenu; $('rMenu').onclick = toMenu;
  $('rAgain').onclick = () => { if (settings.mode === 'champ') { const s = loadSeason(); if (s && s.finished) store.del('apexgp2-season'); } withLoading(setupRace); };
  refreshMenu();
  withLoading(() => buildTrack(settings.track));
}
function toMenu() {
  game.state = 'menu'; game.paused = false; audio.set(0, 0, false); clearCars(); smoke.clear(); sparks.clear(); skids.clear();
  $('hud').classList.add('hidden'); $('pause').classList.add('hidden'); $('results').classList.add('hidden'); $('menu').classList.remove('hidden');
  document.querySelectorAll('.tcard .st').forEach((el, i) => el.innerHTML = cardStats(i));
  refreshMenu(); withLoading(() => buildTrack(settings.track));
}
function togglePause(force) {
  if (game.state !== 'race' || !$('results').classList.contains('hidden')) return;
  game.paused = typeof force === 'boolean' ? force : !game.paused;
  $('pause').classList.toggle('hidden', !game.paused);
  $('pRestart').classList.toggle('hidden', settings.mode === 'champ');
  if (game.paused) audio.set(0, 0, false);
}

/* ---------------- Input ---------------- */
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'a' || k === 's' || k === 'd') { keys[k] = true; e.preventDefault(); }
  if (e.repeat) return;
  if (k === 'c' && game.state === 'race' && !game.paused) setCam((game.camMode + 1) % 3);
  if (k === 'escape') togglePause();
  if (k === 'm') { audio.muted = !audio.muted; store.set('apexgp-muted', audio.muted ? '1' : '0'); if (game.state === 'race') flashMsg(audio.muted ? 'SOUND OFF' : 'SOUND ON', 0.9); }
});
addEventListener('keyup', e => { const k = e.key.toLowerCase(); if (k in keys) keys[k] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (game.state === 'race' && game.phase !== 'finished') togglePause(true); });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); setupPost(); });

/* ---------------- Main loop ---------------- */
let last = performance.now(), clock = 0;
const focus = new THREE.Vector3();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
  if (game.state === 'race') {
    if (!game.paused) {
      update(dt); updateCarVisuals(dt);
      if (game.phase !== 'lights') audio.set(game.player.rpm, game.player.inp.throttle, true);
    }
    updateCamera(dt, clock); updateHUD(dt);
    focus.set(game.player.x, 0, game.player.z);
  } else {
    updateMenuCamera(dt);
    focus.copy(camera.position).setY(0);
  }
  world.update(dt, focus, camera);
  if (composer) composer.render(); else renderer.render(scene, camera);
}
initMenu();
requestAnimationFrame(frame);

// debugging hooks for automated checks
window.__apex = { get bloom() { return bloom; }, game, settings, update, updateCarVisuals, updateCamera, updateHUD, setCam, setupRace, buildTrack, getTrack, world, renderer, scene, camera, standings, positionOf, keys, frameOnce: () => { world.update(0.016, focus.set(game.player ? game.player.x : 0, 0, game.player ? game.player.z : 0), camera); if (composer) composer.render(); else renderer.render(scene, camera); } };

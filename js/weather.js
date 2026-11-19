import * as THREE from 'three';
import { makeNoise, rng, clamp, smooth } from './util.js?v=95106973';

/* Rain that varies along the lap (some sections heavier than others), a per-sample
   wetness map that builds up under rain and dries out afterwards, and falling rain
   streaks around the camera. */
export class Weather {
  constructor(scene) {
    const M = this.maxDrops = 2600;
    const pos = new Float32Array(M * 6);
    this.drops = new Float32Array(M * 3);
    const r = rng(77);
    for (let i = 0; i < M; i++) { this.drops[i * 3] = (r() - 0.5) * 80; this.drops[i * 3 + 1] = r() * 30; this.drops[i * 3 + 2] = (r() - 0.5) * 80; }
    const g = new THREE.BufferGeometry(); this.posAttr = new THREE.BufferAttribute(pos, 3); this.posAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xc8d2de, transparent: true, opacity: 0.45, depthWrite: false }));
    this.lines.frustumCulled = false; this.lines.visible = false; scene.add(this.lines);
    this.N = 0; this.keys = [{ t: 0, r: 0 }];
  }

  /* mode: 'dry' | 'random' | 'wet'; raceDur: expected seconds of running */
  setup(T, mode, raceDur, seed) {
    const N = this.N = T.N, r = rng(seed);
    this.noise = makeNoise(seed + 5);
    this.wet = new Float32Array(N); this.local = new Float32Array(N);
    this.phase = r() * 100; this.t = 0; this.acc = 0;
    const k = [];
    if (mode === 'wet') {
      const peak = 0.55 + r() * 0.4;
      k.push({ t: 0, r: peak }, { t: raceDur * (0.3 + r() * 0.3), r: peak * (0.5 + r() * 0.6) });
      if (r() < 0.45) k.push({ t: raceDur * (0.7 + r() * 0.2), r: 0.05 }, { t: raceDur * 2, r: 0 });
      else k.push({ t: raceDur * 2, r: peak * 0.8 });
      this.wet.fill(Math.min(1, peak * 1.05));
    } else if (mode === 'random' && r() < 0.5) {
      const start = raceDur * (0.12 + r() * 0.45), peak = 0.3 + r() * 0.6, ramp = 40 + r() * 60;
      k.push({ t: 0, r: 0 }, { t: start, r: 0 }, { t: start + ramp, r: peak });
      if (r() < 0.55) { const ease = start + ramp + raceDur * (0.15 + r() * 0.2); k.push({ t: ease, r: peak }, { t: ease + 50, r: peak * 0.3 }, { t: ease + 120, r: 0 }); }
      k.push({ t: raceDur * 3, r: k[k.length - 1].r });
    } else k.push({ t: 0, r: 0 }, { t: 1e9, r: 0 });
    this.keys = k;
    this.update(0.01, 0);
  }

  global(t) {
    const k = this.keys;
    for (let i = 1; i < k.length; i++) if (t <= k[i].t) { const a = k[i - 1], b = k[i], f = (t - a.t) / Math.max(1e-6, b.t - a.t); return a.r + (b.r - a.r) * smooth(0, 1, f); }
    return k[k.length - 1].r;
  }
  /* first time (after `from`) that global rain exceeds `thr` */
  nextRain(from, thr = 0.05) { for (let t = from; t < from + 900; t += 5) if (this.global(t) > thr) return t; return Infinity; }

  update(dt, t) {
    this.t = t; this.acc += dt;
    if (this.acc < 0.25) return; const step = this.acc; this.acc = 0;
    const g = this.global(t), N = this.N;
    for (let i = 0; i < N; i++) {
      // heavier/lighter bands drift slowly around the lap
      const f = 0.35 + 0.65 * (0.5 + 0.5 * this.noise.fbm(i / N * 7 + this.phase, t * 0.004, 3) * 1.6);
      const loc = this.local[i] = clamp(g * f, 0, 1);
      const w = this.wet[i];
      this.wet[i] = loc > w ? Math.min(loc * 1.1, w + (loc - w) * 0.05 * step + 0.02 * loc * step) : Math.max(0, w - (0.0045 + 0.004 * (1 - loc)) * step);
    }
  }
  wetAt(i) { return this.N ? this.wet[i] : 0; }
  rainAt(i) { return this.N ? this.local[i] : 0; }
  average() { let s = 0; for (let i = 0; i < this.N; i += 7) s += this.wet[i]; return this.N ? s / Math.ceil(this.N / 7) : 0; }
  sectorRain() { const out = [0, 0, 0], n = [0, 0, 0]; for (let i = 0; i < this.N; i += 5) { const s = Math.min(2, Math.floor(i / this.N * 3)); out[s] += this.local[i]; n[s]++; } return out.map((v, k) => v / Math.max(1, n[k])); }

  /* falling rain around the camera */
  render(dt, camera, intensity) {
    const on = intensity > 0.02; this.lines.visible = on; if (!on) return;
    const M = this.maxDrops, n = Math.floor(M * clamp(intensity, 0, 1)), d = this.drops, p = this.posAttr.array;
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, fall = 26 * dt, len = 0.9;
    for (let i = 0; i < n; i++) {
      d[i * 3 + 1] -= fall; if (d[i * 3 + 1] < -4) { d[i * 3 + 1] += 34; }
      const x = cx + d[i * 3], y = cy + d[i * 3 + 1], z = cz + d[i * 3 + 2];
      p[i * 6] = x; p[i * 6 + 1] = y; p[i * 6 + 2] = z; p[i * 6 + 3] = x + 0.08; p[i * 6 + 4] = y + len; p[i * 6 + 5] = z;
    }
    this.lines.geometry.setDrawRange(0, n * 2); this.posAttr.needsUpdate = true;
    this.lines.material.opacity = 0.25 + 0.3 * intensity;
  }
}

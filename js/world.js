import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { W, KERB, DS } from './tracks.js';
import { rng, makeNoise, canvasTex, normalTex, noiseFill, smooth, clamp } from './util.js';

const AD_WORDS = ['APEX GP', 'NOVA FUEL', 'KITE TYRES', 'ORBITAL', 'HELIX', 'SUMMIT', 'VOLTA', 'RAPIDE', 'ZENITH', 'TORQUE+'];

/* ---------------- shared textures ---------------- */
let TX = null;
function textures() {
  if (TX) return TX;
  const r = rng(5);
  TX = {};
  TX.asphalt = canvasTex(512, 512, (g, w, h) => noiseFill(g, w, h, '#4a4c51', 30, 3, 0.05));
  TX.asphaltN = normalTex(512, 512, (g, w, h) => noiseFill(g, w, h, '#808080', 90, 4, 0.08), 2.2);
  TX.kerb = canvasTex(64, 128, (g, w, h) => { g.fillStyle = '#c8202a'; g.fillRect(0, 0, w, h / 2); g.fillStyle = '#f1f1f1'; g.fillRect(0, h / 2, w, h / 2); const id = g.getImageData(0, 0, w, h); for (let i = 0; i < id.data.length; i += 4) { const n = (r() - 0.5) * 18; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; } g.putImageData(id, 0, 0); });
  TX.paint = canvasTex(128, 128, (g, w, h) => noiseFill(g, w, h, '#e8e8e8', 22, 8));
  TX.gravel = canvasTex(256, 256, (g, w, h) => noiseFill(g, w, h, '#c9b48a', 60, 9, 0.25));
  TX.gravelN = normalTex(256, 256, (g, w, h) => noiseFill(g, w, h, '#808080', 140, 10, 0.3), 3);
  TX.verge = canvasTex(64, 256, (g, w, h) => { g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h / 2); g.fillStyle = '#d6d6d6'; g.fillRect(0, h / 2, w, h / 2); const id = g.getImageData(0, 0, w, h); for (let i = 0; i < id.data.length; i += 4) { const n = (r() - 0.5) * 30; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; } g.putImageData(id, 0, 0); });
  TX.fence = canvasTex(128, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(180,186,194,1)'; g.lineWidth = 3; for (let k = -w; k < w * 2; k += 32) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + h, h); g.stroke(); g.beginPath(); g.moveTo(k + h, 0); g.lineTo(k, h); g.stroke(); } g.fillStyle = 'rgba(160,166,174,1)'; g.fillRect(0, 0, w, 4); }, { srgb: true });
  TX.tyres = canvasTex(256, 64, (g, w, h) => { g.fillStyle = '#0d0d0e'; g.fillRect(0, 0, w, h); for (let x = 16; x < w; x += 32) for (const y of [20, 46]) { g.fillStyle = '#1d1e20'; g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.fill(); g.fillStyle = '#070708'; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); } g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, w, 6); });
  TX.ads = canvasTex(2048, 128, (g, w, h) => {
    const cols = [['#111827', '#facc15'], ['#1d4ed8', '#ffffff'], ['#dc2626', '#ffffff'], ['#f8fafc', '#111827'], ['#16a34a', '#ffffff'], ['#7c3aed', '#ffffff'], ['#0f172a', '#22d3ee'], ['#ea580c', '#111111']];
    for (let k = 0; k < 8; k++) { const [bg, fg] = cols[k]; g.fillStyle = bg; g.fillRect(k * 256, 0, 256, h); g.fillStyle = fg; g.font = 'italic 800 64px "Barlow Condensed", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(AD_WORDS[k], k * 256 + 128, h / 2 + 4); }
  });
  TX.adsWall = TX.ads.clone(); TX.adsWall.center.set(0.5, 0.5); TX.adsWall.rotation = Math.PI / 2; TX.adsWall.needsUpdate = true;
  TX.tyresWall = TX.tyres.clone(); TX.tyresWall.center.set(0.5, 0.5); TX.tyresWall.rotation = Math.PI / 2; TX.tyresWall.needsUpdate = true;
  TX.crowd = canvasTex(512, 128, (g, w, h) => { g.fillStyle = '#1b1f2a'; g.fillRect(0, 0, w, h); const c = ['#e74c3c', '#f1c40f', '#ecf0f1', '#3498db', '#2ecc71', '#e67e22', '#9b59b6', '#f5cba7', '#ff4fa3']; for (let i = 0; i < 5200; i++) { g.fillStyle = c[Math.floor(r() * c.length)]; g.fillRect(r() * w, r() * h, 2, 3); } });
  TX.checker = canvasTex(256, 64, (g) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; g.fillRect(x * 16, y * 16, 16, 16); } }, { repeat: false });
  TX.detail = canvasTex(256, 256, (g, w, h) => noiseFill(g, w, h, '#d8d8d8', 50, 12, 0.03));
  TX.waterN = normalTex(256, 256, (g, w, h) => { const n = makeNoise(3); const id = g.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = (n.fbm(x / 32, y / 32, 4) * 0.5 + 0.5) * 255; const i = (y * w + x) * 4; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; } g.putImageData(id, 0, 0); }, 3);
  TX.cloud = canvasTex(512, 512, (g, w, h) => { const n = makeNoise(17); const id = g.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = 64; let v = 0, a = 1, f = 1, tot = 0; for (let o = 0; o < 5; o++) { const fx = x / s * f, fy = y / s * f, p = 512 / s * f; v += a * (n.perlin(fx % p, fy % p)); tot += a; a *= 0.5; f *= 2; } v = v / tot; const i = (y * w + x) * 4; id.data[i] = id.data[i + 1] = id.data[i + 2] = 255; id.data[i + 3] = clamp((v - 0.12) * 700, 0, 230); } g.putImageData(id, 0, 0); });
  const win = night => canvasTex(128, 256, (g, w, h) => { const rr = rng(night ? 31 : 32); g.fillStyle = night ? '#000' : '#c4ccd6'; g.fillRect(0, 0, w, h); for (let y = 6; y < h - 4; y += 12) for (let x = 6; x < w - 4; x += 12) { if (night) g.fillStyle = rr() < 0.42 ? (rr() < 0.6 ? '#ffd58a' : '#a9dcff') : '#040404'; else g.fillStyle = rr() < 0.5 ? '#46637f' : '#6f8aa5'; g.fillRect(x, y, 8, 8); } }, { repeat: false });
  TX.winDay = win(false); TX.winNight = win(true);
  return TX;
}

/* ---------------- geometry helpers ---------------- */
function ribbon(T, i0, count, cols, vScale, { colorFn = null, up = true } = {}) {
  const C = cols.length, n = count + 1;
  const pos = new Float32Array(n * C * 3), uv = new Float32Array(n * C * 2), col = colorFn ? new Float32Array(n * C * 3) : null, idx = [];
  for (let k = 0; k < n; k++) {
    const i = (i0 + k) % T.N;
    for (let c = 0; c < C; c++) {
      const [o, y, u] = cols[c](i), j = k * C + c;
      pos[j * 3] = T.px[i] + T.nx[i] * o; pos[j * 3 + 1] = y; pos[j * 3 + 2] = T.pz[i] + T.nz[i] * o;
      uv[j * 2] = u; uv[j * 2 + 1] = k * DS / vScale;
      if (col) { const cc = colorFn(i, o); col[j * 3] = cc; col[j * 3 + 1] = cc; col[j * 3 + 2] = cc; }
    }
  }
  for (let k = 0; k < count; k++) for (let c = 0; c < C - 1; c++) { const a = k * C + c, b = a + 1, d = a + C, e = d + 1; idx.push(a, b, d, b, e, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  if (up) { const nrm = g.attributes.normal.array; let sy = 0; for (let i = 1; i < nrm.length; i += 3) sy += nrm[i]; if (sy < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); } }
  return g;
}
const col = (o, y, u) => () => [o, y, u];
const sideLim = (T, s) => i => s > 0 ? T.limL[i] : T.limR[i];
function rangesOf(arr, N, pred) {
  const out = []; let s = -1;
  for (let i = 0; i < N; i++) { const p = pred(arr[i]); if (p && s < 0) s = i; if ((!p || i === N - 1) && s >= 0) { out.push([s, p ? i : i - 1]); s = -1; } }
  return out;
}

/* ---------------- World ---------------- */
export class World {
  constructor(renderer, scene) {
    this.renderer = renderer; this.scene = scene;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.sky = new Sky(); this.sky.scale.setScalar(18000); scene.add(this.sky);
    this.nightSky = new THREE.Mesh(new THREE.SphereGeometry(15000, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color() }, bot: { value: new THREE.Color() } },
      vertexShader: 'varying float vy; void main(){ vy = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w * 0.99999; }',
      fragmentShader: 'uniform vec3 top; uniform vec3 bot; varying float vy; void main(){ float t = clamp(vy*1.6,0.0,1.0); gl_FragColor = vec4(mix(bot, top, pow(t,0.6)), 1.0); }',
    }));
    this.nightSky.frustumCulled = false; scene.add(this.nightSky);
    { const n = 1600, pos = new Float32Array(n * 3), rr = rng(7);
      for (let i = 0; i < n; i++) { const th = rr() * Math.PI * 2, y = 0.06 + rr() * 0.94, q = Math.sqrt(1 - y * y); pos.set([Math.cos(th) * q * 14000, y * 14000, Math.sin(th) * q * 14000], i * 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, depthWrite: false }));
      this.stars.frustumCulled = false; scene.add(this.stars); }
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(220, 32), new THREE.MeshBasicMaterial({ color: 0xf4f1e6, fog: false, toneMapped: false }));
    scene.add(this.moon);
    this.sun = new THREE.DirectionalLight(0xffffff, 3); this.sun.shadow.bias = -0.0003; this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.4); scene.add(this.hemi);
    this.sunDir = new THREE.Vector3();
    this.group = null; this.envRT = null; this.clouds = null; this.waters = [];
  }

  dispose() {
    if (!this.group) return;
    this.scene.remove(this.group);
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); });
    this.group = null;
  }

  build(T, quality, teamColors) {
    this.dispose();
    const tx = textures(), th = T.theme, N = T.N, q = quality;
    const G = this.group = new THREE.Group(); this.scene.add(G);
    this.waters = []; this.gantryLights = [];
    const add = (geo, mat, { cast = false, recv = true } = {}) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = recv; G.add(m); return m; };
    const seed = T.def.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
    const r = rng(seed), noise = makeNoise(seed);

    /* ----- sky, sun, environment ----- */
    const elev = th.night ? 35 : th.sunElev;
    this.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elev), THREE.MathUtils.degToRad(th.night ? 140 : th.sunAz));
    const envScene = new THREE.Scene();
    if (th.night) {
      this.sky.visible = false; this.nightSky.visible = this.stars.visible = this.moon.visible = true;
      this.nightSky.material.uniforms.top.value.set(th.nightSky[0]); this.nightSky.material.uniforms.bot.value.set(th.nightSky[1]);
      const es = new THREE.Mesh(new THREE.SphereGeometry(50, 16, 8), this.nightSky.material.clone()); envScene.add(es);
      for (let k = 0; k < 10; k++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(k % 2 ? th.wallA : '#fff2d6').multiplyScalar(2.5), side: THREE.DoubleSide })); const a = k / 10 * Math.PI * 2; p.position.set(Math.cos(a) * 40, 10 + (k % 3) * 6, Math.sin(a) * 40); p.lookAt(0, 0, 0); envScene.add(p); }
      this.sun.color.set('#9fb3ff'); this.sun.intensity = 0.6;
      this.hemi.color.set('#8fa4ff'); this.hemi.groundColor.set('#2a2433'); this.hemi.intensity = 1.1;
      this.moon.position.copy(this.sunDir).multiplyScalar(12000); this.moon.lookAt(0, 0, 0);
    } else {
      this.sky.visible = true; this.nightSky.visible = this.stars.visible = this.moon.visible = false;
      const u = this.sky.material.uniforms;
      u.turbidity.value = th.turbidity; u.rayleigh.value = th.rayleigh; u.mieCoefficient.value = th.mie; u.mieDirectionalG.value = 0.8; u.sunPosition.value.copy(this.sunDir);
      const es = new Sky(); es.scale.setScalar(50); Object.assign(es.material.uniforms.turbidity, { value: th.turbidity });
      es.material.uniforms.rayleigh.value = th.rayleigh; es.material.uniforms.mieCoefficient.value = th.mie; es.material.uniforms.mieDirectionalG.value = 0.8; es.material.uniforms.sunPosition.value.copy(this.sunDir);
      envScene.add(es);
      const low = clamp(elev / 30, 0, 1);
      this.sun.color.setRGB(1, 0.72 + 0.26 * low, 0.5 + 0.45 * low); this.sun.intensity = 1.2 + 2.0 * clamp(elev / 25, 0, 1);
      this.hemi.color.set('#dfefff'); this.hemi.groundColor.set(th.grass); this.hemi.intensity = 0.35;
    }
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(envScene, 0.02, 0.1, 200);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = th.night ? 0.6 : 1;
    this.scene.fog = new THREE.FogExp2(th.fog, th.fogDensity);
    this.renderer.toneMappingExposure = th.exposure;
    this.bloomStrength = th.bloom; this.night = th.night;
    this.sun.castShadow = q > 0;
    const sm = q >= 2 ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x !== sm) { this.sun.shadow.mapSize.set(sm, sm); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } }
    const sc = this.sun.shadow.camera; sc.left = sc.bottom = -70; sc.right = sc.top = 70; sc.near = 1; sc.far = 900; sc.updateProjectionMatrix();

    /* ----- distance field + terrain ----- */
    const span = Math.max(T.maxX - T.minX, T.maxZ - T.minZ) + 4600;
    const x0 = T.cx - span / 2, z0 = T.cz - span / 2;
    const DF = 200, cell = span / DF, df = new Float32Array((DF + 1) * (DF + 1));
    for (let j = 0; j <= DF; j++) for (let i = 0; i <= DF; i++) {
      const x = x0 + i * cell, z = z0 + j * cell; let m = 1e12;
      for (let k = 0; k < N; k += 4) { const dx = x - T.px[k], dz = z - T.pz[k], d = dx * dx + dz * dz; if (d < m) m = d; }
      df[j * (DF + 1) + i] = Math.sqrt(m);
    }
    const dist = (x, z) => {
      const fx = clamp((x - x0) / cell, 0, DF - 0.001), fz = clamp((z - z0) / cell, 0, DF - 0.001), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, R = DF + 1;
      return (df[j * R + i] * (1 - u) + df[j * R + i + 1] * u) * (1 - v) + (df[(j + 1) * R + i] * (1 - u) + df[(j + 1) * R + i + 1] * u) * v;
    };
    this.dist = dist;
    const flat = T.wallOff + (T.street ? 70 : 45), amp = th.hillAmp;
    const wdir = th.water && th.water.mode === 'side' ? [Math.cos(th.water.angle), Math.sin(th.water.angle)] : null;
    const height = (x, z) => {
      const d = dist(x, z), t = smooth(flat, flat + 600, d);
      if (t <= 0) return 0;
      let h;
      const sx = x / 1000, sz = z / 1000;
      switch (th.relief) {
        case 'mountains': { const rr2 = noise.ridge(sx * 0.7, sz * 0.7, 5); h = (Math.pow(rr2, 2.2) * amp + noise.fbm(sx * 3, sz * 3, 3) * 30) * smooth(flat, flat + 1800, d) + 15; break; }
        case 'mesa': { const n = noise.fbm(sx * 1.3, sz * 1.3, 4) * 1.6 + 0.35; const v = clamp(n, 0, 1) * 3; h = amp * (Math.floor(v) + smooth(0.78, 0.96, v % 1)) / 3 + noise.fbm(sx * 8, sz * 8, 2) * 6; break; }
        case 'dunes': { h = (noise.ridge(sx * 2.2, sz * 1.1, 3) - 0.45) * amp + noise.fbm(sx, sz, 3) * amp * 0.8 + amp * 0.3; break; }
        case 'flat': h = noise.fbm(sx * 2, sz * 2, 3) * amp + amp * 0.2; break;
        default: h = (noise.fbm(sx * 1.1, sz * 1.1, 5) * 0.9 + 0.35) * amp;
      }
      h *= t;
      if (th.water) {
        if (wdir) { const pr = (x - T.cx) * wdir[0] + (z - T.cz) * wdir[1]; h -= smooth(T.radius + 150, T.radius + 700, pr) * (h + 45); }
        else { const l = noise.fbm(sx * 0.9 + 7, sz * 0.9 + 3, 3); h -= smooth(-0.02, -0.25, l) * smooth(flat + 120, flat + 400, d) * (h + 40); }
      }
      return h;
    };
    this.height = height;
    {
      const seg = q === 0 ? 150 : q === 1 ? 240 : 320;
      const geo = new THREE.PlaneGeometry(span, span, seg, seg).rotateX(-Math.PI / 2);
      geo.translate(T.cx, 0, T.cz);
      const p = geo.attributes.position, colors = new Float32Array(p.count * 3);
      const cLo = new THREE.Color(th.terrain[0]), cMid = new THREE.Color(th.terrain[1]), cHi = new THREE.Color(th.terrain[2]), cSnow = new THREE.Color('#f2f6f9'), cSand = new THREE.Color(th.sand), c = new THREE.Color();
      const wl = th.water ? th.water.level : -1e9;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i), h = height(x, z); p.setY(i, h);
        const v = noise.fbm(x / 140, z / 140, 3);
        c.copy(cLo).lerp(cMid, smooth(-0.2, 0.4, v));
        c.lerp(cHi, smooth(amp * 0.35, amp * 0.9, h));
        if (th.snowLine > 1) c.lerp(cSnow, smooth(th.snowLine, th.snowLine + 80, h + v * 40));
        if (th.water) c.lerp(cSand, smooth(wl + 6, wl + 1, h));
        colors.set([c.r, c.g, c.b], i * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const det = tx.detail.clone(); det.needsUpdate = true; det.repeat.set(span / 14, span / 14);
      const ground = add(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: det, roughness: 1, metalness: 0 }));
      ground.position.y = -0.03;
    }
    if (th.water) {
      const wn = tx.waterN.clone(); wn.needsUpdate = true; wn.repeat.set(span / 60, span / 60);
      const water = add(new THREE.PlaneGeometry(span * 3, span * 3).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: th.night ? '#0a1a2a' : '#1d5a74', roughness: 0.06, metalness: 0.05, normalMap: wn, normalScale: new THREE.Vector2(0.35, 0.35), clearcoat: 1, clearcoatRoughness: 0.05 }), { recv: false });
      water.position.set(T.cx, th.water.level, T.cz);
      this.waters.push(wn);
    }
    if (!th.night) {
      const ct = tx.cloud.clone(); ct.needsUpdate = true; ct.repeat.set(4, 4);
      const cm = new THREE.MeshBasicMaterial({ map: ct, transparent: true, depthWrite: false, fog: false, opacity: th.mie > 0.01 ? 0.95 : 0.7, color: new THREE.Color().setRGB(1, 0.9 + 0.1 * clamp(elev / 30, 0, 1), 0.82 + 0.18 * clamp(elev / 30, 0, 1)) });
      this.clouds = add(new THREE.PlaneGeometry(40000, 40000).rotateX(Math.PI / 2), cm, { recv: false });
      this.clouds.position.set(T.cx, 1400, T.cz); this.cloudTex = ct;
    } else { this.clouds = null; }

    /* ----- track surface ----- */
    const roadCols = []; for (let c = 0; c <= 14; c++) { const o = W - c * (2 * W / 14); roadCols.push(col(o, 0.02, o / 6)); }
    add(ribbon(T, 0, N, roadCols, 6, { colorFn: (i, o) => { const d = (o - T.race[i]) / 1.5; return 0.92 * (1 - 0.26 * Math.exp(-d * d)) * (Math.abs(o) > W - 0.9 ? 1.08 : 1); } }),
      new THREE.MeshStandardMaterial({ map: tx.asphalt, normalMap: tx.asphaltN, normalScale: new THREE.Vector2(0.6, 0.6), vertexColors: true, roughness: 0.86, metalness: 0, color: th.night ? '#c9ccd6' : '#ffffff' }));
    const lineMat = new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.6, map: tx.paint });
    for (const s of [1, -1]) add(ribbon(T, 0, N, [col(s * (W - 0.15), 0.035, 0), col(s * (W - 0.45), 0.035, 1)], 4), lineMat);
    // verges / run-off
    const vergeMat = T.street ? new THREE.MeshStandardMaterial({ map: tx.asphalt, normalMap: tx.asphaltN, color: '#7d7f86', roughness: 0.9 })
      : new THREE.MeshStandardMaterial({ map: tx.verge, color: th.grass, roughness: 1 });
    for (const s of [1, -1]) add(ribbon(T, 0, N, [col(s * W, 0.01, 0), i => [s * (sideLim(T, s)(i) + 0.3), 0.01, 1]], T.street ? 6 : 16), vergeMat);
    // kerbs
    const kerbMat = new THREE.MeshStandardMaterial({ map: tx.kerb, roughness: 0.55 });
    const apronMat = new THREE.MeshStandardMaterial({ map: tx.paint, color: th.apron, roughness: 0.7 });
    for (const [s0, e0] of T.kerbs) {
      const cnt = e0 - s0;
      for (const s of [1, -1]) {
        add(ribbon(T, s0, cnt, [col(s * (W - 0.03), 0.025, 0), col(s * (W + 0.55), 0.075, 0.4), col(s * (W + KERB - 0.25), 0.065, 0.8), col(s * (W + KERB), 0.018, 1)], 4), kerbMat);
        if (!T.street) add(ribbon(T, s0, cnt, [col(s * (W + KERB), 0.02, 0), i => [s * Math.min(W + KERB + 2.4, sideLim(T, s)(i) - 0.5), 0.02, 1]], 4), apronMat);
      }
    }
    // gravel traps + tyre walls
    const gravelMat = new THREE.MeshStandardMaterial({ map: tx.gravel, normalMap: tx.gravelN, roughness: 1 });
    const tyreMat = new THREE.MeshStandardMaterial({ map: tx.tyresWall, roughness: 0.9, side: THREE.DoubleSide });
    for (const s of [1, -1]) {
      for (const [a, b] of rangesOf(T.gravel, N, v => v === s)) {
        const lim = sideLim(T, s);
        add(ribbon(T, a, b - a, [col(s * (W + KERB + 2.4), 0.022, 0), i => [s * Math.max(W + KERB + 2.6, lim(i) - 1.2), 0.022, 3]], 8), gravelMat);
        add(ribbon(T, a, b - a, [i => [s * (lim(i) - 0.55), 0, 0], i => [s * (lim(i) - 0.55), 1.0, 1]], 8, { up: false }), tyreMat, { cast: q > 0 });
      }
    }
    // barriers: armco (circuits) or concrete with ad boards (streets), plus debris fence
    for (const s of [1, -1]) {
      const lim = sideLim(T, s);
      if (T.street) {
        const adMat = new THREE.MeshStandardMaterial({ map: tx.adsWall, roughness: 0.6, emissive: th.night ? '#ffffff' : '#000000', emissiveMap: th.night ? tx.adsWall : null, emissiveIntensity: 0.3, side: THREE.DoubleSide });
        add(ribbon(T, 0, N, [i => [s * lim(i), 0, 0], i => [s * lim(i), 1.15, 1]], 30, { up: false }), adMat, { cast: q > 0 });
        add(ribbon(T, 0, N, [i => [s * lim(i), 1.15, 0], i => [s * (lim(i) + 0.5), 1.15, 1]], 8), new THREE.MeshStandardMaterial({ color: '#b8bcc4', roughness: 0.8 }));
      } else {
        const rail = new THREE.MeshStandardMaterial({ color: '#c3c8cf', roughness: 0.3, metalness: 0.85, side: THREE.DoubleSide });
        add(ribbon(T, 0, N, [i => [s * lim(i), 0.45, 0], i => [s * lim(i), 0.78, 1]], 8, { up: false }), rail, { cast: q > 0 });
        add(ribbon(T, 0, N, [i => [s * lim(i), 0.9, 0], i => [s * lim(i), 1.15, 1]], 8, { up: false }), rail);
        const wallBand = new THREE.MeshStandardMaterial({ color: th.wallB, roughness: 0.6, side: THREE.DoubleSide });
        add(ribbon(T, 0, N, [i => [s * (lim(i) + 0.05), 0, 0], i => [s * (lim(i) + 0.05), 0.45, 1]], 8, { up: false }), wallBand);
      }
      const ft = tx.fence.clone(); ft.needsUpdate = true;
      add(ribbon(T, 0, N, [i => [s * (lim(i) + 0.4), 1.15, 0], i => [s * (lim(i) + 0.4), 4.2, 1]], 3.05, { up: false }), new THREE.MeshStandardMaterial({ map: ft, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 }), { recv: false });
    }
    // posts (instanced)
    {
      const posts = []; for (let i = 0; i < N; i += 3) for (const s of [1, -1]) posts.push([i, s]);
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 4.2, 0.1).translate(0, 2.1, 0), new THREE.MeshStandardMaterial({ color: '#8b9099', roughness: 0.5, metalness: 0.6 }), posts.length);
      const m = new THREE.Matrix4();
      posts.forEach(([i, s], k) => { const l = (s > 0 ? T.limL[i] : T.limR[i]) + 0.45; m.makeTranslation(T.px[i] + T.nx[i] * s * l, 0, T.pz[i] + T.nz[i] * s * l); im.setMatrixAt(k, m); });
      G.add(im);
    }
    // start line + grid
    { const sl = add(ribbon(T, N - 1, 1, [col(W, 0.04, 0), col(-W, 0.04, 1)], 2), new THREE.MeshStandardMaterial({ map: tx.checker, roughness: 0.6 })); sl.renderOrder = 1;
      const gm = new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.6 });
      const gg = new THREE.BufferGeometry();
      const slotGeo = mergeGeometries([new THREE.PlaneGeometry(2.6, 0.25).rotateX(-Math.PI / 2), new THREE.PlaneGeometry(0.2, 1.2).rotateX(-Math.PI / 2).translate(1.2, 0, -0.6), new THREE.PlaneGeometry(0.2, 1.2).rotateX(-Math.PI / 2).translate(-1.2, 0, -0.6)]);
      const im = new THREE.InstancedMesh(slotGeo, gm, 22); const d = new THREE.Object3D();
      for (let s2 = 0; s2 < 22; s2++) { const back = 8 + s2 * 8, i = (N - Math.round(back / DS) + 1) % N, lane = (s2 % 2 === 0 ? 1 : -1) * 3.2; d.position.set(T.px[i] + T.nx[i] * lane, 0.04, T.pz[i] + T.nz[i] * lane); d.rotation.set(0, Math.atan2(T.tx[i], T.tz[i]), 0); d.updateMatrix(); im.setMatrixAt(s2, d.matrix); }
      im.receiveShadow = true; G.add(im); gg.dispose(); }

    /* ----- trackside structures ----- */
    const frameAt = (i, lat, y = 0) => { const o = new THREE.Object3D(); o.position.set(T.px[i] + T.nx[i] * lat, y, T.pz[i] + T.nz[i] * lat); o.rotation.y = Math.atan2(T.tx[i], T.tz[i]); return o; };
    const steel = new THREE.MeshStandardMaterial({ color: '#2a2e36', roughness: 0.5, metalness: 0.6 });
    const white = new THREE.MeshStandardMaterial({ color: '#eef0f2', roughness: 0.6 });
    // gantry with start lights
    {
      const gi = 4, fr = frameAt(gi, 0); G.add(fr); const span2 = W + 2.6;
      for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 0.5).translate(0, 4, 0), steel); p.position.x = sx * span2; p.castShadow = true; fr.add(p); }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(span2 * 2 + 0.6, 1.0, 0.7), steel); beam.position.y = 7.6; beam.castShadow = true; fr.add(beam);
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(span2 * 2, 0.9), new THREE.MeshStandardMaterial({ map: tx.ads, roughness: 0.6 })); banner.position.set(0, 8.6, 0); banner.rotation.y = Math.PI; fr.add(banner);
      for (let k = 0; k < 5; k++) {
        const x = (k - 2) * 1.35;
        const pod = new THREE.Mesh(new THREE.BoxGeometry(1.05, 2.0, 0.5), new THREE.MeshStandardMaterial({ color: '#0b0b0e', roughness: 0.4 })); pod.position.set(x, 6.2, 0); fr.add(pod);
        const mat = new THREE.MeshStandardMaterial({ color: '#160404', emissive: '#ff1010', emissiveIntensity: 0, roughness: 0.3 });
        for (const y of [6.68, 5.78]) { const c = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), mat); c.position.set(x, y, -0.26); c.rotation.y = Math.PI; fr.add(c); }
        this.gantryLights.push(mat);
      }
    }
    // pit building on the side of the start straight with most room, grandstands opposite
    {
      const range = [];
      for (let k = -45; k <= 90; k++) range.push((k + N) % N);
      const room = s => Math.min(...range.map(i => s > 0 ? T.limL[i] : T.limR[i]));
      const pitSide = room(1) >= room(-1) ? 1 : -1;
      if (room(pitSide) >= T.wallOff - 0.5 || T.street) {
        const d = new THREE.Object3D(); const segs = range.filter((_, k) => k % 6 === 0);
        const mkIM = (geo, mat) => { const im = new THREE.InstancedMesh(geo, mat, segs.length); im.castShadow = q > 0; im.receiveShadow = true; G.add(im); return im; };
        const lower = mkIM(new THREE.BoxGeometry(14, 6, 12.4).translate(0, 3, 0), white);
        const door = mkIM(new THREE.PlaneGeometry(10.5, 4.6).translate(0, 2.3, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 }));
        const upper = mkIM(new THREE.BoxGeometry(14, 4, 12.4).translate(0, 8, 0), new THREE.MeshPhysicalMaterial({ color: '#1e2a38', roughness: 0.08, metalness: 0.5, emissive: th.night ? '#ffd9a0' : '#000000', emissiveIntensity: th.night ? 0.25 : 0 }));
        const roof = mkIM(new THREE.BoxGeometry(17, 0.5, 12.4).translate(0, 10.25, 0), white);
        const tc = new THREE.Color();
        segs.forEach((i, k) => {
          const lat = pitSide * ((pitSide > 0 ? T.limL[i] : T.limR[i]) + 22);
          d.position.set(T.px[i] + T.nx[i] * lat, 0, T.pz[i] + T.nz[i] * lat); d.rotation.set(0, Math.atan2(T.tx[i], T.tz[i]) + Math.PI / 2, 0); d.scale.set(1, 1, 1); d.updateMatrix();
          lower.setMatrixAt(k, d.matrix); upper.setMatrixAt(k, d.matrix); roof.setMatrixAt(k, d.matrix);
          const dd = d.clone(); dd.translateX(-pitSide * 7.02); dd.rotateY(-pitSide * Math.PI / 2); dd.updateMatrix(); door.setMatrixAt(k, dd.matrix);
          tc.set(teamColors[Math.floor(k / 2) % teamColors.length]); door.setColorAt(k, tc);
        });
        // pit lane asphalt + pit wall
        const lim = sideLim(T, pitSide);
        add(ribbon(T, range[0], range.length - 1, [i => [pitSide * (lim(i) + 0.5), 0.015, 0], i => [pitSide * (lim(i) + 15), 0.015, 2]], 6), new THREE.MeshStandardMaterial({ map: tx.asphalt, color: '#9a9ca3', roughness: 0.9 }));
        add(ribbon(T, range[0], range.length - 1, [i => [pitSide * (lim(i) + 15), 0.015, 0], i => [pitSide * (lim(i) + 15.3), 0.015, 1]], 4), lineMat);
      }
      // grandstands
      const stand = (i, s, L) => {
        const lim = s > 0 ? T.limL[i] : T.limR[i]; const fr = frameAt(i, s * (lim + 4)); G.add(fr);
        const crowdMat = new THREE.MeshStandardMaterial({ map: tx.crowd, roughness: 0.9, emissive: th.night ? '#ffffff' : '#000000', emissiveMap: th.night ? tx.crowd : null, emissiveIntensity: 0.12 });
        for (let k = 0; k < 7; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.3 * (k + 1), L), crowdMat); b.position.set(s * (1.2 + k * 2.4), 0.65 * (k + 1), 0); b.castShadow = q > 0; b.receiveShadow = true; fr.add(b); }
        const roof = new THREE.Mesh(new THREE.BoxGeometry(20, 0.35, L + 3), white); roof.position.set(s * 8.4, 12.8, 0); roof.rotation.z = s * 0.1; roof.castShadow = q > 0; fr.add(roof);
        for (const z of [-L / 2, -L / 6, L / 6, L / 2]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 13.5, 0.4).translate(0, 6.75, 0), steel); p.position.set(s * 17.6, 0, z); fr.add(p); }
      };
      const opp = -pitSide;
      if ((opp > 0 ? T.limL[30] : T.limR[30]) >= T.wallOff - 0.5 || T.street) { stand(Math.round(30 / DS) % N, opp, 70); stand((N - Math.round(50 / DS)) % N, opp, 60); }
      // stands outside the 3 sharpest corners
      const corners = T.kerbs.map(([a, b]) => { let mi = a, mk = 0; for (let i = a; i <= b; i++) { const k = Math.abs(T.curv[i % N]); if (k > mk) { mk = k; mi = i % N; } } return { i: mi, k: mk, s: T.curv[mi] > 0 ? -1 : 1 }; }).sort((a, b) => b.k - a.k);
      let placed = 0;
      for (const c of corners) { if (placed >= 3) break; if (Math.min(Math.abs(c.i), N - c.i) < 120) continue; const lim = c.s > 0 ? T.limL[c.i] : T.limR[c.i]; if (lim < T.wallOff - 1 && !T.street) continue; stand(c.i, c.s, 50); placed++; }
    }
    // sponsor bridge over a straight
    {
      let best = -1, bestLen = 0, run = 0;
      for (let i = 0; i < N; i++) { if (Math.abs(T.curv[i]) < 1 / 900) run++; else run = 0; if (run > bestLen && i > 200 && i < N - 200) { bestLen = run; best = i - Math.floor(run / 2); } }
      if (best > 0 && bestLen > 50) {
        const fr = frameAt(best, 0); G.add(fr); const sp2 = Math.max(T.limL[best], T.limR[best]) + 1;
        for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 9, 1.2).translate(0, 4.5, 0), steel); p.position.x = sx * sp2; p.castShadow = q > 0; fr.add(p); }
        const bm = new THREE.MeshStandardMaterial({ map: tx.ads, roughness: 0.5, emissive: th.night ? '#ffffff' : '#000000', emissiveMap: th.night ? tx.ads : null, emissiveIntensity: 0.6 });
        const b = new THREE.Mesh(new THREE.BoxGeometry(sp2 * 2 + 1.2, 2.2, 1.0), [steel, steel, steel, steel, bm, bm]); b.position.y = 8.6; b.castShadow = q > 0; fr.add(b);
      }
    }
    // floodlights
    if (th.night || th.lights) {
      const poles = []; for (let i = 0; i < N; i += 38) for (const s of [1, -1]) poles.push([i, s]);
      const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.32, 22, 6).translate(0, 11, 0), steel, poles.length);
      const head = new THREE.InstancedMesh(new THREE.BoxGeometry(3.4, 1.2, 0.5).translate(0, 22, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4dc').multiplyScalar(4), toneMapped: false, fog: false }), poles.length);
      const d = new THREE.Object3D();
      poles.forEach(([i, s], k) => { const l = (s > 0 ? T.limL[i] : T.limR[i]) + 3; d.position.set(T.px[i] + T.nx[i] * s * l, 0, T.pz[i] + T.nz[i] * s * l); d.rotation.set(0, Math.atan2(T.tx[i], T.tz[i]), 0); d.updateMatrix(); pole.setMatrixAt(k, d.matrix); head.setMatrixAt(k, d.matrix); });
      G.add(pole, head);
    }

    /* ----- scenery ----- */
    const mult = q === 0 ? 0.35 : q === 1 ? 1 : 1.6;
    const wl = th.water ? th.water.level + 1.5 : -1e9;
    const scatter = (count, minD, extent, maxD = 1e9) => {
      const out = []; let tries = 0;
      while (out.length < count && tries < count * 10) {
        tries++;
        const x = T.minX - extent + r() * (T.maxX - T.minX + 2 * extent), z = T.minZ - extent + r() * (T.maxZ - T.minZ + 2 * extent);
        const d = dist(x, z); if (d < minD || d > maxD) continue;
        const h = height(x, z); if (h < wl) continue;
        out.push([x, h, z, d]);
      }
      return out;
    };
    const inst = (geo, mat, list, fn, { cast = true, colors = null } = {}) => {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(geo, mat, list.length), d = new THREE.Object3D(), c = new THREE.Color();
      list.forEach((p, k) => { d.position.set(p[0], p[1], p[2]); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); fn(d, p, k); d.updateMatrix(); im.setMatrixAt(k, d.matrix); if (colors) { c.set(colors[k % colors.length]).offsetHSL(0, 0, (r() - 0.5) * 0.08); im.setColorAt(k, c); } });
      im.castShadow = cast && q > 0; im.receiveShadow = true; G.add(im); return im;
    };
    const sc2 = th.scenery, minTree = T.wallOff + 9;
    const bark = new THREE.MeshStandardMaterial({ color: '#5a4030', roughness: 0.95 });
    const leaf = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true });
    if (sc2.trees) {
      const pts = scatter(Math.round(sc2.trees * mult), minTree, 900);
      const crown = mergeGeometries([new THREE.IcosahedronGeometry(3.6, 1).translate(0, 9, 0), new THREE.IcosahedronGeometry(2.8, 1).translate(1.8, 7.5, 0.8), new THREE.IcosahedronGeometry(2.6, 1).translate(-1.6, 7.8, -0.9), new THREE.IcosahedronGeometry(2.4, 1).translate(0.2, 11.2, -0.3)]);
      const sc = pts.map(() => 0.7 + r() * 0.9), ry = pts.map(() => r() * 6.28);
      const place = (d, p, k) => { d.scale.setScalar(sc[k]); d.rotation.y = ry[k]; };
      inst(new THREE.CylinderGeometry(0.35, 0.55, 7, 6).translate(0, 3.5, 0), bark, pts, place);
      inst(crown, leaf, pts, place, { colors: th.foliage });
    }
    if (sc2.pines) {
      const pts = scatter(Math.round(sc2.pines * mult), minTree, 1000);
      const crown = mergeGeometries([new THREE.ConeGeometry(3.6, 7, 8).translate(0, 6, 0), new THREE.ConeGeometry(2.9, 6, 8).translate(0, 9.5, 0), new THREE.ConeGeometry(2, 5, 8).translate(0, 13, 0)]);
      const sc = pts.map(() => 0.75 + r() * 0.9);
      const place = (d, p, k) => { d.scale.set(sc[k], sc[k] * (0.9 + r() * 0.3), sc[k]); d.rotation.y = r() * 6.28; };
      inst(new THREE.CylinderGeometry(0.3, 0.45, 4, 6).translate(0, 2, 0), bark, pts, place);
      inst(crown, leaf, pts, place, { colors: th.snowLine === 1 ? ['#2b5a40', '#e9f0f4', '#3a6a4a'] : th.foliage });
    }
    if (sc2.palms) {
      const pts = scatter(Math.round(sc2.palms * mult), minTree - 2, 700);
      const trunkC = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.4, 5, 0), new THREE.Vector3(1.4, 10, 0), new THREE.Vector3(2.4, 13, 0)]);
      const leaves = []; for (let k = 0; k < 8; k++) { const l = new THREE.PlaneGeometry(1.4, 5.5, 1, 4); const p = l.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i) + 2.75; p.setY(i, y); p.setZ(i, -0.06 * y * y); } l.rotateX(-1.0); l.rotateY(k / 8 * Math.PI * 2); l.translate(2.4, 13, 0); leaves.push(l); }
      const lg = mergeGeometries(leaves); lg.computeVertexNormals();
      const ry = pts.map(() => r() * 6.28), sc = pts.map(() => 0.8 + r() * 0.5);
      const place = (d, p, k) => { d.rotation.y = ry[k]; d.scale.setScalar(sc[k]); };
      inst(new THREE.TubeGeometry(trunkC, 12, 0.32, 6), new THREE.MeshStandardMaterial({ color: '#8a6a4a', roughness: 0.9 }), pts, place);
      inst(lg, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, side: THREE.DoubleSide }), pts, place, { colors: th.foliage });
    }
    if (sc2.shrubs) {
      const pts = scatter(Math.round(sc2.shrubs * mult), T.wallOff + 5, 700);
      inst(new THREE.IcosahedronGeometry(1.4, 1).scale(1.2, 0.7, 1.2).translate(0, 0.6, 0), leaf, pts, (d, p, k) => { d.scale.setScalar(0.7 + r() * 1.2); d.rotation.y = r() * 6; }, { colors: th.foliage });
    }
    if (sc2.rocks) {
      const pts = scatter(Math.round(sc2.rocks * mult), T.wallOff + 10, 1000);
      const rg = new THREE.DodecahedronGeometry(1, 1); const p = rg.attributes.position;
      for (let i = 0; i < p.count; i++) { const f = 0.8 + noise.perlin(p.getX(i) * 2.1, p.getZ(i) * 2.1 + p.getY(i)) * 0.4; p.setXYZ(i, p.getX(i) * f, p.getY(i) * f, p.getZ(i) * f); }
      rg.computeVertexNormals();
      inst(rg, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true }), pts, (d) => { const s = 2 + Math.pow(r(), 2) * 16; d.scale.set(s * (0.8 + r() * 0.6), s * (0.45 + r() * 0.7), s * (0.8 + r() * 0.6)); d.rotation.set(r() * 3, r() * 3, r() * 3); }, { colors: [th.terrain[1], th.terrain[2], th.terrain[0]] });
    }
    if (sc2.buildings) {
      const near = scatter(Math.round(sc2.buildings * 0.55 * mult), T.wallOff + 26, 300);
      const far = scatter(Math.round(sc2.buildings * 0.45 * mult), 450, 1600);
      const mat = th.night ? new THREE.MeshStandardMaterial({ color: '#2a2f3c', roughness: 0.4, metalness: 0.4, emissive: '#ffffff', emissiveMap: tx.winNight, emissiveIntensity: 0.55 })
        : new THREE.MeshStandardMaterial({ map: tx.winDay, roughness: 0.35, metalness: 0.45 });
      const pal = th.night ? ['#2a2f3c', '#252a38', '#31283f'] : ['#e8dccb', '#cdd5dd', '#d9c6b0', '#b9c3cc', '#f0e6d8', '#a9b8c8'];
      const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      inst(geo, mat, near.concat(far), (d, p) => { const fr = p[3] > 450; d.rotation.y = r() * 6; d.scale.set(16 + r() * 26, fr ? 50 + Math.pow(r(), 2) * 230 : 14 + Math.pow(r(), 2) * 90, 16 + r() * 26); }, { colors: pal });
    }
  }

  setStartLights(n) { this.gantryLights.forEach((m, k) => { m.emissiveIntensity = k < n ? 6 : 0; m.color.set(k < n ? '#ff2a2a' : '#160404'); }); }

  update(dt, focus, camera) {
    if (this.clouds) { this.cloudTex.offset.x += dt * 0.0015; this.cloudTex.offset.y += dt * 0.0006; }
    for (const w of this.waters) { w.offset.x += dt * 0.01; w.offset.y += dt * 0.006; }
    this.nightSky.position.copy(camera.position); this.stars.position.copy(camera.position);
    if (this.moon.visible) { this.moon.position.copy(camera.position).addScaledVector(this.sunDir, 12000); this.moon.lookAt(camera.position); }
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 400); this.sun.target.position.copy(focus);
  }
}

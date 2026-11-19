import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { W, KERB, DS, bankH, elevAt } from './tracks.js?v=95106973';
import { rng, makeNoise, canvasTex, normalTex, noiseFill, smooth, clamp } from './util.js?v=95106973';

const TMP_GREY = new THREE.Color('#8b939c');
const AD_WORDS = ['APEX GP', 'NOVA FUEL', 'KITE TYRES', 'ORBITAL', 'HELIX', 'SUMMIT', 'VOLTA', 'RAPIDE', 'ZENITH', 'TORQUE+'];

/* ---------------- shared textures ---------------- */
let TX = null;
function textures() {
  if (TX) return TX;
  const r = rng(5);
  TX = {};
  TX.asphalt = canvasTex(512, 512, (g, w, h) => noiseFill(g, w, h, '#4a4c51', 30, 3, 0.05));
  TX.asphaltN = normalTex(512, 512, (g, w, h) => noiseFill(g, w, h, '#808080', 90, 4, 0.08), 2.2);
  TX.kerbFor = (a, b) => TX['kerb' + a + b] || (TX['kerb' + a + b] = canvasTex(64, 128, (g, w, h) => { g.fillStyle = a; g.fillRect(0, 0, w, h / 2); g.fillStyle = b; g.fillRect(0, h / 2, w, h / 2); const id = g.getImageData(0, 0, w, h); for (let i = 0; i < id.data.length; i += 4) { const n = (r() - 0.5) * 18; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; } g.putImageData(id, 0, 0); }));
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
      pos[j * 3] = T.px[i] + T.nx[i] * o; pos[j * 3 + 1] = y + bankH(T, i, o); pos[j * 3 + 2] = T.pz[i] + T.nz[i] * o;
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
    this.base = { sun: this.sun.intensity, hemi: this.hemi.intensity, exposure: th.exposure, fog: th.fogDensity, fogColor: new THREE.Color(th.fog), turb: th.turbidity, ray: th.rayleigh, env: this.scene.environmentIntensity };
    this.sun.castShadow = q > 0;
    const sm = q >= 2 ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x !== sm) { this.sun.shadow.mapSize.set(sm, sm); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } }
    const sc = this.sun.shadow.camera; sc.left = sc.bottom = -70; sc.right = sc.top = 70; sc.near = 1; sc.far = 900; sc.updateProjectionMatrix();

    /* ----- distance field + terrain ----- */
    const span = Math.max(T.maxX - T.minX, T.maxZ - T.minZ) + 4600;
    const x0 = T.cx - span / 2, z0 = T.cz - span / 2;
    const DF = 200, cell = span / DF, df = new Float32Array((DF + 1) * (DF + 1)), ef = new Float32Array((DF + 1) * (DF + 1));
    for (let j = 0; j <= DF; j++) for (let i = 0; i <= DF; i++) {
      const x = x0 + i * cell, z = z0 + j * cell; let m = 1e12, mk = 0;
      for (let k = 0; k < N; k += 4) { const dx = x - T.px[k], dz = z - T.pz[k], d = dx * dx + dz * dz; if (d < m) { m = d; mk = k; } }
      df[j * (DF + 1) + i] = Math.sqrt(m); ef[j * (DF + 1) + i] = elevAt(T, mk);
    }
    // elevation of the nearest part of the track, so the land rises and falls with it
    const elevNear = (x, z) => {
      const fx = clamp((x - x0) / cell, 0, DF - 0.001), fz = clamp((z - z0) / cell, 0, DF - 0.001), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, R = DF + 1;
      return (ef[j * R + i] * (1 - u) + ef[j * R + i + 1] * u) * (1 - v) + (ef[(j + 1) * R + i] * (1 - u) + ef[(j + 1) * R + i + 1] * u) * v;
    };
    const dist = (x, z) => {
      const fx = clamp((x - x0) / cell, 0, DF - 0.001), fz = clamp((z - z0) / cell, 0, DF - 0.001), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, R = DF + 1;
      return (df[j * R + i] * (1 - u) + df[j * R + i + 1] * u) * (1 - v) + (df[(j + 1) * R + i] * (1 - u) + df[(j + 1) * R + i + 1] * u) * v;
    };
    this.dist = dist;
    const flat = T.wallOff + (T.street ? 70 : 45), amp = th.hillAmp;
    const wdir = th.water && th.water.mode === 'side' ? [Math.cos(th.water.angle), Math.sin(th.water.angle)] : null;
    const height = (x, z) => {
      const d = dist(x, z), t = smooth(flat, flat + 600, d), base = T.elev ? elevNear(x, z) - 0.6 * (1 - smooth(T.wallOff, flat, d)) : 0;
      if (t <= 0) return base;
      let h;
      const sx = x / 1000, sz = z / 1000;
      switch (th.relief) {
        case 'mountains': { const rr2 = noise.ridge(sx * 0.7, sz * 0.7, 5); h = (Math.pow(rr2, 2.2) * amp + noise.fbm(sx * 3, sz * 3, 3) * 30) * smooth(flat, flat + 1800, d) + 15; break; }
        case 'mesa': { const n = noise.fbm(sx * 1.3, sz * 1.3, 4) * 1.6 + 0.35; const v = clamp(n, 0, 1) * 3; h = amp * (Math.floor(v) + smooth(0.78, 0.96, v % 1)) / 3 + noise.fbm(sx * 8, sz * 8, 2) * 6; break; }
        case 'dunes': { h = (noise.ridge(sx * 2.2, sz * 1.1, 3) - 0.45) * amp + noise.fbm(sx, sz, 3) * amp * 0.8 + amp * 0.3; break; }
        case 'flat': h = noise.fbm(sx * 2, sz * 2, 3) * amp + amp * 0.2; break;
        default: h = (noise.fbm(sx * 1.1, sz * 1.1, 5) * 0.9 + 0.35) * amp;
      }
      h = h * t + base;
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
    this.roadMesh = add(ribbon(T, 0, N, roadCols, 6, { colorFn: (i, o) => { const d = (o - T.race[i]) / 1.5; return 0.92 * (1 - 0.26 * Math.exp(-d * d)) * (Math.abs(o) > W - 0.9 ? 1.08 : 1); } }),
      new THREE.MeshStandardMaterial({ map: tx.asphalt, normalMap: tx.asphaltN, normalScale: new THREE.Vector2(0.6, 0.6), vertexColors: true, roughness: 0.86, metalness: 0, color: th.night ? '#c9ccd6' : '#ffffff' }));
    const lineMat = new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.6, map: tx.paint });
    for (const s of [1, -1]) add(ribbon(T, 0, N, [col(s * (W - 0.15), 0.035, 0), col(s * (W - 0.45), 0.035, 1)], 4), lineMat);
    // verges / run-off
    const vergeMat = T.street ? new THREE.MeshStandardMaterial({ map: tx.asphalt, normalMap: tx.asphaltN, color: '#7d7f86', roughness: 0.9 })
      : new THREE.MeshStandardMaterial({ map: tx.verge, color: th.grass, roughness: 1 });
    for (const s of [1, -1]) add(ribbon(T, 0, N, [col(s * W, 0.01, 0), i => [s * (sideLim(T, s)(i) + 0.3), 0.01, 1]], T.street ? 6 : 16), vergeMat);
    // kerbs
    const kerbMat = new THREE.MeshStandardMaterial({ map: tx.kerbFor(...(T.def.kerb || ['#c8202a', '#f1f1f1'])), roughness: 0.55 });
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
    // barriers: armco (circuits) or concrete with ad boards (streets), plus debris fence.
    // On the pit side the wall has gaps at pit entry and exit; between them it becomes the pit wall.
    const P = T.pit;
    const segsFor = s => s !== P.side ? [[0, N]] : [[P.exit, (P.entry - P.exit + N) % N], [(P.entry + 40) % N, ((P.exit - 40) - (P.entry + 40) + 2 * N) % N]];
    const inPitGap = (i, s) => s === P.side && (((i - P.entry + N) % N) < 40 || ((P.exit - i + N) % N) < 40) && ((i - P.entry + N) % N) <= P.len;
    for (const s of [1, -1]) {
      const lim = sideLim(T, s);
      const ft = tx.fence.clone(); ft.needsUpdate = true;
      const fenceMat = new THREE.MeshStandardMaterial({ map: ft, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 });
      const adMat = T.street ? new THREE.MeshStandardMaterial({ map: tx.adsWall, roughness: 0.6, emissive: th.night ? '#ffffff' : '#000000', emissiveMap: th.night ? tx.adsWall : null, emissiveIntensity: 0.3, side: THREE.DoubleSide }) : null;
      const rail = new THREE.MeshStandardMaterial({ color: '#c3c8cf', roughness: 0.3, metalness: 0.85, side: THREE.DoubleSide });
      const wallBand = new THREE.MeshStandardMaterial({ color: th.wallB, roughness: 0.6, side: THREE.DoubleSide });
      const capMat = new THREE.MeshStandardMaterial({ color: '#b8bcc4', roughness: 0.8 });
      for (const [i0, cnt] of segsFor(s)) {
        if (cnt < 2) continue;
        if (T.street) {
          add(ribbon(T, i0, cnt, [i => [s * lim(i), 0, 0], i => [s * lim(i), 1.15, 1]], 30, { up: false }), adMat, { cast: q > 0 });
          add(ribbon(T, i0, cnt, [i => [s * lim(i), 1.15, 0], i => [s * (lim(i) + 0.5), 1.15, 1]], 8), capMat);
        } else {
          add(ribbon(T, i0, cnt, [i => [s * lim(i), 0.45, 0], i => [s * lim(i), 0.78, 1]], 8, { up: false }), rail, { cast: q > 0 });
          add(ribbon(T, i0, cnt, [i => [s * lim(i), 0.9, 0], i => [s * lim(i), 1.15, 1]], 8, { up: false }), rail);
          add(ribbon(T, i0, cnt, [i => [s * (lim(i) + 0.05), 0, 0], i => [s * (lim(i) + 0.05), 0.45, 1]], 8, { up: false }), wallBand);
        }
        add(ribbon(T, i0, cnt, [i => [s * (lim(i) + 0.4), 1.15, 0], i => [s * (lim(i) + 0.4), 4.2, 1]], 3.05, { up: false }), fenceMat, { recv: false });
      }
    }
    if (T.banked) for (const s of [1, -1]) {
      const lim = sideLim(T, s);
      add(ribbon(T, 0, N, [i => [s * (lim(i) + 0.5), 0, 0], i => [s * (lim(i) + 0.5 + Math.max(2, bankH(T, i, s * lim(i)) * 2.2)), -bankH(T, i, s * (lim(i) + 0.5 + Math.max(2, bankH(T, i, s * lim(i)) * 2.2))), 1]], 12), new THREE.MeshStandardMaterial({ map: tx.verge, color: th.grass, roughness: 1, side: THREE.DoubleSide }));
    }
    // posts (instanced)
    {
      const posts = []; for (let i = 0; i < N; i += 3) for (const s of [1, -1]) if (!inPitGap(i, s)) posts.push([i, s]);
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 4.2, 0.1).translate(0, 2.1, 0), new THREE.MeshStandardMaterial({ color: '#8b9099', roughness: 0.5, metalness: 0.6 }), posts.length);
      const m = new THREE.Matrix4();
      posts.forEach(([i, s], k) => { const l = (s > 0 ? T.limL[i] : T.limR[i]) + 0.45; m.makeTranslation(T.px[i] + T.nx[i] * s * l, bankH(T, i, s * l), T.pz[i] + T.nz[i] * s * l); im.setMatrixAt(k, m); });
      G.add(im);
    }
    // start line + grid
    { const sl = add(ribbon(T, N - 1, 1, [col(W, 0.04, 0), col(-W, 0.04, 1)], 2), new THREE.MeshStandardMaterial({ map: tx.checker, roughness: 0.6 })); sl.renderOrder = 1;
      const gm = new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.6 });
      const gg = new THREE.BufferGeometry();
      const slotGeo = mergeGeometries([new THREE.PlaneGeometry(2.6, 0.25).rotateX(-Math.PI / 2), new THREE.PlaneGeometry(0.2, 1.2).rotateX(-Math.PI / 2).translate(1.2, 0, -0.6), new THREE.PlaneGeometry(0.2, 1.2).rotateX(-Math.PI / 2).translate(-1.2, 0, -0.6)]);
      const im = new THREE.InstancedMesh(slotGeo, gm, 22); const d = new THREE.Object3D();
      for (let s2 = 0; s2 < 22; s2++) { const back = 8 + s2 * 8, i = (N - Math.round(back / DS) + 1) % N, lane = (s2 % 2 === 0 ? 1 : -1) * 3.2; d.position.set(T.px[i] + T.nx[i] * lane, bankH(T, i, lane) + 0.04, T.pz[i] + T.nz[i] * lane); d.rotation.set(0, Math.atan2(T.tx[i], T.tz[i]), 0); d.updateMatrix(); im.setMatrixAt(s2, d.matrix); }
      im.receiveShadow = true; G.add(im); gg.dispose(); }

    /* ----- racing line (green = full throttle, yellow = lift, red = brake) ----- */
    {
      const g = ribbon(T, 0, N, [i => [T.race[i] + 0.35, 0.045, 0], i => [T.race[i] - 0.35, 0.045, 1]], 4);
      const cols = new Float32Array(g.attributes.position.count * 3), c = new THREE.Color();
      for (let k = 0; k <= N; k++) {
        const i = k % N, ahead = T.vprof[(i + 12) % N], here = T.vprof[i];
        if (ahead < here - 0.6) c.set('#ff2a2a'); else if (here < 88) c.set('#ffd21a'); else c.set('#2bff6a');
        for (let col2 = 0; col2 < 2; col2++) cols.set([c.r, c.g, c.b], (k * 2 + col2) * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      this.raceLine = add(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }), { recv: false });
      this.raceLine.renderOrder = 2;
      this.raceLine.visible = !!this.showLine;
    }
    /* ----- pit-entry guide line (shown when the player is boxing) ----- */
    {
      const P = T.pit, edge = P.side * (W + 0.6), lead = 80, len = lead + P.limIn + 4;
      const latAt = i => {
        const before = (P.entry - i + N) % N, kk = (i - P.entry + N) % N;
        if (before > 0 && before <= lead) return T.race[i] + (edge - T.race[i]) * smooth(lead, 0, before);
        return edge + (P.fast - edge) * smooth(0, P.limIn - 6, kk);
      };
      const g = ribbon(T, (P.entry - lead + N) % N, len, [i => [latAt(i) + 0.5, 0.05, 0], i => [latAt(i) - 0.5, 0.05, 1]], 4);
      this.pitGuide = add(g, new THREE.MeshBasicMaterial({ color: new THREE.Color('#1fa2ff').multiplyScalar(1.6), transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false, fog: false }), { recv: false });
      this.pitGuide.renderOrder = 3; this.pitGuide.visible = false;
    }
    /* ----- DRS detection / activation lines and boards ----- */
    {
      const lineM = new THREE.MeshStandardMaterial({ color: '#f4f4f4', roughness: 0.6 });
      const signTex = (txt, bg) => canvasTex(256, 128, (g2, w, h) => { g2.fillStyle = bg; g2.fillRect(0, 0, w, h); g2.fillStyle = '#111'; g2.font = '800 54px "Barlow Condensed", Arial'; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText(txt, w / 2, h / 2 + 3); }, { repeat: false });
      const detTex = signTex('DRS DETECTION', '#f4f4f4'), actTex = signTex('DRS', '#22e05a');
      for (const z of T.drs) {
        for (const [i, tex] of [[z.detect, detTex], [z.start, actTex]]) {
          add(ribbon(T, i, 1, [col(W, 0.043, 0), col(-W, 0.043, 1)], 2), lineM).scale.set(1, 1, 1);
          const lim = T.limR[i];
          const fr = new THREE.Object3D(); fr.position.set(T.px[i] - T.nx[i] * (lim + 1.2), elevAt(T, i), T.pz[i] - T.nz[i] * (lim + 1.2)); fr.rotation.y = Math.atan2(T.tx[i], T.tz[i]); G.add(fr);
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.12).translate(0, 1.3, 0), new THREE.MeshStandardMaterial({ color: '#555b66' })); fr.add(post);
          const board = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: th.night ? '#ffffff' : '#000000', emissiveMap: th.night ? tex : null, emissiveIntensity: 0.6 }));
          board.position.set(0, 3.0, 0.08); board.rotation.y = Math.PI; fr.add(board);
        }
      }
    }

    /* ----- trackside structures ----- */
    const frameAt = (i, lat, y = elevAt(T, i)) => { const o = new THREE.Object3D(); o.position.set(T.px[i] + T.nx[i] * lat, y, T.pz[i] + T.nz[i] * lat); o.rotation.y = Math.atan2(T.tx[i], T.tz[i]); return o; };
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
    // pit lane, garages and team boxes alongside the start straight
    {
      const ps = P.side, range = []; for (let i = P.entry; i !== P.exit; i = (i + 1) % N) range.push(i);
      const outer = P.outer;
      const pitMat = new THREE.MeshStandardMaterial({ map: tx.asphalt, color: '#a3a6ad', roughness: 0.9 });
      add(ribbon(T, P.entry, range.length, [() => [ps * (W + KERB), 0.016, 0], () => [ps * outer, 0.016, 2]], 6), pitMat);
      add(ribbon(T, P.entry, range.length, [() => [ps * (P.wall + 5.1), 0.02, 0], () => [ps * (P.wall + 5.3), 0.02, 1]], 4), lineMat);
      // pit-lane speed limit lines
      for (const k of [P.limIn, P.limOut]) add(ribbon(T, (P.entry + k) % N, 1, [() => [ps * (W + KERB), 0.021, 0], () => [ps * outer, 0.021, 1]], 2), new THREE.MeshStandardMaterial({ color: '#2563eb', roughness: 0.7 }));
      const conc = new THREE.MeshStandardMaterial({ color: '#c9cdd3', roughness: 0.85, side: THREE.DoubleSide });
      add(ribbon(T, P.entry, range.length, [() => [ps * outer, 0, 0], () => [ps * outer, 1.1, 1]], 8, { up: false }), conc);
      // team boxes
      const boxMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 });
      const tc = new THREE.Color(), d = new THREE.Object3D();
      const boxes = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.2, 5.6).rotateX(-Math.PI / 2), boxMat, teamColors.length + 1);
      for (let k = 0; k <= teamColors.length; k++) {
        const i = (P.boxStart + k * P.boxGap) % N; d.position.set(T.px[i] + T.nx[i] * P.lat, bankH(T, i, P.lat) + 0.025, T.pz[i] + T.nz[i] * P.lat); d.rotation.set(0, Math.atan2(T.tx[i], T.tz[i]), 0); d.updateMatrix();
        boxes.setMatrixAt(k, d.matrix); tc.set(k === teamColors.length ? '#ffcc00' : teamColors[k]).multiplyScalar(0.8); boxes.setColorAt(k, tc);
      }
      boxes.receiveShadow = true; G.add(boxes);
      const segs = range.filter((_, k) => k % 6 === 0 && k > 30 && k < range.length - 30);
      const mkIM = (geo, mat) => { const im = new THREE.InstancedMesh(geo, mat, Math.max(1, segs.length)); im.castShadow = q > 0; im.receiveShadow = true; G.add(im); return im; };
      const lower = mkIM(new THREE.BoxGeometry(14, 6, 12.4).translate(0, 3, 0), white);
      const door = mkIM(new THREE.PlaneGeometry(10.5, 4.6).translate(0, 2.3, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 }));
      const upper = mkIM(new THREE.BoxGeometry(14, 4, 12.4).translate(0, 8, 0), new THREE.MeshPhysicalMaterial({ color: '#1e2a38', roughness: 0.08, metalness: 0.5, emissive: th.night ? '#ffd9a0' : '#000000', emissiveIntensity: th.night ? 0.25 : 0 }));
      const roof = mkIM(new THREE.BoxGeometry(17, 0.5, 12.4).translate(0, 10.25, 0), white);
      segs.forEach((i, k) => {
        const lat = ps * (outer + 6.3);
        d.position.set(T.px[i] + T.nx[i] * lat, bankH(T, i, lat), T.pz[i] + T.nz[i] * lat); d.rotation.set(0, Math.atan2(T.tx[i], T.tz[i]) + Math.PI / 2, 0); d.updateMatrix();
        lower.setMatrixAt(k, d.matrix); upper.setMatrixAt(k, d.matrix); roof.setMatrixAt(k, d.matrix);
        const dd = d.clone(); dd.translateX(-ps * 7.02); dd.rotateY(-ps * Math.PI / 2); dd.updateMatrix(); door.setMatrixAt(k, dd.matrix);
        tc.set(teamColors[Math.floor(k / 2) % teamColors.length]); door.setColorAt(k, tc);
      });
      const pitSide = ps;
      {
        const body = mergeGeometries([
          new THREE.BoxGeometry(0.15, 0.86, 0.17).translate(-0.11, 0.43, 0), new THREE.BoxGeometry(0.15, 0.86, 0.17).translate(0.11, 0.43, 0),
          new THREE.BoxGeometry(0.44, 0.62, 0.26).translate(0, 1.17, 0),
          new THREE.BoxGeometry(0.12, 0.62, 0.13).translate(-0.29, 1.12, 0), new THREE.BoxGeometry(0.12, 0.62, 0.13).translate(0.29, 1.12, 0),
          new THREE.SphereGeometry(0.16, 12, 10).translate(0, 1.66, 0)]);
        const teams = teamColors.length + 1, per = 14;
        this.crewColors = teamColors.concat(['#ffcc00']); this.crewG = G; this.stopCrews = new Map();
        this.crew = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7 }), teams * per);
        this.crewInfo = { T, per, teams };
        const tc2 = new THREE.Color();
        for (let t = 0; t < teams; t++) { tc2.set(t === teamColors.length ? '#ffcc00' : teamColors[t]); for (let k = 0; k < per; k++) this.crew.setColorAt(t * per + k, tc2); this.crewPose(t, null); }
        G.add(this.crew);
      }
      // grandstands
      const stand = (i, s, L) => {
        const lim = s > 0 ? T.limL[i] : T.limR[i]; const fr = frameAt(i, s * (lim + 4), bankH(T, i, s * (lim + 4))); G.add(fr);
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
      poles.forEach(([i, s], k) => { const l = (s > 0 ? T.limL[i] : T.limR[i]) + 3; d.position.set(T.px[i] + T.nx[i] * s * l, bankH(T, i, s * l), T.pz[i] + T.nz[i] * s * l); d.rotation.set(0, Math.atan2(T.tx[i], T.tz[i]), 0); d.updateMatrix(); pole.setMatrixAt(k, d.matrix); head.setMatrixAt(k, d.matrix); });
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

  /* rain: 0..1 falling rain near the player, wet: 0..1 standing water near the player */
  setWeather(rain, wet) {
    const b = this.base; if (!b) return;
    const rm = this.roadMesh && this.roadMesh.material;
    if (rm) { rm.roughness = 0.86 - 0.62 * wet; rm.metalness = 0.15 * wet; rm.color.setScalar(this.night ? 0.79 - 0.25 * wet : 1 - 0.38 * wet); }
    this.sun.intensity = b.sun * (1 - 0.7 * rain); this.hemi.intensity = b.hemi * (1 + 0.6 * rain);
    this.scene.environmentIntensity = b.env * (1 - 0.45 * rain);
    this.renderer.toneMappingExposure = b.exposure * (1 - 0.38 * rain);
    if (this.scene.fog) { this.scene.fog.density = b.fog * (1 + 3 * rain); this.scene.fog.color.copy(b.fogColor).lerp(TMP_GREY, 0.7 * rain); }
    if (!this.night) { const u = this.sky.material.uniforms; u.turbidity.value = b.turb + 20 * rain; u.rayleigh.value = b.ray * (1 - 0.95 * rain); u.mieCoefficient.value = 0.004 + 0.03 * rain; }
    if (this.clouds) { this.clouds.material.opacity = Math.min(1, 0.7 + 0.6 * rain); this.clouds.material.color.setScalar(1 - 0.65 * rain); }
  }

  /* place a team's pit crew: idle by the garage, or around the car (stopped at its box) */
  /* active=true: the team's stop crew comes out to the box (car = the car being serviced, for its wheel positions);
     active=null: they go back to standing by the garage */
  crewPose(team, active, car) {
    if (!this.crew) return;
    const { T, per } = this.crewInfo, P = T.pit, ps = P.side, N = T.N;
    const box = (P.boxStart + team * P.boxGap) % N, tx = T.tx[box], tz = T.tz[box], nx = T.nx[box] * ps, nz = T.nz[box] * ps;
    const bx = T.px[box] + T.nx[box] * P.lat, bz = T.pz[box] + T.nz[box] * P.lat, h = Math.atan2(tx, tz), by = bankH(T, box, P.lat);
    const d = new THREE.Object3D();
    for (let k = 0; k < per; k++) {
      const along = (k - per / 2) * 0.8, side = 3.6 + (k % 2) * 0.7;
      d.position.set(bx + tx * along + nx * side, by, bz + tz * along + nz * side); d.rotation.set(0, h + Math.PI / 2 * -ps, 0);
      d.scale.setScalar(active ? 0 : 1); d.updateMatrix(); this.crew.setMatrixAt(team * per + k, d.matrix);
    }
    this.crew.instanceMatrix.needsUpdate = true;
    let sc = this.stopCrews.get(team);
    if (active) {
      if (!sc) { sc = buildStopCrew(this.crewColors[team] || '#ffcc00', ps); this.stopCrews.set(team, sc); this.crewG.add(sc.g); }
      if (car) sc.setCar(car);
      sc.g.position.set(bx, by, bz); sc.g.rotation.set(0, h, 0); sc.g.visible = true; sc.anim(-1);
    } else if (sc) sc.g.visible = false;
  }
  /* s < 0: waiting for the car; 0..1: through the stop; > 1: car released */
  crewAnim(team, s) { const sc = this.stopCrews && this.stopCrews.get(team); if (sc && sc.g.visible) sc.anim(s); }
  resetCrews() { if (!this.crew) return; for (let t = 0; t < this.crewInfo.teams; t++) this.crewPose(t, null); }

  setRaceLine(on) { this.showLine = on; if (this.raceLine) this.raceLine.visible = on; }

  setStartLights(n) { this.gantryLights.forEach((m, k) => { m.emissiveIntensity = k < n ? 6 : 0; m.color.set(k < n ? '#ff2a2a' : '#160404'); }); }

  update(dt, focus, camera) {
    if (this.clouds) { this.cloudTex.offset.x += dt * 0.0015; this.cloudTex.offset.y += dt * 0.0006; }
    for (const w of this.waters) { w.offset.x += dt * 0.01; w.offset.y += dt * 0.006; }
    this.nightSky.position.copy(camera.position); this.stars.position.copy(camera.position);
    if (this.moon.visible) { this.moon.position.copy(camera.position).addScaledVector(this.sunDir, 12000); this.moon.lookAt(camera.position); }
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 400); this.sun.target.position.copy(focus);
  }
}

/* ------------------------------------------------------------------
   Pit stop crew: 17 people in team overalls with helmets. Wheel-gun
   operators, tyre-off and tyre-on carriers, front and rear jacks,
   two stabilisers and a release man with a lollipop board.
   Positions are in the car's frame: +z forward, +x towards the garage
   when ps > 0.
   ------------------------------------------------------------------ */
const CREW_MATS = {};
function crewMats(color) {
  if (!CREW_MATS[color]) CREW_MATS[color] = {
    suit: new THREE.MeshStandardMaterial({ color, roughness: 0.75 }),
    trim: new THREE.MeshStandardMaterial({ color: '#f2f4f7', roughness: 0.7 }),
    dark: new THREE.MeshStandardMaterial({ color: '#16181d', roughness: 0.6 }),
    helmet: new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.2 }),
    visor: new THREE.MeshStandardMaterial({ color: '#0b0d12', roughness: 0.1, metalness: 0.6 }),
    steel: new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.35, metalness: 0.8 }),
    tyre: new THREE.MeshStandardMaterial({ color: '#131417', roughness: 0.9 }),
    rim: new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.4, metalness: 0.7 }),
    red: new THREE.MeshStandardMaterial({ color: '#e11d1d', roughness: 0.5, emissive: '#e11d1d', emissiveIntensity: 0.25 }),
    green: new THREE.MeshStandardMaterial({ color: '#16c35a', roughness: 0.5, emissive: '#16c35a', emissiveIntensity: 0.35 }),
  };
  return CREW_MATS[color];
}
const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; return o; };
function makeTyre(M) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.36, 20), M.tyre); t.rotation.z = Math.PI / 2; t.castShadow = true;
  const r = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.37, 16), M.rim); r.rotation.z = Math.PI / 2;
  g.add(t, r); return g;
}
function makePerson(M) {
  const g = new THREE.Group(), hips = new THREE.Group(); hips.position.y = 0.86; g.add(hips);
  const leg = x => { const p = new THREE.Group(); p.position.set(x, 0, 0); p.add(box(0.15, 0.82, 0.17, M.suit, 0, -0.41, 0), box(0.16, 0.08, 0.27, M.dark, 0, -0.82, 0.04)); hips.add(p); return p; };
  const legL = leg(-0.11), legR = leg(0.11);
  const torso = new THREE.Group(); hips.add(torso);
  torso.add(box(0.44, 0.62, 0.26, M.suit, 0, 0.31, 0), box(0.45, 0.07, 0.27, M.trim, 0, 0.06, 0), box(0.06, 0.5, 0.272, M.trim, 0, 0.33, 0));
  const arm = x => { const p = new THREE.Group(); p.position.set(x, 0.56, 0); p.add(box(0.12, 0.6, 0.13, M.suit, 0, -0.3, 0), box(0.13, 0.12, 0.14, M.dark, 0, -0.64, 0)); torso.add(p); return p; };
  const armL = arm(-0.29), armR = arm(0.29);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.165, 14, 12), M.helmet); head.position.y = 0.8; head.castShadow = true;
  const visor = box(0.22, 0.08, 0.06, M.visor, 0, 0.81, 0.13);
  torso.add(head, visor);
  return { g, hips, torso, legL, legR, armL, armR };
}
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (s, a, b) => clamp((s - a) / (b - a), 0, 1);
const ease = t => t * t * (3 - 2 * t);

function buildStopCrew(color, ps) {
  const M = crewMats(color), g = new THREE.Group(), people = [];
  let wx = 1.0, af = 1.75, ar = -1.85, nose = 3.4, tail = -2.7;
  const add = role => { const p = makePerson(M); p.role = role; g.add(p.g); people.push(p); return p; };
  // equipment
  const gun = () => { const q = new THREE.Group(); q.add(box(0.11, 0.11, 0.34, M.steel, 0, 0, 0.12), box(0.07, 0.16, 0.07, M.dark, 0, -0.1, -0.02), box(0.05, 0.05, 0.16, M.dark, 0, 0, -0.12)); q.position.set(0, -0.66, 0.05); q.rotation.x = Math.PI / 2; return q; };
  const jackBar = () => { const q = new THREE.Group(); q.add(box(0.06, 0.06, 1.5, M.steel, 0, 0, 0.75), box(0.5, 0.08, 0.14, M.dark, 0, 0, 1.5), box(0.36, 0.06, 0.06, M.dark, 0, 0, 0)); return q; };
  const wheels = [];
  for (const sx of [1, -1]) for (const front of [true, false]) {
    const w = { sx, front };
    w.gunner = add('gun'); w.gun = gun(); w.gunner.armR.add(w.gun);
    w.off = add('off'); w.oldTyre = makeTyre(M); g.add(w.oldTyre);
    w.on = add('on'); w.newTyre = makeTyre(M); g.add(w.newTyre);
    wheels.push(w);
  }
  const fj = add('fjack'), rj = add('rjack');
  const fBar = jackBar(), rBar = jackBar(); g.add(fBar, rBar);
  const stabs = [add('stab'), add('stab')];
  const rel = add('release');
  const lolly = new THREE.Group(); lolly.add(box(0.04, 1.3, 0.04, M.dark, 0, 0.65, 0));
  const signR = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.03, 20), M.red), signG = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.03, 20), M.green);
  for (const sg of [signR, signG]) { sg.rotation.z = Math.PI / 2; sg.position.y = 1.4; lolly.add(sg); }
  rel.armR.add(lolly); lolly.position.set(0, -0.66, 0.04); lolly.rotation.x = Math.PI;

  const face = (p, dx, dz) => { p.g.rotation.y = Math.atan2(dx, dz); };
  const place = (p, x, z, fx, fz) => { p.g.position.set(x, 0, z); face(p, fx - x, fz - z); };
  const pose = (p, o = {}) => {
    p.g.position.y = o.y || 0; p.hips.position.y = 0.86 + (o.crouch || 0) * -0.42;
    p.legL.rotation.x = (o.crouch || 0) * -1.3 + (o.walk || 0); p.legR.rotation.x = (o.crouch || 0) * 0.5 - (o.walk || 0);
    p.torso.rotation.x = (o.lean || 0);
    p.armL.rotation.set(o.aL || 0, 0, o.zL || 0); p.armR.rotation.set(o.aR || 0, 0, o.zR || 0);
  };
  const walk = m => m > 0 && m < 1 ? Math.sin(m * Math.PI * 6) * 0.45 : 0;
  const setCar = car => {
    const ws = car && car.wheels; if (!ws || !ws.length) return;
    let mx = 0, zf = -9, zr = 9;
    for (const w of ws) { const q = w.pivot.position; mx = Math.max(mx, Math.abs(q.x)); zf = Math.max(zf, q.z); zr = Math.min(zr, q.z); }
    wx = mx; af = zf; ar = zr; nose = af + 1.75; tail = ar - 0.95;
  };
  const anim = s => {
    const t = performance.now() / 1000;
    const ready = s < 0, st = ready ? 0 : Math.min(s, 1), after = Math.max(0, s - 1);
    const gunOn1 = seg(st, 0.1, 0.16) * (1 - seg(st, 0.27, 0.31)), gunOn2 = seg(st, 0.62, 0.66) * (1 - seg(st, 0.76, 0.8));
    const buzz = (gunOn1 > 0.9 && st < 0.27) || (gunOn2 > 0.9 && st < 0.76) ? Math.sin(t * 90) * 0.04 : 0;
    const done = ready ? 0 : seg(st, 0.86, 1);
    for (const w of wheels) {
      const az = w.front ? af : ar, sx = w.sx, out = sx * (wx + 0.55), dz = w.front ? 1 : -1;
      // wheel gun: kneels at the hub, gun on, off, on again, then stands back
      const back = ease(done) * 0.9;
      place(w.gunner, sx * (wx + 0.62 + back), az, 0, az);
      pose(w.gunner, { crouch: 1 - ease(done), aR: -(gunOn1 + gunOn2 > 0 ? 1.45 : 0.6) * (1 - done) + buzz, aL: -1.1 * (1 - done), zR: 0, lean: 0.25 * (1 - done) });
      w.gun.visible = true;
      // tyre off: grabs the old tyre and carries it clear
      const take = seg(st, 0.22, 0.27), carry = ease(seg(st, 0.28, 0.5));
      const ox = lerp(lerp(out + sx * 0.25, sx * (wx + 0.25), take), sx * (wx + 2.3), carry), oz = lerp(az + dz * 0.85 * (1 - take), az + dz * 0.6, carry);
      place(w.off, ox + sx * 0.45, oz, sx > 0 ? -50 : 50, oz);
      pose(w.off, { aL: -1.25, aR: -1.25, lean: 0.35 * (take > 0 && carry < 1 ? 1 : 0.4), walk: walk(carry) });
      w.oldTyre.visible = !ready && st >= 0.25;
      if (st < 0.5) w.oldTyre.position.set(take < 1 ? sx * wx : ox, 0.36 + (take >= 1 ? 0.45 : 0), take < 1 ? az : oz), w.oldTyre.rotation.set(0, 0, 0);
      else { w.oldTyre.position.set(sx * (wx + 2.3), 0.18, az + dz * 0.6); w.oldTyre.rotation.set(0, 0, Math.PI / 2); }
      // tyre on: waits with the new tyre, fits it, steps back
      const fit = ease(seg(st, 0.4, 0.62)), clear = ease(seg(st, 0.72, 0.86));
      const nx2 = lerp(lerp(sx * (wx + 0.95), sx * (wx + 0.35), fit), sx * (wx + 1.6), clear), nz2 = lerp(lerp(az - dz * 0.95, az, fit), az - dz * 1.0, clear);
      place(w.on, nx2 + sx * 0.4, nz2, sx > 0 ? -50 : 50, nz2);
      pose(w.on, { aL: clear > 0 ? -0.2 : -1.25, aR: clear > 0 ? -0.2 : -1.25, lean: clear > 0 ? 0 : 0.3, walk: walk(fit) + walk(clear) });
      w.newTyre.visible = st < 0.7;
      w.newTyre.position.set(nx2, 0.36 + 0.45 * (1 - fit), nz2);
    }
    // front jack: waits in front of the nose, lifts at the start and lowers at the end
    const lift = seg(st, 0.04, 0.1) * (1 - seg(st, 0.8, 0.86));
    const fjBack = ready ? 0 : ease(seg(st, 0.86, 0.98)) * 1.4 + after * 3;
    place(fj, fjBack > 0 ? ps * Math.min(fjBack, 2.4) : 0, nose + 1.2, 0, nose);
    pose(fj, { aL: -0.9 - 0.4 * lift, aR: -0.9 - 0.4 * lift, lean: 0.2 + 0.25 * lift });
    fBar.position.set(fj.g.position.x, 0.2 + 0.1 * lift, nose + 1.05); fBar.rotation.set(-0.35 + 0.2 * lift, Math.PI, 0); fBar.visible = fjBack < 0.6;
    // rear jack: runs in from the side once the car has stopped
    const rin = ready ? 0 : ease(seg(st, 0, 0.06)), rout = ease(seg(st, 0.86, 0.96));
    const rjx = lerp(ps * 2.2, 0, rin * (1 - rout)), rjz = tail - 1.15;
    place(rj, rjx, rjz, rjx, tail);
    pose(rj, { aL: -0.9 - 0.4 * lift, aR: -0.9 - 0.4 * lift, lean: 0.2 + 0.25 * lift, walk: walk(rin) + walk(rout) });
    rBar.position.set(rjx, 0.2 + 0.1 * lift, tail - 1.0); rBar.rotation.set(-0.35 + 0.2 * lift, 0, 0); rBar.visible = rin > 0.95 && rout < 0.05;
    // stabilisers hold the sidepods
    stabs.forEach((p, k) => { const sx = k ? -1 : 1, x = sx * (0.95 + (ready ? 0.6 : 0) + done * 0.6); place(p, x, (af + ar) / 2 - 0.2, 0, (af + ar) / 2 - 0.2); pose(p, { aL: ready ? -0.2 : -1.0, aR: ready ? -0.2 : -1.0, lean: ready ? 0 : 0.45, crouch: ready ? 0 : 0.35 }); });
    // release: red board down during the stop, green raised to send the car
    const go = !ready && st >= 0.9;
    place(rel, ps * (wx + 1.4), nose + 0.3, 0, nose - 1);
    pose(rel, { aR: go ? -2.9 : -1.45, aL: 0, lean: 0 });
    signR.visible = !go; signG.visible = go;
  };
  anim(-1);
  return { g, anim, setCar, lift: s => s < 0 ? 0 : 0.08 * seg(s, 0.04, 0.1) * (1 - seg(s, 0.8, 0.86)) };
}


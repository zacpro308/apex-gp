import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTex } from './util.js?v=95106973';

/* A generic open-wheeler built to the shape of the 2025 technical rules:
   ground-effect floor, undercut sidepods with downwash ramps, 4-element front wing,
   18" wheels with covers and wake deflectors, swept rear-wing tips and a beam wing.
   Front axle z = +1.80, rear axle z = -1.80 (3.6 m wheelbase), overall ~5.6 m. */
export let AXLE_F = 1.8, AXLE_R = -1.8;
export const TRACK_F = 0.8, TRACK_R = 0.79;

/* Lofted body: sections [z, halfWidth, halfHeight, centreY, superellipseExponent, xOffset?] */
function loft(secs, segs = 28) {
  const pos = [], idx = [], ring = segs;
  const pt = (s, k) => {
    const [z, hw, hh, yc, n, xo = 0] = s, t = k / ring * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t), e = 2 / n;
    return [xo + Math.sign(c) * Math.pow(Math.abs(c), e) * hw, yc + Math.sign(sn) * Math.pow(Math.abs(sn), e) * hh, z];
  };
  secs.forEach(s => { for (let k = 0; k < ring; k++) pos.push(...pt(s, k)); });
  for (let i = 0; i < secs.length - 1; i++) for (let k = 0; k < ring; k++) {
    const a = i * ring + k, b = i * ring + (k + 1) % ring, c = (i + 1) * ring + k, d = (i + 1) * ring + (k + 1) % ring;
    idx.push(a, b, c, b, d, c);
  }
  const cap = (i, front) => {
    const base = pos.length / 3, s = secs[i];
    pos.push(s[5] || 0, s[3], s[0]);
    for (let k = 0; k < ring; k++) pos.push(...pt(s, k));
    for (let k = 0; k < ring; k++) { const a = base + 1 + k, b = base + 1 + (k + 1) % ring; front ? idx.push(base, a, b) : idx.push(base, b, a); }
  };
  cap(0, false); cap(secs.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// monocoque + engine cover + long low nose
const BODY = [
  [-2.0, 0.13, 0.12, 0.40, 3], [-1.75, 0.2, 0.18, 0.46, 3], [-1.2, 0.25, 0.25, 0.54, 3], [-0.65, 0.28, 0.31, 0.6, 3],
  [-0.3, 0.3, 0.4, 0.63, 3.2], [-0.1, 0.35, 0.33, 0.53, 3.6], [0.15, 0.4, 0.26, 0.46, 4], [0.8, 0.4, 0.24, 0.44, 4],
  [1.2, 0.33, 0.2, 0.41, 3.4], [1.7, 0.22, 0.15, 0.35, 3], [2.4, 0.15, 0.11, 0.28, 2.6], [3.0, 0.11, 0.08, 0.23, 2.4],
  [3.35, 0.07, 0.055, 0.2, 2.2], [3.45, 0.03, 0.03, 0.19, 2],
];
// ground-effect sidepod: high, wide inlet; deep undercut beneath; steep downwash ramp to the rear
const POD = x => [
  [-1.45, 0.05, 0.05, 0.3, 3, x * 0.4], [-1.1, 0.14, 0.1, 0.34, 3, x * 0.48], [-0.55, 0.24, 0.16, 0.42, 3.4, x * 0.6],
  [0.1, 0.29, 0.2, 0.47, 4, x * 0.66], [0.6, 0.29, 0.19, 0.5, 4.5, x * 0.66], [0.78, 0.27, 0.17, 0.51, 4.5, x * 0.66],
];

let MODEL = null;
function buildModel() {
  const buckets = { body: [], acc: [], carbon: [], dark: [], metal: [], light: [], fw_carbon: [], fw_body: [], fw_acc: [], rw_acc: [], rw_body: [], rw_carbon: [] };
  const add = (geo, key, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (g.attributes.uv) g.deleteAttribute('uv');
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
    buckets[key].push(g);
  };
  const RB = (w, h, d, r = 0.02) => new RoundedBoxGeometry(w, h, d, 2, r);
  const plate = (pts, depth) => { const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(p => s.lineTo(p[0], p[1])); return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }); };

  add(loft(BODY), 'body');
  add(loft(POD(1), 24), 'body'); add(loft(POD(-1), 24), 'body');
  // sidepod inlets (dark mouths) and roll-hoop intake
  for (const sx of [1, -1]) add(new THREE.CircleGeometry(1, 24), 'dark', sx * 0.66, 0.5, 0.785, 0, 0, 0, 0.23, 0.13, 1);
  add(plate([[-0.13, 0], [0.13, 0], [0, 0.2]], 0.02), 'dark', 0, 0.9, -0.2);
  // cockpit opening + headrest
  add(new THREE.CircleGeometry(1, 28), 'dark', 0, 0.695, 0.5, -Math.PI / 2, 0, 0, 0.24, 0.42, 1);
  add(RB(0.48, 0.1, 0.22, 0.04), 'carbon', 0, 0.71, 0.08);
  // T-cam and antenna
  add(RB(0.12, 0.07, 0.22, 0.03), 'acc', 0, 1.06, -0.34);
  add(new THREE.CylinderGeometry(0.006, 0.006, 0.3), 'carbon', 0.08, 1.12, -0.55, 0.3);
  // small engine-cover fin
  add(plate([[0, 0], [-1.25, 0], [-1.2, 0.17], [-0.2, 0.05]], 0.016), 'body', -0.008, 0.93, -0.5, 0, -Math.PI / 2, 0);
  // wide ground-effect floor with edge wings and the fences under the nose
  add(RB(1.84, 0.04, 3.1, 0.02), 'carbon', 0, 0.07, -0.35);
  add(RB(1.15, 0.04, 0.8, 0.02), 'carbon', 0, 0.07, 1.45);
  for (const sx of [1, -1]) { add(RB(0.03, 0.09, 2.6, 0.01), 'carbon', sx * 0.92, 0.12, -0.45); add(RB(0.22, 0.02, 0.55, 0.01), 'carbon', sx * 0.84, 0.17, 0.75, 0, 0, sx * 0.35); add(RB(0.02, 0.12, 0.7, 0.01), 'carbon', sx * 0.35, 0.12, 1.25); }
  // big diffuser + two-element beam wing
  add(RB(1.05, 0.03, 0.75, 0.01), 'carbon', 0, 0.2, -2.0, 0.42);
  for (const sx of [1, -1]) add(RB(0.03, 0.34, 0.75, 0.01), 'carbon', sx * 0.52, 0.22, -2.0);
  add(RB(0.95, 0.03, 0.16, 0.01), 'carbon', 0, 0.44, -2.12, 0.25); add(RB(0.95, 0.025, 0.12, 0.01), 'carbon', 0, 0.52, -2.22, -0.1);
  // front wing: four elements sweeping up outboard, endplates, nose pylons
  const fwEl = [[0, 0.085, 3.38, 0.4, 0, 'fw_carbon'], [1, 0.14, 3.28, 0.2, -0.22, 'fw_body'], [2, 0.19, 3.18, 0.17, -0.42, 'fw_body'], [3, 0.24, 3.09, 0.15, -0.6, 'fw_acc']];
  for (const [n, y, z, d, rx, key] of fwEl) {
    add(RB(1.6, 0.022, d, 0.008), key, 0, y, z, rx, 0, 0);
    for (const sx of [1, -1]) add(RB(0.22, 0.022, d, 0.008), key, sx * 0.9, y + 0.025 + 0.012 * n, z, rx, 0, -sx * 0.28);
  }
  for (const sx of [1, -1]) { add(plate([[0, 0], [0.6, 0], [0.6, 0.22], [0.12, 0.34], [0, 0.28]], 0.022), 'fw_carbon', sx * 1.0 + 0.011, 0.06, 2.92, 0, -Math.PI / 2, 0); add(RB(0.02, 0.13, 0.2), 'fw_carbon', sx * 0.12, 0.17, 3.1); }
  // rear wing: main plane + flap with rolled tips into the endplates, single swan-neck pylon
  add(RB(0.9, 0.05, 0.34, 0.015), 'rw_acc', 0, 0.97, -2.3, 0.1);
  add(RB(0.88, 0.035, 0.22, 0.012), 'rw_body', 0, 1.09, -2.42, -0.35);
  for (const sx of [1, -1]) {
    add(RB(0.06, 0.28, 0.5, 0.025), 'rw_body', sx * 0.47, 0.88, -2.33, 0, 0, sx * 0.55);
    add(plate([[0, 0], [0.6, 0], [0.6, 0.4], [0.18, 0.5], [0, 0.42]], 0.025), 'rw_body', sx * 0.5 + 0.012, 0.62, -2.62, 0, -Math.PI / 2, 0);
  }
  add(RB(0.05, 0.42, 0.1, 0.01), 'carbon', 0, 0.75, -2.12, -0.25);
  // exhaust + rain light
  add(new THREE.CylinderGeometry(0.045, 0.05, 0.16, 12), 'metal', 0, 0.56, -2.0, Math.PI / 2);
  add(RB(0.18, 0.08, 0.03, 0.01), 'light', 0, 0.36, -2.4);
  // halo
  { const c = new THREE.CatmullRomCurve3([[0.34, 0.71, 0.05], [0.34, 0.85, 0.28], [0.26, 0.92, 0.66], [0, 0.94, 0.78], [-0.26, 0.92, 0.66], [-0.34, 0.85, 0.28], [-0.34, 0.71, 0.05]].map(p => new THREE.Vector3(...p)));
    add(new THREE.TubeGeometry(c, 40, 0.026, 8), 'carbon');
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.94, 0.78), new THREE.Vector3(0, 0.85, 0.88), new THREE.Vector3(0, 0.7, 0.98)]), 10, 0.03, 8), 'carbon'); }
  // mirrors on the sidepods
  for (const sx of [1, -1]) { add(RB(0.02, 0.18, 0.02), 'carbon', sx * 0.58, 0.68, 0.7); add(RB(0.17, 0.08, 0.06, 0.025), 'body', sx * 0.6, 0.79, 0.7); }
  // suspension (push-rod front, pull-rod rear) and wheel-wake deflectors above the front tyres
  const arm = (x0, y0, z0, x1, y1, z1, r = 0.014) => {
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1), len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, 6); g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    g.translate(a.x, a.y, a.z); add(g, 'carbon');
  };
  for (const sx of [1, -1]) {
    const fz = AXLE_F, rz = AXLE_R, fx = sx * (TRACK_F - 0.04), rx = sx * (TRACK_R - 0.04);
    arm(sx * 0.15, 0.44, fz + 0.15, fx, 0.48, fz); arm(sx * 0.15, 0.44, fz - 0.3, fx, 0.48, fz);
    arm(sx * 0.15, 0.25, fz + 0.2, fx, 0.24, fz); arm(sx * 0.15, 0.25, fz - 0.35, fx, 0.24, fz);
    arm(sx * 0.2, 0.25, fz - 0.1, fx, 0.46, fz, 0.012);
    arm(sx * 0.28, 0.45, rz + 0.15, rx, 0.48, rz); arm(sx * 0.28, 0.28, rz - 0.15, rx, 0.25, rz); arm(sx * 0.28, 0.28, rz + 0.3, rx, 0.25, rz);
    add(RB(0.3, 0.018, 0.24, 0.006), 'carbon', fx * 1.02, 0.78, fz - 0.02, 0.15);
  }
  const merged = {};
  for (const k in buckets) if (buckets[k].length) merged[k] = mergeGeometries(buckets[k], false);
  // 18-inch wheels: low-profile tyre and wheel cover
  const tyreProfile = (R, w, rim) => [[rim, -w / 2], [R - 0.045, -w / 2 - 0.003], [R - 0.01, -w / 2 + 0.025], [R, -w / 2 + 0.06], [R, w / 2 - 0.06], [R - 0.01, w / 2 - 0.025], [R - 0.045, w / 2 + 0.003], [rim, w / 2]].map(p => new THREE.Vector2(p[0], p[1]));
  const wheelGeo = (R, w) => ({
    tyre: new THREE.LatheGeometry(tyreProfile(R, w, 0.235), 36).rotateZ(Math.PI / 2),
    rim: new THREE.CylinderGeometry(0.24, 0.24, w - 0.01, 28, 1, true).rotateZ(Math.PI / 2),
    face: new THREE.CircleGeometry(0.24, 28),
    stripe: new THREE.TorusGeometry(R - 0.055, 0.007, 4, 40).rotateY(Math.PI / 2),
    w,
  });
  MODEL = { merged, front: wheelGeo(0.36, 0.3), rear: wheelGeo(0.36, 0.4) };
  MODEL.wheelMats = {
    tyre: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.88 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.4, metalness: 0.8 }),
    face: new THREE.MeshStandardMaterial({ map: canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#16171b'; g.fillRect(0, 0, w, h); g.translate(w / 2, h / 2);
      g.strokeStyle = '#3a3d44'; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 58, 0, Math.PI * 2); g.stroke();
      for (let k = 0; k < 5; k++) { g.rotate(Math.PI * 2 / 5); g.fillStyle = '#2b2e35'; g.fillRect(-3, 20, 6, 34); }
      g.fillStyle = '#8a8f99'; g.beginPath(); g.arc(0, 0, 12, 0, Math.PI * 2); g.fill();
    }, { repeat: false }), roughness: 0.45, metalness: 0.5 }),
    soft: new THREE.MeshStandardMaterial({ color: 0xe2231a, roughness: 0.6 }), medium: new THREE.MeshStandardMaterial({ color: 0xf5c400, roughness: 0.6 }), hard: new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.6 }),
    inter: new THREE.MeshStandardMaterial({ color: 0x2bb54a, roughness: 0.6 }), wet: new THREE.MeshStandardMaterial({ color: 0x1e6fe0, roughness: 0.6 }),
  };
  return MODEL;
}

function numberTex(num, color, stroke) {
  return canvasTex(256, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = 'italic 800 100px "Barlow Condensed", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = stroke; g.strokeText(String(num), w / 2, h / 2 + 4);
    g.fillStyle = color; g.fillText(String(num), w / 2, h / 2 + 4);
  }, { repeat: false });
}

export function makeCar({ color, accent, helmet = '#ffffff', number = 1, compound = 'medium' }) {
  const M = MODEL || buildModel();
  const g = new THREE.Group();
  const mats = {
    body: new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 }),
    acc: new THREE.MeshPhysicalMaterial({ color: accent, roughness: 0.35, metalness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.1 }),
    carbon: CARBON, dark: DARK, metal: METAL, light: LIGHT,
  };
  const shadow = new THREE.Mesh(SHADOW, SHADOW_MAT); shadow.position.y = 0.025; shadow.renderOrder = 1; g.add(shadow);
  const fwing = new THREE.Group(), rwing = new THREE.Group(); g.add(fwing, rwing);
  if (EXT) return makeExtCar(g, fwing, rwing, mats, compound);
  for (const k in M.merged) {
    const part = k.startsWith('fw_') ? fwing : k.startsWith('rw_') ? rwing : g, mk = k.replace(/^(fw|rw)_/, '');
    part.add(new THREE.Mesh(M.merged[k], mats[mk]));
  }
  const tex = numberTex(number, '#ffffff', 'rgba(0,0,0,.65)');
  const nmat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  for (const sx of [1, -1]) { const p = new THREE.Mesh(NUM_FIN, nmat); p.position.set(sx * 0.014, 0.99, -1.0); p.rotation.y = sx * Math.PI / 2; g.add(p); }
  const nose = new THREE.Mesh(NUM_NOSE, nmat); nose.position.set(0, 0.36, 2.1); nose.rotation.set(-Math.PI / 2 + 0.1, 0, Math.PI); g.add(nose);
  const helmetMesh = new THREE.Group(); helmetMesh.position.set(0, 0.84, 0.34);
  helmetMesh.add(new THREE.Mesh(HELMET, new THREE.MeshPhysicalMaterial({ color: helmet, roughness: 0.2, metalness: 0.3, clearcoat: 1 })), new THREE.Mesh(VISOR, VISOR_MAT));
  g.add(helmetMesh);
  const wheels = [], stripes = [];
  const wheel = (x, z, front) => {
    const W = front ? M.front : M.rear;
    const pivot = new THREE.Group(); pivot.position.set(x, 0.36, z); g.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin);
    spin.add(new THREE.Mesh(W.tyre, M.wheelMats.tyre), new THREE.Mesh(W.rim, M.wheelMats.rim));
    const face = new THREE.Mesh(W.face, M.wheelMats.face); face.position.x = Math.sign(x) * (W.w / 2 - 0.004); face.rotation.y = Math.sign(x) * Math.PI / 2; spin.add(face);
    for (const s of [1, -1]) { const st = new THREE.Mesh(W.stripe, M.wheelMats[compound]); st.position.x = s * (W.w / 2 + 0.002); spin.add(st); stripes.push(st); }
    wheels.push({ pivot, spin, front });
  };
  wheel(TRACK_F, AXLE_F, true); wheel(-TRACK_F, AXLE_F, true); wheel(TRACK_R, AXLE_R, false); wheel(-TRACK_R, AXLE_R, false);
  const steering = new THREE.Group(); steering.position.set(0, 0.6, 0.7); steering.rotation.x = -0.55; g.add(steering);
  steering.add(new THREE.Mesh(SW, DARK));
  for (const sx of [1, -1]) { const gr = new THREE.Mesh(SW_GRIP, CARBON); gr.position.set(sx * 0.15, -0.01, 0); steering.add(gr); }
  const scr = new THREE.Mesh(SW_SCREEN, SCREEN_MAT); scr.position.set(0, 0.015, -0.026); scr.rotation.y = Math.PI; steering.add(scr);
  steering.visible = false;
  return { group: g, wheels, helmet: helmetMesh, steering, cockpitHide: [helmetMesh], mats, numTex: tex, stripes, fwing, rwing };
}

/* ---- Licensed car model (generic, brandless) ----
   Stored in the game's own encrypted format (js/car.bin) so the original model file is not
   downloadable from the site, as its royalty-free licence requires. */
let EXT = null;
export async function loadCarModel(url) {
  try {
    const res = await fetch(url); if (!res.ok) return false;
    const all = new Uint8Array(await res.arrayBuffer());
    if (String.fromCharCode(...all.slice(0, 4)) !== 'AGP1') return false;
    const metaLen = new DataView(all.buffer).getUint32(4, true);
    const body = all.slice(8);
    let st = 0x9E3779B9 >>> 0;
    for (let i = 0; i < body.length; i++) { st ^= st << 13; st >>>= 0; st ^= st >>> 17; st ^= st << 5; st >>>= 0; body[i] ^= st & 255; }
    const meta = JSON.parse(new TextDecoder().decode(body.slice(0, metaLen)));
    const base = metaLen + (4 - (metaLen % 4)) % 4, ab = body.buffer;
    const parts = {};
    for (const p of meta.parts) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ab.slice(base + p.posOff, base + p.posOff + p.nPos * 4)), 3));
      const I = p.i32 ? new Uint32Array(ab.slice(base + p.idxOff, base + p.idxOff + p.nIdx * 4)) : new Uint16Array(ab.slice(base + p.idxOff, base + p.idxOff + p.nIdx * 2));
      geo.setIndex(new THREE.BufferAttribute(I, 1));
      // smooth shading on curved panels, sharp shading across hard edges
      parts[p.name] = { geo: toCreasedNormals(geo, Math.PI / 5), hub: p.hub };
    }
    EXT = { meta, parts };
    AXLE_F = meta.axleF; AXLE_R = meta.axleR;
    buildModel();
    return true;
  } catch (e) { console.warn('car model failed to load, using built-in car', e); return false; }
}
function makeExtCar(g, fwing, rwing, mats, compound) {
  const M = MODEL, P = EXT.parts, R = EXT.meta.R;
  // painted (not metallic) livery
  mats.body.metalness = 0.05; mats.body.roughness = 0.42; mats.body.clearcoatRoughness = 0.18;
  mats.acc.metalness = 0.05; mats.acc.roughness = 0.45;
  const add = (name, mat, parent) => { if (P[name]) parent.add(new THREE.Mesh(P[name].geo, mat)); };
  add('body', mats.body, g); add('acc', mats.acc, g); add('carbon', CARBON, g);
  add('fw_acc', mats.acc, fwing); add('fw_carbon', CARBON, fwing); add('rw_acc', mats.acc, rwing);
  // clean halo (the model's own one was lumpy): a titanium tube round the cockpit plus the centre pillar
  g.add(new THREE.Mesh(EXT_HALO, HALO_MAT), new THREE.Mesh(EXT_PILLAR, HALO_MAT));
  for (const sx of [1, -1]) { const foot = new THREE.Mesh(EXT_FOOT, HALO_MAT); foot.position.set(sx * 0.33, 0.79, 0.13); g.add(foot); }
  // clean 18" wheels built to the model's measured hubs and radius
  const W = extWheels(R), hx = EXT.meta.hubX || { f: 1.02, r: 1.06 };
  const wheels = [], stripes = [];
  for (const [front, sx] of [[true, 1], [true, -1], [false, 1], [false, -1]]) {
    const geo = front ? W.front : W.rear;
    const pivot = new THREE.Group(); pivot.position.set(sx * ((front ? hx.f : hx.r) - geo.w / 2), R, front ? EXT.meta.axleF : EXT.meta.axleR); g.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin);
    spin.add(new THREE.Mesh(geo.tyre, M.wheelMats.tyre), new THREE.Mesh(geo.rim, M.wheelMats.rim));
    const face = new THREE.Mesh(geo.face, M.wheelMats.face); face.position.x = sx * (geo.w / 2 - 0.004); face.rotation.y = sx * Math.PI / 2; spin.add(face);
    const inner = new THREE.Mesh(geo.face, M.wheelMats.face); inner.position.x = -sx * (geo.w / 2 - 0.004); inner.rotation.y = -sx * Math.PI / 2; spin.add(inner);
    for (const s2 of [1, -1]) { const st = new THREE.Mesh(geo.stripe, M.wheelMats[compound]); st.position.x = s2 * (geo.w / 2 + 0.002); spin.add(st); stripes.push(st); }
    wheels.push({ pivot, spin, front });
  }
  const steering = new THREE.Group(); steering.position.set(0, 0.62, 0.55); steering.rotation.x = -0.55; g.add(steering);
  steering.add(new THREE.Mesh(SW, DARK));
  for (const sx of [1, -1]) { const gr = new THREE.Mesh(SW_GRIP, CARBON); gr.position.set(sx * 0.15, -0.01, 0); steering.add(gr); }
  const scr = new THREE.Mesh(SW_SCREEN, SCREEN_MAT); scr.position.set(0, 0.015, -0.026); scr.rotation.y = Math.PI; steering.add(scr);
  steering.visible = false;
  const numTex = new THREE.Texture();
  return { group: g, wheels, helmet: new THREE.Group(), steering, cockpitHide: [], mats, numTex, stripes, fwing, rwing };
}
const HALO_MAT = new THREE.MeshStandardMaterial({ color: 0x1c1d21, roughness: 0.35, metalness: 0.6 });
const EXT_HALO = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[0.33, 0.79, 0.13], [0.335, 0.88, 0.3], [0.27, 0.935, 0.6], [0, 0.95, 0.8], [-0.27, 0.935, 0.6], [-0.335, 0.88, 0.3], [-0.33, 0.79, 0.13]].map(p => new THREE.Vector3(...p))), 64, 0.03, 12);
const EXT_PILLAR = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.95, 0.8), new THREE.Vector3(0, 0.9, 0.9), new THREE.Vector3(0, 0.79, 1.02)]), 16, 0.034, 12);
const EXT_FOOT = new THREE.CylinderGeometry(0.035, 0.05, 0.08, 12);
let EXT_WHEELS = null;
function extWheels(R) {
  if (EXT_WHEELS) return EXT_WHEELS;
  // low-profile 18" tyre: rounded shoulders, flat tread, rim + wheel cover
  const prof = (w, rim) => [[rim, -w / 2], [R - 0.045, -w / 2 - 0.004], [R - 0.012, -w / 2 + 0.022], [R, -w / 2 + 0.055], [R, w / 2 - 0.055], [R - 0.012, w / 2 - 0.022], [R - 0.045, w / 2 + 0.004], [rim, w / 2]].map(p => new THREE.Vector2(p[0], p[1]));
  const mk = w => ({
    tyre: new THREE.LatheGeometry(prof(w, 0.24), 48).rotateZ(Math.PI / 2),
    rim: new THREE.CylinderGeometry(0.245, 0.245, w - 0.01, 32, 1, true).rotateZ(Math.PI / 2),
    face: new THREE.CircleGeometry(0.245, 32),
    stripe: new THREE.TorusGeometry(R - 0.06, 0.008, 4, 48).rotateY(Math.PI / 2),
    w,
  });
  return (EXT_WHEELS = { front: mk(0.32), rear: mk(0.4) });
}

export function setCompound(c, comp) { const m = MODEL.wheelMats[comp] || MODEL.wheelMats.medium; c.stripes.forEach(s => s.material = m); }
export function disposeCar(c) { c.mats.body.dispose(); c.mats.acc.dispose(); c.numTex.dispose(); }

/* Safety car: a low grand-tourer with a light bar */
export function makeSafetyCar() {
  const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: '#c9ced6', roughness: 0.25, metalness: 0.7, clearcoat: 1 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#0d1117', roughness: 0.05, metalness: 0.5, clearcoat: 1 });
  const stripe = new THREE.MeshStandardMaterial({ color: '#22c55e', roughness: 0.5 });
  g.add(new THREE.Mesh(loft([[-2.3, 0.85, 0.3, 0.55, 4], [-1.6, 0.97, 0.36, 0.6, 4], [0.4, 0.97, 0.36, 0.6, 4], [1.8, 0.92, 0.3, 0.52, 4], [2.3, 0.8, 0.2, 0.45, 3]], 32), paint));
  g.add(new THREE.Mesh(loft([[-1.3, 0.62, 0.05, 0.95, 3], [-0.9, 0.68, 0.24, 1.08, 3], [0.2, 0.68, 0.26, 1.08, 3], [0.8, 0.6, 0.06, 0.95, 3]], 24), glass));
  const bar = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.1, 0.25, 2, 0.04), new THREE.MeshStandardMaterial({ color: '#111' })); bar.position.set(0, 1.38, -0.3); g.add(bar);
  const lamps = [];
  for (const sx of [-0.32, -0.12, 0.12, 0.32]) { const m = new THREE.MeshBasicMaterial({ color: '#ffb000', toneMapped: false }); const l = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.22), m); l.position.set(sx, 1.44, -0.3); g.add(l); lamps.push(m); }
  for (const sx of [1, -1]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 3.8), stripe); s.position.set(sx * 0.975, 0.6, 0); g.add(s); }
  const tyreG = new THREE.CylinderGeometry(0.34, 0.34, 0.28, 20).rotateZ(Math.PI / 2), tm = new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.9 });
  for (const [x, z] of [[0.85, 1.45], [-0.85, 1.45], [0.85, -1.4], [-0.85, -1.4]]) { const w = new THREE.Mesh(tyreG, tm); w.position.set(x, 0.34, z); g.add(w); }
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 5.2).rotateX(-Math.PI / 2), SHADOW_MAT); sh.position.y = 0.025; g.add(sh);
  return { group: g, lamps };
}

const CARBON = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.45, metalness: 0.35 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.8 });
const METAL = new THREE.MeshStandardMaterial({ color: 0x7a6a5a, roughness: 0.3, metalness: 0.9 });
const LIGHT = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1010, emissiveIntensity: 3 });
const VISOR_MAT = new THREE.MeshPhysicalMaterial({ color: 0x0a0a12, roughness: 0.05, metalness: 0.6, clearcoat: 1 });
const SCREEN_MAT = new THREE.MeshBasicMaterial({ color: 0x33ff99, toneMapped: false });
const HELMET = new THREE.SphereGeometry(0.145, 20, 14);
const VISOR = new THREE.SphereGeometry(0.148, 20, 8, -Math.PI * 0.32 + Math.PI / 2, Math.PI * 0.64, Math.PI * 0.36, Math.PI * 0.2);
const NUM_FIN = new THREE.PlaneGeometry(0.36, 0.18);
const NUM_NOSE = new THREE.PlaneGeometry(0.22, 0.11);
const SW = new RoundedBoxGeometry(0.27, 0.13, 0.04, 2, 0.02);
const SW_GRIP = new RoundedBoxGeometry(0.06, 0.16, 0.06, 2, 0.025);
const SW_SCREEN = new THREE.PlaneGeometry(0.1, 0.05);
const SHADOW = new THREE.PlaneGeometry(2.4, 6.0).rotateX(-Math.PI / 2);
const SHADOW_MAT = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, map: canvasTex(64, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, h / 2); gr.addColorStop(0, 'rgba(0,0,0,.6)'); gr.addColorStop(0.7, 'rgba(0,0,0,.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, { repeat: false }) });

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTex } from './util.js';

/* Lofted body: sections [z, halfWidth, halfHeight, centreY, superellipseExponent] */
function loft(secs, segs = 28, xOff = 0) {
  const pos = [], idx = [], ring = segs;
  const pt = (s, k) => {
    const [z, hw, hh, yc, n] = s, t = k / ring * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t), e = 2 / n;
    return [xOff + Math.sign(c) * Math.pow(Math.abs(c), e) * hw, yc + Math.sign(sn) * Math.pow(Math.abs(sn), e) * hh, z];
  };
  secs.forEach(s => { for (let k = 0; k < ring; k++) pos.push(...pt(s, k)); });
  for (let i = 0; i < secs.length - 1; i++) for (let k = 0; k < ring; k++) {
    const a = i * ring + k, b = i * ring + (k + 1) % ring, c = (i + 1) * ring + k, d = (i + 1) * ring + (k + 1) % ring;
    idx.push(a, b, c, b, d, c);
  }
  const cap = (i, front) => {
    const base = pos.length / 3, s = secs[i];
    pos.push(xOff, s[3], s[0]);
    for (let k = 0; k < ring; k++) pos.push(...pt(s, k));
    for (let k = 0; k < ring; k++) { const a = base + 1 + k, b = base + 1 + (k + 1) % ring; front ? idx.push(base, a, b) : idx.push(base, b, a); }
  };
  cap(0, false); cap(secs.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

const BODY = [
  [-2.14, 0.15, 0.13, 0.42, 3], [-1.92, 0.21, 0.19, 0.48, 3], [-1.4, 0.26, 0.26, 0.56, 3], [-0.8, 0.3, 0.33, 0.62, 3],
  [-0.38, 0.32, 0.41, 0.64, 3.2], [-0.14, 0.37, 0.33, 0.53, 3.6], [0.12, 0.42, 0.27, 0.46, 4], [0.75, 0.42, 0.25, 0.44, 4],
  [1.15, 0.35, 0.21, 0.41, 3.5], [1.6, 0.25, 0.16, 0.36, 3], [2.2, 0.17, 0.12, 0.3, 2.6], [2.8, 0.12, 0.085, 0.24, 2.4],
  [3.12, 0.08, 0.06, 0.21, 2.2], [3.24, 0.035, 0.03, 0.2, 2],
];
const POD = [[-1.55, 0.06, 0.08, 0.3, 3], [-1.15, 0.19, 0.17, 0.33, 3], [-0.5, 0.27, 0.22, 0.36, 3.5], [0.3, 0.29, 0.23, 0.38, 4], [0.72, 0.28, 0.21, 0.38, 4], [0.8, 0.25, 0.18, 0.38, 4]];

let MODEL = null;
function buildModel() {
  const buckets = { body: [], acc: [], carbon: [], dark: [], metal: [], light: [], fw_carbon: [], fw_body: [], fw_acc: [], rw_acc: [], rw_body: [], rw_carbon: [] };
  const add = (geo, key, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.deleteAttribute('uv');
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(m);
    buckets[key].push(g);
  };
  const RB = (w, h, d, r = 0.02) => new RoundedBoxGeometry(w, h, d, 2, r);
  // monocoque, nose, engine cover
  add(loft(BODY), 'body');
  add(loft(POD, 24, 0.62), 'body'); add(loft(POD, 24, -0.62), 'body');
  // sidepod intakes + airbox intake
  for (const sx of [1, -1]) add(new THREE.CircleGeometry(1, 24), 'dark', sx * 0.62, 0.38, 0.805, 0, 0, 0, 0.22, 0.15, 1);
  add(new THREE.CircleGeometry(1, 20), 'dark', 0, 0.97, -0.13, 0, 0, 0, 0.13, 0.1, 1);
  // cockpit opening + headrest
  add(new THREE.CircleGeometry(1, 28), 'dark', 0, 0.705, 0.45, -Math.PI / 2, 0, 0, 0.25, 0.42, 1);
  add(RB(0.5, 0.1, 0.22, 0.04), 'carbon', 0, 0.72, 0.05);
  // T-cam pod and antenna
  add(RB(0.12, 0.07, 0.24, 0.03), 'acc', 0, 1.08, -0.42);
  add(new THREE.CylinderGeometry(0.006, 0.006, 0.3), 'carbon', 0.08, 1.15, -0.6, 0.3);
  // shark fin
  { const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(-1.5, 0); s.lineTo(-1.45, 0.28); s.lineTo(-0.15, 0.08); s.lineTo(0, 0);
    add(new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false }), 'body', -0.01, 0.96, -0.45, 0, -Math.PI / 2, 0); }
  // floor + edges
  add(RB(1.62, 0.04, 3.3, 0.02), 'carbon', 0, 0.085, -0.25);
  add(RB(1.1, 0.04, 0.6, 0.02), 'carbon', 0, 0.085, 1.55);
  for (const sx of [1, -1]) add(RB(0.03, 0.08, 2.4, 0.01), 'carbon', sx * 0.8, 0.12, -0.4);
  // diffuser
  add(RB(1.0, 0.24, 0.45, 0.02), 'carbon', 0, 0.17, -2.1, 0.35);
  // front wing: main plane + 2 flaps + endplates + pylons
  add(RB(1.96, 0.03, 0.42, 0.012), 'fw_carbon', 0, 0.1, 3.18);
  add(RB(1.86, 0.025, 0.22, 0.01), 'fw_body', 0, 0.165, 3.05, -0.28);
  add(RB(1.76, 0.025, 0.2, 0.01), 'fw_acc', 0, 0.225, 2.95, -0.5);
  for (const sx of [1, -1]) { add(RB(0.025, 0.25, 0.66, 0.01), 'fw_carbon', sx * 0.98, 0.18, 3.1); add(RB(0.02, 0.14, 0.18), 'fw_carbon', sx * 0.1, 0.16, 2.9); }
  // rear wing
  add(RB(1.0, 0.05, 0.36, 0.015), 'rw_acc', 0, 0.99, -2.32, 0.1);
  add(RB(1.0, 0.035, 0.22, 0.012), 'rw_body', 0, 1.11, -2.45, -0.35);
  add(RB(1.0, 0.03, 0.18, 0.01), 'carbon', 0, 0.52, -2.33, 0.15);
  for (const sx of [1, -1]) add(RB(0.03, 0.62, 0.74, 0.01), 'rw_body', sx * 0.515, 0.88, -2.36);
  add(RB(0.05, 0.42, 0.12, 0.01), 'carbon', 0, 0.74, -2.22);
  // exhaust + rain light
  add(new THREE.CylinderGeometry(0.045, 0.05, 0.16, 12), 'metal', 0, 0.58, -2.2, Math.PI / 2);
  add(RB(0.18, 0.08, 0.03, 0.01), 'light', 0, 0.44, -2.45);
  // halo
  { const c = new THREE.CatmullRomCurve3([[0.34, 0.72, 0.0], [0.34, 0.86, 0.22], [0.26, 0.93, 0.6], [0, 0.95, 0.72], [-0.26, 0.93, 0.6], [-0.34, 0.86, 0.22], [-0.34, 0.72, 0.0]].map(p => new THREE.Vector3(...p)));
    add(new THREE.TubeGeometry(c, 40, 0.026, 8), 'carbon');
    const p = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.95, 0.72), new THREE.Vector3(0, 0.86, 0.82), new THREE.Vector3(0, 0.71, 0.92)]);
    add(new THREE.TubeGeometry(p, 10, 0.03, 8), 'carbon'); }
  // mirrors
  for (const sx of [1, -1]) { add(RB(0.02, 0.02, 0.16), 'carbon', sx * 0.4, 0.74, 0.78, 0, sx * 0.4); add(RB(0.15, 0.07, 0.05, 0.02), 'body', sx * 0.5, 0.78, 0.78); }
  // suspension
  const arm = (x0, y0, z0, x1, y1, z1, r = 0.014) => {
    const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1), len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, 6); g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    g.translate(a.x, a.y, a.z); add(g, 'carbon');
  };
  for (const sx of [1, -1]) {
    arm(sx * 0.15, 0.42, 1.8, sx * 0.78, 0.46, 1.66); arm(sx * 0.15, 0.42, 1.45, sx * 0.78, 0.46, 1.66);
    arm(sx * 0.15, 0.27, 1.85, sx * 0.78, 0.25, 1.66); arm(sx * 0.15, 0.27, 1.4, sx * 0.78, 0.25, 1.66);
    arm(sx * 0.3, 0.45, -1.4, sx * 0.76, 0.48, -1.55); arm(sx * 0.3, 0.3, -1.7, sx * 0.76, 0.26, -1.55); arm(sx * 0.3, 0.3, -1.35, sx * 0.76, 0.26, -1.55);
  }
  const merged = {};
  for (const k in buckets) if (buckets[k].length) merged[k] = mergeGeometries(buckets[k], false);
  // wheels (shared)
  const tyreProfile = (R, w, rim) => [[rim, -w / 2], [R - 0.05, -w / 2 - 0.003], [R - 0.012, -w / 2 + 0.03], [R, -w / 2 + 0.07], [R, w / 2 - 0.07], [R - 0.012, w / 2 - 0.03], [R - 0.05, w / 2 + 0.003], [rim, w / 2]].map(p => new THREE.Vector2(p[0], p[1]));
  const wheelGeo = (R, w) => ({
    tyre: new THREE.LatheGeometry(tyreProfile(R, w, 0.24), 36).rotateZ(Math.PI / 2),
    rim: new THREE.CylinderGeometry(0.245, 0.245, w - 0.01, 28, 1, true).rotateZ(Math.PI / 2),
    face: new THREE.CircleGeometry(0.245, 28),
    stripe: new THREE.TorusGeometry(R - 0.065, 0.007, 4, 40).rotateY(Math.PI / 2),
    w,
  });
  MODEL = { merged, front: wheelGeo(0.36, 0.34), rear: wheelGeo(0.37, 0.44) };
  // shared wheel materials
  MODEL.wheelMats = {
    tyre: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.88 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x24262a, roughness: 0.4, metalness: 0.8 }),
    face: new THREE.MeshStandardMaterial({ map: canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#1b1c20'; g.fillRect(0, 0, w, h);
      g.translate(w / 2, h / 2);
      for (let k = 0; k < 6; k++) { g.rotate(Math.PI / 3); g.fillStyle = '#585c66'; g.fillRect(-5, 12, 10, 50); }
      g.fillStyle = '#8a8f99'; g.beginPath(); g.arc(0, 0, 13, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#3a3d44'; g.lineWidth = 5; g.beginPath(); g.arc(0, 0, 60, 0, Math.PI * 2); g.stroke();
    }, { repeat: false }), roughness: 0.45, metalness: 0.6 }),
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
  const fwing = new THREE.Group(), rwing = new THREE.Group(); g.add(fwing, rwing);
  for (const k in M.merged) {
    const part = k.startsWith('fw_') ? fwing : k.startsWith('rw_') ? rwing : g, mk = k.replace(/^(fw|rw)_/, '');
    const m = new THREE.Mesh(M.merged[k], mats[mk]); m.castShadow = mk !== 'light'; m.receiveShadow = true; part.add(m);
  }
  // race numbers on fin and nose
  const tex = numberTex(number, '#ffffff', 'rgba(0,0,0,.65)');
  const nmat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  for (const sx of [1, -1]) { const p = new THREE.Mesh(NUM_FIN, nmat); p.position.set(sx * 0.016, 1.05, -1.05); p.rotation.y = sx * Math.PI / 2; g.add(p); }
  const nose = new THREE.Mesh(NUM_NOSE, nmat); nose.position.set(0, 0.338, 2.0); nose.rotation.set(-Math.PI / 2 + 0.12, 0, Math.PI); g.add(nose);
  // helmet + visor
  const helmetMesh = new THREE.Group(); helmetMesh.position.set(0, 0.85, 0.3);
  const hm = new THREE.Mesh(HELMET, new THREE.MeshPhysicalMaterial({ color: helmet, roughness: 0.2, metalness: 0.3, clearcoat: 1 })); hm.castShadow = true;
  const vz = new THREE.Mesh(VISOR, VISOR_MAT);
  helmetMesh.add(hm, vz); g.add(helmetMesh);
  // wheels
  const wheels = [], stripes = [];
  const wheel = (x, z, front) => {
    const W = front ? M.front : M.rear;
    const pivot = new THREE.Group(); pivot.position.set(x, front ? 0.36 : 0.37, z); g.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin);
    const t = new THREE.Mesh(W.tyre, M.wheelMats.tyre); t.castShadow = true; spin.add(t);
    spin.add(new THREE.Mesh(W.rim, M.wheelMats.rim));
    const face = new THREE.Mesh(W.face, M.wheelMats.face); face.position.x = Math.sign(x) * (W.w / 2 - 0.004); face.rotation.y = Math.sign(x) * Math.PI / 2; spin.add(face);
    for (const s of [1, -1]) { const st = new THREE.Mesh(W.stripe, M.wheelMats[compound]); st.position.x = s * (W.w / 2 + 0.002); spin.add(st); stripes.push(st); }
    wheels.push({ pivot, spin, front });
  };
  wheel(0.84, 1.66, true); wheel(-0.84, 1.66, true); wheel(0.83, -1.55, false); wheel(-0.83, -1.55, false);
  // steering wheel (player cockpit)
  const steering = new THREE.Group(); steering.position.set(0, 0.62, 0.66); steering.rotation.x = -0.55; g.add(steering);
  steering.add(new THREE.Mesh(SW, DARK));
  for (const sx of [1, -1]) { const gr = new THREE.Mesh(SW_GRIP, CARBON); gr.position.set(sx * 0.15, -0.01, 0); steering.add(gr); }
  const scr = new THREE.Mesh(SW_SCREEN, SCREEN_MAT); scr.position.set(0, 0.015, -0.026); scr.rotation.y = Math.PI; steering.add(scr);
  steering.visible = false;
  // cockpit-only parts the camera would otherwise clip through
  const cockpitHide = [helmetMesh];
  return { group: g, wheels, helmet: helmetMesh, steering, cockpitHide, mats, numTex: tex, stripes, fwing, rwing };
}

export function setCompound(c, comp) { const m = MODEL.wheelMats[comp] || MODEL.wheelMats.medium; c.stripes.forEach(s => s.material = m); }

export function disposeCar(c) {
  c.mats.body.dispose(); c.mats.acc.dispose(); c.numTex.dispose();
}

const CARBON = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.45, metalness: 0.35 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.8 });
const METAL = new THREE.MeshStandardMaterial({ color: 0x7a6a5a, roughness: 0.3, metalness: 0.9 });
const LIGHT = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1010, emissiveIntensity: 3 });
const VISOR_MAT = new THREE.MeshPhysicalMaterial({ color: 0x0a0a12, roughness: 0.05, metalness: 0.6, clearcoat: 1 });
const SCREEN_MAT = new THREE.MeshBasicMaterial({ color: 0x33ff99, toneMapped: false });
const HELMET = new THREE.SphereGeometry(0.145, 20, 14);
const VISOR = new THREE.SphereGeometry(0.148, 20, 8, -Math.PI * 0.32 + Math.PI / 2, Math.PI * 0.64, Math.PI * 0.36, Math.PI * 0.2);
const NUM_FIN = new THREE.PlaneGeometry(0.42, 0.21);
const NUM_NOSE = new THREE.PlaneGeometry(0.24, 0.12);
const SW = new RoundedBoxGeometry(0.27, 0.13, 0.04, 2, 0.02);
const SW_GRIP = new RoundedBoxGeometry(0.06, 0.16, 0.06, 2, 0.025);
const SW_SCREEN = new THREE.PlaneGeometry(0.1, 0.05);

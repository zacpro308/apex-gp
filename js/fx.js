import * as THREE from 'three';
import { canvasTex } from './util.js?v=95106973';

const VERT = `
attribute float size; attribute float alpha; attribute vec3 tint;
varying float vAlpha; varying vec3 vTint;
#include <common>
#include <logdepthbuf_pars_vertex>
void main(){
  vAlpha = alpha; vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (700.0 / max(-mv.z, 0.1));
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const FRAG = `
uniform sampler2D map; varying float vAlpha; varying vec3 vTint;
#include <logdepthbuf_pars_fragment>
void main(){
  #include <logdepthbuf_fragment>
  vec4 t = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(vTint * t.rgb, t.a * vAlpha);
}`;

const soft = canvasTex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, { repeat: false });

export class Particles {
  constructor(scene, max, additive) {
    this.max = max; this.n = 0; this.head = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.life = new Float32Array(max); this.age = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.a0 = new Float32Array(max); this.drag = new Float32Array(max); this.grav = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 3), 3); this.size = new THREE.BufferAttribute(new Float32Array(max), 1);
    this.alpha = new THREE.BufferAttribute(new Float32Array(max), 1); this.tint = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
    for (const a of [this.pos, this.size, this.alpha, this.tint]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos); g.setAttribute('size', this.size); g.setAttribute('alpha', this.alpha); g.setAttribute('tint', this.tint);
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { map: { value: soft } }, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(this.points);
  }
  spawn(x, y, z, vx, vy, vz, life, s0, s1, a0, color, drag = 1.5, grav = 0) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    this.p.set([x, y, z], i * 3); this.v.set([vx, vy, vz], i * 3);
    this.life[i] = life; this.age[i] = 0; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0; this.drag[i] = drag; this.grav[i] = grav;
    this.tint.array.set([color.r, color.g, color.b], i * 3);
  }
  update(dt) {
    const P = this.pos.array, S = this.size.array, A = this.alpha.array;
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) { A[i] = 0; S[i] = 0; continue; }
      this.age[i] += dt; const t = this.age[i] / this.life[i], k = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= k; this.v[i * 3 + 1] = this.v[i * 3 + 1] * k - this.grav[i] * dt; this.v[i * 3 + 2] *= k;
      for (let j = 0; j < 3; j++) { this.p[i * 3 + j] += this.v[i * 3 + j] * dt; P[i * 3 + j] = this.p[i * 3 + j]; }
      if (P[i * 3 + 1] < 0.02 && this.grav[i] > 0) { P[i * 3 + 1] = this.p[i * 3 + 1] = 0.02; this.v[i * 3 + 1] *= -0.3; }
      S[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      A[i] = this.a0[i] * (1 - t) * Math.min(1, t * 8);
    }
    this.pos.needsUpdate = this.size.needsUpdate = this.alpha.needsUpdate = this.tint.needsUpdate = true;
  }
  clear() { this.age.fill(1e9); }
}

/* Ring-buffered skid marks laid as quads on the road */
export class Skids {
  constructor(scene, max = 2400) {
    this.max = max; this.head = 0;
    const g = new THREE.BufferGeometry();
    this.posA = new THREE.BufferAttribute(new Float32Array(max * 4 * 3), 3); this.posA.setUsage(THREE.DynamicDrawUsage);
    this.alA = new THREE.BufferAttribute(new Float32Array(max * 4), 1);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    g.setAttribute('position', this.posA); g.setAttribute('alpha', this.alA); g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: 'attribute float alpha; varying float vA;\n#include <common>\n#include <logdepthbuf_pars_vertex>\nvoid main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);\n#include <logdepthbuf_vertex>\n}',
      fragmentShader: 'varying float vA;\n#include <logdepthbuf_pars_fragment>\nvoid main(){\n#include <logdepthbuf_fragment>\ngl_FragColor = vec4(0.03,0.03,0.035, vA); }',
    }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2; scene.add(this.mesh);
    this.last = new Map();
  }
  mark(key, x, z, hx, hz, strength, y = 0) {
    const prev = this.last.get(key);
    this.last.set(key, { x, z, t: performance.now() });
    if (!prev || performance.now() - prev.t > 120) return;
    const dx = x - prev.x, dz = z - prev.z, l = Math.hypot(dx, dz); if (l < 0.25 || l > 6) return;
    const nx = -dz / l * 0.17, nz = dx / l * 0.17, i = this.head; this.head = (this.head + 1) % this.max;
    const yy = y + 0.042; this.posA.array.set([prev.x + nx, yy, prev.z + nz, prev.x - nx, yy, prev.z - nz, x + nx, yy, z + nz, x - nx, yy, z - nz], i * 12);
    this.alA.array.set([strength, strength, strength, strength], i * 4);
    this.posA.needsUpdate = this.alA.needsUpdate = true;
  }
  lift(key) { this.last.delete(key); }
  clear() { this.posA.array.fill(0); this.alA.array.fill(0); this.posA.needsUpdate = this.alA.needsUpdate = true; this.last.clear(); }
}

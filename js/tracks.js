import * as THREE from 'three';
import { clamp } from './util.js';

export const W = 7;        // road half-width (m)
export const KERB = 1.4;   // kerb width (m)
export const DS = 2;       // sample spacing (m)

/* ------------------------------------------------------------------
   Environment themes
   ------------------------------------------------------------------ */
const base = {
  night: false, lights: false, sunElev: 40, sunAz: 210, turbidity: 2.5, rayleigh: 2.2, mie: 0.004, exposure: 0.55,
  fog: '#c9dbe8', fogDensity: 0.00022, grass: '#4d8a37', terrain: ['#4d8a37', '#5f9142', '#7d8a5c'], snowLine: 0, sand: '#cbb98a',
  relief: 'hills', hillAmp: 110, water: null, scenery: { trees: 1400 }, foliage: ['#2f6b2a', '#3a7a2f', '#4a8a35', '#2a5e2a'],
  barrier: 'armco', wallA: '#f4f6f8', wallB: '#2156d6', apron: '#2156d6', bloom: 0.25,
};
const T = (o) => Object.assign({}, base, o);
export const THEMES = {
  park: T({}),
  river: T({ water: { level: -4, mode: 'low' }, terrain: ['#4f8f3c', '#5e9446', '#7a8d5e'], wallB: '#0f9d76', apron: '#0f9d76' }),
  forest: T({ scenery: { trees: 2200, pines: 900 }, foliage: ['#24552a', '#2d6630', '#1d4a25', '#3a6d2c'], hillAmp: 140, wallB: '#d97706', apron: '#b45309' }),
  alpine: T({ sunElev: 28, turbidity: 2, grass: '#5b7d47', terrain: ['#5b7d47', '#76806a', '#8d8f8f'], snowLine: 140, relief: 'mountains', hillAmp: 650, scenery: { pines: 2200 }, foliage: ['#1f4d34', '#24583a', '#1a4230'], wallB: '#d62828', apron: '#d62828', fog: '#d8e5f0' }),
  coastal: T({ sunElev: 55, sunAz: 160, grass: '#88ac56', terrain: ['#88ac56', '#9aa86a', '#a59a78'], water: { level: -3, mode: 'side', angle: 0.6 }, scenery: { palms: 600, shrubs: 500 }, foliage: ['#2f8a3a', '#3b9a45', '#4a8a35'], wallB: '#00a3c4', apron: '#00a3c4', fog: '#cfe7f5' }),
  tropical: T({ sunElev: 60, turbidity: 7, grass: '#3f9a3a', terrain: ['#3f9a3a', '#4a8f3a', '#5f7f4a'], water: { level: -3, mode: 'side', angle: 2.4 }, scenery: { palms: 900, trees: 1600 }, foliage: ['#1f7a2e', '#2e8a3a', '#3fa04a', '#17602a'], hillAmp: 220, fog: '#d5e6dc', fogDensity: 0.0003, wallB: '#16a34a', apron: '#16a34a' }),
  canyon: T({ sunElev: 7, sunAz: 250, turbidity: 6, rayleigh: 2.5, exposure: 0.55, grass: '#b0643a', terrain: ['#b0643a', '#9c4f2b', '#c47a45'], relief: 'mesa', hillAmp: 220, scenery: { rocks: 500 }, fog: '#e9b88f', wallB: '#7c2d12', apron: '#c2410c' }),
  desertDay: T({ sunElev: 66, sunAz: 120, turbidity: 5, grass: '#d4ae73', terrain: ['#d4ae73', '#c99b5e', '#b88550'], relief: 'dunes', hillAmp: 60, scenery: { rocks: 350, palms: 120 }, fog: '#efdcc0', fogDensity: 0.00026, wallB: '#c2410c', apron: '#ea580c' }),
  saltpan: T({ sunElev: 3, sunAz: 270, turbidity: 8, rayleigh: 3, exposure: 0.55, lights: true, grass: '#d9cdb5', terrain: ['#d9cdb5', '#c9b394', '#a8876a'], relief: 'mesa', hillAmp: 180, scenery: { rocks: 300 }, fog: '#f0b48a', wallB: '#7c3aed', apron: '#7c3aed', bloom: 0.6 }),
  desertNight: T({ night: true, nightSky: ['#03050d', '#2a1d3a'], exposure: 0.9, grass: '#6e5235', terrain: ['#6e5235', '#7a5a3c', '#5a4430'], relief: 'dunes', hillAmp: 70, scenery: { rocks: 350 }, fog: '#1d1424', fogDensity: 0.00035, wallA: '#ffcc00', wallB: '#1a1a1a', apron: '#ffcc00', bloom: 0.9 }),
  street: T({ sunElev: 13, sunAz: 240, turbidity: 4, rayleigh: 2, exposure: 0.6, grass: '#5d6066', terrain: ['#5d6066', '#5d6066', '#6e7178'], relief: 'flat', hillAmp: 40, scenery: { buildings: 650 }, barrier: 'street', wallA: '#e5e7eb', wallB: '#cbd0d6', fog: '#eccfb2' }),
  city: T({ sunElev: 48, sunAz: 140, grass: '#666a70', terrain: ['#666a70', '#666a70', '#7a7d84'], relief: 'flat', hillAmp: 30, scenery: { buildings: 800 }, barrier: 'street', wallA: '#f1f5f9', wallB: '#94a3b8', fog: '#d6e2ee' }),
  streetNight: T({ night: true, nightSky: ['#02030a', '#1b1440'], exposure: 0.95, grass: '#2a2c33', terrain: ['#2a2c33', '#2a2c33', '#33353d'], relief: 'flat', hillAmp: 30, scenery: { buildings: 800 }, barrier: 'street', wallA: '#ff2e88', wallB: '#26e0ff', fog: '#130f2a', fogDensity: 0.0003, bloom: 1.0 }),
  marinaNight: T({ night: true, nightSky: ['#020615', '#0e2a4a'], exposure: 0.95, grass: '#2b2f36', terrain: ['#2b2f36', '#2b2f36', '#30343c'], relief: 'flat', hillAmp: 20, water: { level: -2, mode: 'side', angle: 4.0 }, scenery: { buildings: 700 }, barrier: 'street', wallA: '#ffb020', wallB: '#1e3a8a', fog: '#0b1630', fogDensity: 0.0003, bloom: 1.0 }),
  lake: T({ sunElev: 35, sunAz: 100, water: { level: -3, mode: 'low' }, hillAmp: 160, scenery: { trees: 1200, pines: 600 }, wallB: '#0284c7', apron: '#0284c7' }),
  autumn: T({ sunElev: 24, sunAz: 230, turbidity: 5, grass: '#7a8a3a', terrain: ['#7a8a3a', '#8a7f45', '#7f6f50'], scenery: { trees: 2000 }, foliage: ['#c8642a', '#d98b2b', '#a8441f', '#e0b03a', '#6b7a2a'], hillAmp: 150, fog: '#e6d8c4', wallB: '#b91c1c', apron: '#b91c1c' }),
  vineyard: T({ sunElev: 11, sunAz: 260, turbidity: 4, rayleigh: 2, exposure: 0.58, grass: '#8a9a4a', terrain: ['#8a9a4a', '#9a9a55', '#a68f60'], scenery: { shrubs: 2200, trees: 400 }, foliage: ['#4a6a2a', '#5a7a30', '#6a7a35'], hillAmp: 120, fog: '#f0cfa8', wallB: '#7e22ce', apron: '#7e22ce' }),
  moor: T({ sunElev: 18, turbidity: 10, rayleigh: 0.6, mie: 0.02, exposure: 0.5, grass: '#5e6b3e', terrain: ['#5e6b3e', '#6b5f4a', '#7a7468'], scenery: { rocks: 400, shrubs: 1200, pines: 300 }, foliage: ['#3a4a2a', '#4a3a3a', '#5a4a6a'], hillAmp: 200, fog: '#a9b1b8', fogDensity: 0.00045, wallB: '#1f2937', apron: '#475569' }),
  snow: T({ sunElev: 20, sunAz: 190, turbidity: 2, grass: '#e8eef2', terrain: ['#e8eef2', '#dfe6ea', '#c9d2d8'], snowLine: 1, relief: 'mountains', hillAmp: 380, scenery: { pines: 1800 }, foliage: ['#1f4d34', '#24583a'], fog: '#e7eef5', wallB: '#0ea5e9', apron: '#0ea5e9' }),
  plains: T({ sunElev: 52, sunAz: 180, grass: '#6a9a3a', terrain: ['#6a9a3a', '#7a9a45', '#8a9a55'], hillAmp: 50, scenery: { trees: 500, shrubs: 600 }, wallB: '#facc15', apron: '#eab308' }),
  sunsetCoast: T({ sunElev: 4, sunAz: 280, turbidity: 6, rayleigh: 2.8, exposure: 0.56, lights: true, grass: '#7a9a4a', terrain: ['#7a9a4a', '#8a8a55', '#9a8a6a'], water: { level: -3, mode: 'side', angle: 4.8 }, scenery: { palms: 700, shrubs: 400 }, foliage: ['#2f7a3a', '#3b8a45'], fog: '#f2b48c', wallB: '#e11d48', apron: '#e11d48', bloom: 0.55 }),
};

/* ------------------------------------------------------------------
   24-round calendar (all layouts original)
   ------------------------------------------------------------------ */
function polar(n, R, harm) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const t = i / n * Math.PI * 2; let r = 1;
    for (const [k, a, ph] of harm) r += a * Math.sin(k * t + ph);
    p.push([Math.cos(t) * R * r, Math.sin(t) * R * r]);
  }
  return p;
}
const S = 'street';
export const TRACKS = [
  { id: 'kestrel', name: 'Kestrel Park', loc: 'Northern Highlands', blurb: 'Flowing parkland classic with a fast opening sector.', theme: 'park', runoff: 14, scale: 10,
    pts: [[-30, 0], [0, 0], [30, 0], [45, 5], [50, 18], [42, 30], [28, 32], [18, 40], [20, 55], [10, 65], [-8, 62], [-15, 48], [-30, 45], [-45, 38], [-50, 22], [-45, 8]] },
  { id: 'sandstorm', name: 'Sandstorm Night Ring', loc: 'Al-Raqim Desert', blurb: 'A floodlit desert night race with two huge straights.', theme: 'desertNight', runoff: 14, scale: 9,
    pts: [[-50, 0], [30, 0], [45, 4], [48, 15], [40, 22], [25, 20], [10, 15], [0, 18], [-5, 28], [5, 38], [30, 40], [45, 48], [42, 60], [25, 62], [-40, 62], [-55, 55], [-60, 40], [-58, 15]] },
  { id: 'coastal', name: 'Coastal Esses', loc: 'Sable Bay', blurb: 'Seaside sweepers and two ribbons of high-speed esses.', theme: 'coastal', runoff: 12, scale: 9,
    pts: [[-50, 0], [20, 0], [40, -3], [55, 5], [58, 20], [48, 28], [55, 38], [48, 48], [55, 58], [40, 68], [20, 64], [5, 70], [-10, 64], [-25, 70], [-45, 62], [-55, 45], [-48, 30], [-58, 15]] },
  { id: 'lantern', name: 'Lantern Quay Night', loc: 'Lantern Quay', blurb: 'Harbourside night street race through the old docks.', theme: 'marinaNight', type: S, runoff: 1.2, scale: 1,
    pts: [[380, 276], [-242, 276], [-276, 242], [-276, 172], [-310, 138], [-380, 138], [-414, 104], [-414, -104], [-380, -138], [-310, -138], [-276, -172], [-276, -242], [-242, -276], [-34, -276], [0, -242], [0, -172], [34, -138], [104, -138], [138, -172], [138, -242], [172, -276], [242, -276], [276, -242], [276, -172], [310, -138], [380, -138], [414, -104], [414, 242]] },
  { id: 'tropica', name: 'Tropica Park', loc: 'Isla Verde', blurb: 'Humid jungle circuit with a sweeping back section.', theme: 'tropical', runoff: 14, scale: 1,
    pts: [[-329, -430], [-72, -606], [118, -741], [290, -589], [456, -451], [553, -269], [650, -171], [713, -72], [814, 54], [790, 191], [688, 245], [573, 154], [505, 33], [319, 39], [130, 70], [-5, 215], [-158, 186], [-312, 246], [-451, 209], [-484, 63], [-568, -15], [-551, -167], [-604, -265], [-487, -313]] },
  { id: 'alpine', name: 'Alpine Ring', loc: 'Glacier Pass', blurb: 'Flowing, rhythmic lap beneath snow-capped peaks.', theme: 'alpine', runoff: 14, scale: 1,
    pts: polar(30, 430, [[3, 0.22, 0], [5, 0.08, 1.3]]) },
  { id: 'harbour', name: 'Harbour Street Circuit', loc: 'Port Calloway', blurb: 'Right-angle corners with the walls close on both sides.', theme: 'street', type: S, runoff: 1.2, scale: 9,
    pts: [[-36, 0], [0, 0], [12, 0], [15, 3], [19, 3], [22, 0], [36, 0], [40, 4], [40, 16], [36, 20], [20, 20], [16, 24], [16, 36], [12, 40], [-10, 40], [-14, 36], [-14, 28], [-18, 24], [-36, 24], [-40, 20], [-40, 4]] },
  { id: 'vinehill', name: 'Vinehill Circuit', loc: 'Bellvigne', blurb: 'Golden-hour run through rolling vineyard country.', theme: 'vineyard', runoff: 14, scale: 1,
    pts: [[2, 559], [-279, 511], [-513, 441], [-651, 414], [-693, 258], [-695, 165], [-732, -70], [-627, -212], [-524, -275], [-396, -329], [-232, -344], [-39, -273], [106, -325], [195, -316], [307, -216], [322, -125], [435, -103], [556, -120], [637, 5], [729, 112], [641, 281], [655, 400], [503, 415], [380, 481], [158, 586]] },
  { id: 'forest', name: 'Old Forest Speedway', loc: 'Thornwood', blurb: 'Flat-out power circuit through the old pines.', theme: 'forest', runoff: 16, scale: 1,
    pts: polar(28, 540, [[2, 0.18, 0.5], [4, 0.07, 0], [7, 0.03, 2]]) },
  { id: 'cedar', name: 'Cedar Valley Raceway', loc: 'Cedar Valley', blurb: 'Technical valley track, ringed by the river.', theme: 'river', runoff: 14, scale: 1,
    pts: [[398, 292], [80, 282], [-89, 247], [-346, 236], [-542, 244], [-604, 130], [-570, 31], [-594, -146], [-433, -252], [-207, -337], [-52, -262], [54, -242], [200, -173], [296, -138], [474, -249], [593, -274], [593, -146], [508, -31], [632, 48], [728, 218], [659, 275], [569, 288]] },
  { id: 'crimson', name: 'Crimson Dunes', loc: 'Sahrin Basin', blurb: 'Scorching midday desert circuit with a tricky final sector.', theme: 'desertDay', runoff: 14, scale: 1,
    pts: [[-37, 536], [-329, 424], [-498, 365], [-607, 336], [-522, 175], [-500, -16], [-623, -93], [-643, -279], [-543, -265], [-453, -266], [-352, -210], [-235, -243], [-78, -254], [117, -176], [187, -51], [240, 56], [452, 54], [619, 97], [590, 201], [589, 340], [418, 435], [276, 499], [154, 624]] },
  { id: 'highmoor', name: 'Highmoor Circuit', loc: 'Ravensmoor', blurb: 'Grey skies and fast moorland corners.', theme: 'moor', runoff: 14, scale: 1,
    pts: [[-275, -305], [3, -264], [160, -235], [413, -260], [600, -328], [637, -170], [594, -16], [595, 152], [660, 307], [480, 317], [386, 274], [185, 356], [-10, 314], [-247, 331], [-518, 387], [-672, 348], [-743, 237], [-685, 26], [-591, -134], [-613, -326], [-516, -332]] },
  { id: 'lakeside', name: 'Lakeside Ring', loc: 'Lake Varra', blurb: 'Lakeshore circuit with a long, sweeping first half.', theme: 'lake', runoff: 14, scale: 1,
    pts: [[371, 292], [123, 500], [-29, 624], [-218, 622], [-372, 593], [-486, 449], [-543, 342], [-635, 237], [-821, 69], [-825, -131], [-660, -292], [-589, -347], [-489, -273], [-314, -318], [-172, -291], [-39, -317], [145, -302], [236, -301], [324, -208], [442, -237], [464, -92], [507, -7], [636, 134], [487, 219]] },
  { id: 'riverside', name: 'Riverside Hairpins', loc: 'Vellmoor Valley', blurb: 'Hard braking and two hairpins. Patience pays.', theme: 'river', runoff: 12, scale: 10,
    pts: [[-40, 0], [20, 0], [32, 4], [34, 14], [26, 18], [10, 16], [4, 22], [10, 30], [30, 30], [42, 36], [42, 48], [32, 52], [-5, 50], [-12, 44], [-8, 36], [-20, 30], [-35, 32], [-44, 24], [-46, 10]] },
  { id: 'marrowind', name: 'Marrowind Raceway', loc: 'Ashford Hills', blurb: 'Autumn colours and a relentless run of corners.', theme: 'autumn', runoff: 14, scale: 1,
    pts: [[-476, -367], [-173, -514], [-1, -619], [119, -775], [279, -704], [491, -653], [540, -517], [618, -400], [602, -249], [560, -105], [683, 84], [494, 213], [430, 349], [252, 400], [92, 417], [-21, 490], [-114, 479], [-278, 439], [-490, 400], [-608, 331], [-507, 162], [-540, -93], [-614, -189], [-667, -313]] },
  { id: 'prairie', name: 'Velocity Plains', loc: 'Great Prairie', blurb: 'Big, open and fast. Slipstream is king.', theme: 'plains', runoff: 16, scale: 1,
    pts: [[-912, -78], [-701, -428], [-516, -607], [-388, -704], [-165, -759], [0, -726], [199, -693], [359, -587], [475, -421], [613, -386], [741, -334], [804, -177], [859, 18], [755, 144], [644, 160], [561, 290], [508, 384], [397, 412], [309, 431], [208, 307], [22, 305], [-140, 262], [-283, 275], [-490, 380], [-614, 303], [-741, 247], [-855, 105], [-904, 12]] },
  { id: 'skyline', name: 'Skyline Downtown', loc: 'Metro City', blurb: 'Daytime blast between glass towers.', theme: 'city', type: S, runoff: 1.2, scale: 1,
    pts: [[-356, -218], [356, -218], [382, -193], [382, -134], [356, -109], [298, -109], [273, -84], [273, -25], [298, 0], [356, 0], [382, 25], [382, 193], [356, 218], [-356, 218], [-381, 193], [-381, 134], [-356, 109], [-298, 109], [-272, 84], [-272, 25], [-298, 0], [-356, 0], [-381, -25], [-381, -193]] },
  { id: 'canyon', name: 'Canyon Loop', loc: 'Red Mesa', blurb: 'Sunset run through the red rock, with deceptive corners.', theme: 'canyon', runoff: 10, scale: 1,
    pts: polar(32, 450, [[4, 0.2, 0.3], [6, 0.08, 1.0], [1, 0.1, 0]]) },
  { id: 'saltpan', name: 'Saltpan Speedway', loc: 'Mirage Flats', blurb: 'Dusk race on the salt flats as the floodlights come on.', theme: 'saltpan', runoff: 16, scale: 1,
    pts: [[-169, -981], [282, -972], [474, -821], [709, -712], [805, -555], [876, -324], [964, -164], [903, -80], [870, 98], [749, 231], [590, 257], [441, 227], [352, 184], [209, 249], [84, 343], [-34, 285], [-138, 354], [-227, 337], [-335, 294], [-461, 236], [-576, 259], [-664, 238], [-810, 126], [-839, -70], [-772, -228], [-851, -329], [-853, -419], [-669, -656], [-536, -826]] },
  { id: 'bellmont', name: 'Bellmont Old Town', loc: 'Bellmont', blurb: 'Late-afternoon street fight through the old quarter.', theme: 'street', type: S, runoff: 1.2, scale: 1,
    pts: [[-38, -208], [455, -208], [487, -177], [487, 177], [455, 209], [240, 209], [209, 177], [209, 101], [177, 70], [101, 70], [70, 101], [70, 177], [38, 209], [-455, 209], [-486, 177], [-486, 101], [-455, 70], [-379, 70], [-347, 38], [-347, -38], [-379, -69], [-455, -69], [-486, -101], [-486, -177], [-455, -208], [-240, -208], [-208, -177], [-208, 38], [-177, 70], [-101, 70], [-69, 38], [-69, -177]] },
  { id: 'frostgate', name: 'Frostgate Autodrome', loc: 'Frostgate', blurb: 'Winter speed circuit carved through the snowfields.', theme: 'snow', runoff: 16, scale: 1,
    pts: [[-27, 474], [-480, 443], [-755, 401], [-888, 356], [-828, 247], [-626, 133], [-586, 32], [-673, -109], [-629, -187], [-443, -85], [-331, -151], [-150, -187], [35, -246], [139, -349], [406, -321], [670, -335], [745, -143], [783, -36], [896, 173], [834, 343], [708, 464], [455, 547], [337, 447], [217, 412]] },
  { id: 'riverlight', name: 'Riverlight Night', loc: 'Riverlight', blurb: 'Neon-washed night street race by the river.', theme: 'streetNight', type: S, runoff: 1.2, scale: 1,
    pts: [[418, 192], [-34, 192], [-64, 162], [-64, 94], [-94, 64], [-162, 64], [-192, 94], [-192, 162], [-222, 192], [-418, 192], [-448, 162], [-448, -34], [-418, -64], [-350, -64], [-320, -94], [-320, -162], [-290, -192], [34, -192], [64, -162], [64, -94], [94, -64], [162, -64], [192, -94], [192, -162], [222, -192], [290, -192], [320, -162], [320, -94], [350, -64], [418, -64], [448, -34], [448, 162]] },
  { id: 'palmera', name: 'Sunset Coast Raceway', loc: 'Palmera Coast', blurb: 'Clifftop speed under a burning sunset sky.', theme: 'sunsetCoast', runoff: 16, scale: 1,
    pts: [[-683, -473], [-328, -691], [-45, -827], [164, -825], [360, -640], [462, -372], [555, -264], [654, -150], [670, -43], [594, 41], [534, 130], [470, 244], [349, 258], [174, 444], [11, 431], [-170, 319], [-286, 219], [-487, 180], [-636, 149], [-743, 97], [-874, 95], [-1018, 8], [-1030, -158], [-930, -327]] },
  { id: 'neonbay', name: 'Neon Bay Night', loc: 'Neon Bay', blurb: 'The season finale: a neon-lit street circuit at midnight.', theme: 'streetNight', type: S, runoff: 1.2, scale: 9,
    pts: [[-40, 0], [25, 0], [31, 6], [31, 22], [25, 28], [6, 28], [0, 34], [0, 46], [-6, 52], [-32, 52], [-38, 46], [-38, 32], [-28, 24], [-30, 14], [-44, 12], [-52, 4], [-50, -3]] },
];

/* Lightweight centreline for menu previews */
export function previewPoints(def, n = 240) {
  const s = def.scale || 1;
  const curve = new THREE.CatmullRomCurve3(def.pts.map(p => new THREE.Vector3(p[0] * s, 0, p[1] * s)), true, 'centripetal');
  return { pts: curve.getSpacedPoints(n).map(p => [p.x, p.z]), length: curve.getLength() };
}

/* ------------------------------------------------------------------
   Full track data: samples, frame, walls, racing line, speed profile
   ------------------------------------------------------------------ */
const cache = new Map();
export function getTrack(i) {
  if (!cache.has(i)) cache.set(i, buildTrackData(TRACKS[i]));
  return cache.get(i);
}

function buildTrackData(def) {
  const s = def.scale || 1, street = def.type === 'street';
  const v3 = def.pts.map(p => new THREE.Vector3(p[0] * s, 0, p[1] * s));
  const curve = new THREE.CatmullRomCurve3(v3, true, 'centripetal');
  const N = Math.round(curve.getLength() / DS);
  const raw = curve.getSpacedPoints(N); raw.pop();
  const sp = v3[0].clone().lerp(v3[1], 0.6);
  let si = 0, bd = 1e18;
  raw.forEach((p, i) => { const d = p.distanceToSquared(sp); if (d < bd) { bd = d; si = i; } });

  const T = { def, N, street, length: N * DS, wallOff: W + KERB + def.runoff, theme: THEMES[def.theme] };
  const F = () => new Float32Array(N);
  const px = T.px = F(), pz = T.pz = F(), tx = T.tx = F(), tz = T.tz = F(), nx = T.nx = F(), nz = T.nz = F();
  for (let i = 0; i < N; i++) { const p = raw[(i + si) % N]; px[i] = p.x; pz[i] = p.z; }
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    let dx = px[b] - px[a], dz = pz[b] - pz[a]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    tx[i] = dx; tz[i] = dz; nx[i] = dz; nz[i] = -dx;
  }
  const cr = F(), curv = T.curv = F();
  for (let i = 0; i < N; i++) { const a = (i - 1 + N) % N, b = (i + 1) % N; cr[i] = -(tx[a] * tz[b] - tz[a] * tx[b]) / (2 * DS); }
  for (let i = 0; i < N; i++) { let sum = 0; for (let k = -4; k <= 4; k++) sum += cr[(i + k + N) % N]; curv[i] = sum / 9; }
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0; i < N; i++) { minX = Math.min(minX, px[i]); maxX = Math.max(maxX, px[i]); minZ = Math.min(minZ, pz[i]); maxZ = Math.max(maxZ, pz[i]); }
  Object.assign(T, { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, radius: Math.max(maxX - minX, maxZ - minZ) / 2 });

  // wall limits
  const minLim = W + KERB + 0.8;
  const limL0 = F().fill(T.wallOff), limR0 = F().fill(T.wallOff);
  for (let i = 0; i < N; i++) for (let k = -25; k <= 25; k++) {
    const c = curv[(i + k + N) % N];
    if (c > 1e-4) limL0[i] = Math.min(limL0[i], 0.85 / c); else if (c < -1e-4) limR0[i] = Math.min(limR0[i], 0.85 / -c);
  }
  const reach = 2 * T.wallOff + 10, reach2 = reach * reach;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j += 3) {
    let di = Math.abs(i - j); di = Math.min(di, N - di);
    if (di * DS < 90) continue;
    const dx = px[j] - px[i], dz = pz[j] - pz[i], d2 = dx * dx + dz * dz;
    if (d2 > reach2) continue;
    const lim = Math.sqrt(d2) / 2 - 1;
    if (dx * nx[i] + dz * nz[i] > 0) limL0[i] = Math.min(limL0[i], lim); else limR0[i] = Math.min(limR0[i], lim);
  }
  const smoothLim = src => {
    const mn = F(), out = F();
    for (let i = 0; i < N; i++) { let m = 1e9; for (let k = -6; k <= 6; k++) m = Math.min(m, src[(i + k + N) % N]); mn[i] = m; }
    for (let i = 0; i < N; i++) { let s2 = 0; for (let k = -6; k <= 6; k++) s2 += mn[(i + k + N) % N]; out[i] = Math.max(minLim, s2 / 13); }
    return out;
  };
  T.limL = smoothLim(limL0); T.limR = smoothLim(limR0);

  // racing line
  const K = 5, M = Math.floor(N / K), maxO = W - 0.9, off = new Float32Array(M), ci = m => m * K;
  for (let it = 0; it < 900; it++) for (let m = 0; m < M; m++) {
    const a = ci((m - 1 + M) % M), b = ci((m + 1) % M), c = ci(m), oa = off[(m - 1 + M) % M], ob = off[(m + 1) % M];
    const mx = (px[a] + nx[a] * oa + px[b] + nx[b] * ob) / 2, mz = (pz[a] + nz[a] * oa + pz[b] + nz[b] * ob) / 2;
    const o = (mx - px[c]) * nx[c] + (mz - pz[c]) * nz[c];
    off[m] = clamp(off[m] + (o - off[m]) * 0.95, -maxO, maxO);
  }
  const race = T.race = F();
  for (let i = 0; i < N; i++) { const m = Math.floor(i / K), f = (i - m * K) / K, a = off[m % M], b = off[(m + 1) % M]; race[i] = a + (b - a) * f; }
  const rx = F(), rz = F();
  for (let i = 0; i < N; i++) { rx[i] = px[i] + nx[i] * race[i]; rz[i] = pz[i] + nz[i] * race[i]; }
  const kr = F(), rks = F();
  for (let i = 0; i < N; i++) {
    const a = (i - 4 + N) % N, b = (i + 4) % N, ax = rx[a], az = rz[a], bx = rx[i], bz = rz[i], cx = rx[b], cz = rz[b];
    const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    const d = Math.hypot(bx - ax, bz - az) * Math.hypot(cx - bx, cz - bz) * Math.hypot(cx - ax, cz - az);
    kr[i] = d > 0 ? Math.abs(2 * cross / d) : 0;
    rks[i] = d > 0 ? -2 * cross / d : 0;
  }
  T.rk = new Float32Array(N); for (let i = 0; i < N; i++) { let a = 0; for (let j = -3; j <= 3; j++) a += rks[(i + j + N) % N]; T.rk[i] = a / 7; }
  const vcorner = F();
  for (let i = 0; i < N; i++) {
    let k = 0; for (let j = -1; j <= 1; j++) k = Math.max(k, kr[(i + j + N) % N]);
    vcorner[i] = k > 1e-5 ? Math.min(95, (0.25 + Math.sqrt(0.0625 + 4 * k * 18)) / (2 * k)) : 95;
  }
  // braking profiles: cautious (most AI) and late-braking (top-level AI)
  const brakeProfile = brk => {
    const v = Float32Array.from(vcorner);
    for (let pass = 0; pass < 3; pass++) for (let i = N - 1; i >= 0; i--) {
      const nv = v[(i + 1) % N], lim = Math.sqrt(nv * nv + 2 * brk * DS);
      if (v[i] > lim) v[i] = lim;
    }
    return v;
  };
  T.vprof = brakeProfile(24);
  T.vprof2 = brakeProfile(34.5);

  // DRS: the longest straights get a zone, with a detection point 150 m before activation
  {
    // flowing tracks may have no dead-straight sections, so relax the threshold until zones appear
    let runs = [], s0 = 0;
    for (const R of [700, 450, 300]) {
      s0 = 0; while (s0 < N && Math.abs(curv[s0]) < 1 / R) s0++;
      runs = []; let rs = -1;
      for (let k = 0; k <= N; k++) {
        const i = (s0 + k) % N, st = k < N && Math.abs(curv[i]) < 1 / R;
        if (st && rs < 0) rs = k;
        if (!st && rs >= 0) { if (k - rs >= 110) runs.push([rs, k - 1]); rs = -1; }
      }
      if (runs.length >= 2 || (runs.length && R === 300)) break;
    }
    runs.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
    T.drs = runs.slice(0, N > 1800 ? 3 : 2).map(([a, b]) => {
      const start = (s0 + a + 15) % N, end = (s0 + b - 5) % N;
      return { start, end, detect: (start - 75 + N) % N, len: (b - a - 20) * DS };
    }).sort((a, b) => a.start - b.start);
  }

  // corners → kerbs, gravel on the outside
  const isC = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (Math.abs(curv[i]) > 1 / 230) for (let k = -10; k <= 10; k++) isC[(i + k + N) % N] = 1;
  const ranges = []; let start = -1;
  for (let i = 0; i < N; i++) {
    if (isC[i] && start < 0) start = i;
    if ((!isC[i] || i === N - 1) && start >= 0) { ranges.push([start, isC[i] ? i : i - 1]); start = -1; }
  }
  if (ranges.length > 1 && ranges[0][0] === 0 && ranges[ranges.length - 1][1] === N - 1) { const last = ranges.pop(); ranges[0] = [last[0], ranges[0][1] + N]; }
  T.kerbs = ranges; T.turns = ranges.length;
  const gravel = T.gravel = new Int8Array(N);
  if (!street) for (const [s0, e0] of ranges) {
    let sum = 0; for (let i = s0; i <= e0; i++) sum += curv[i % N];
    const side = sum > 0 ? -1 : 1;
    for (let i = s0 + 4; i <= e0 + 22; i++) gravel[i % N] = side;
  }
  // pit lane alongside the start straight, on whichever side has more room
  {
    let back = 0; while (back < 140 && Math.abs(curv[(N - back - 1) % N]) < 1 / 300) back++;
    let fwd = 0; while (fwd < 140 && Math.abs(curv[fwd % N]) < 1 / 300) fwd++;
    const entry = (N - Math.max(55, back - 5)) % N, exit = Math.max(60, fwd - 5);
    const range = []; for (let i = entry; i !== exit; i = (i + 1) % N) range.push(i);
    const room = sd => Math.min(...range.map(i => sd > 0 ? T.limL[i] : T.limR[i]));
    const side = room(1) >= room(-1) ? 1 : -1;
    const lim = Math.max(...range.map(i => side > 0 ? T.limL[i] : T.limR[i]));
    T.pit = { side, entry, exit, wall: lim, lat: side * (lim + 5.5), len: range.length, boxStart: 8, boxGap: 3 };
  }
  return T;
}

export function locate(T, x, z, hint) {
  let best = hint, bd = Infinity;
  for (let k = -40; k <= 40; k++) {
    const i = (hint + k + T.N) % T.N, dx = x - T.px[i], dz = z - T.pz[i], d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/* Nearest-sample search over the whole track (used once for scenery) */
export function nearestFull(T, x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < T.N; i += 2) { const dx = x - T.px[i], dz = z - T.pz[i], d = dx * dx + dz * dz; if (d < bd) { bd = d; best = i; } }
  return best;
}

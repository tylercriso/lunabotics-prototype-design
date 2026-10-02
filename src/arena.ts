import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

/**
 * Artemis Arena per the 2026–27 Guidebook §11 (Figure 9 "Arena Dimensions and Obstacle Layout").
 *
 * Arena frame: origin at the starting-zone corner, X along the 6.88 m length toward the construction
 * zone, Y along the 5 m width. World frame is three.js Y-up: world = (X, height, −Y), so a top-down
 * view matches the figure.
 *
 * Everything the LiDAR can see is described twice: once as three.js meshes for rendering and once as
 * analytic primitives (heightfield, ellipsoids, boxes, cylinders) for fast ray casting. Both are built
 * from the same `Layout` so they always agree.
 */

export const ARENA = {
  L: 6.88, // interior length (§11.2.1)
  W: 5.0, // interior width
  wallH: 1.0, // not specified in the guidebook; typical containment wall ~1 m
  wallT: 0.1,
  pipeR: 0.085, // 17 cm PVC along the inside perimeter
  excavationX: 2.5, // excavation zone 0 … 2.5 m
  startZone: { x: 2.0, y: 2.0 }, // starting zone in the (0,0) corner, no rocks or craters
  construction: { x0: 3.88, y1: 1.5 }, // construction zone ≈ 3 × 1.5 m in the far corner
  berm: { cx: 5.38, cy: 0.9, l: 2.2, w: 0.9, h: 0.28 }, // 2.2 × 0.9 m box centred at (5.38, 0.9)
  column: { cx: 3.63, cy: 2.45, s: 0.5, h: 3.0 }, // permanent central support column
};

export interface Crater { x: number; y: number; r: number; depth: number }
export interface Rock { x: number; y: number; rx: number; ry: number; rz: number; yaw: number }
export interface Layout { craters: Crater[]; rocks: Rock[] }

/** Approximate positions read off Figure 9. */
export const FIGURE_9_LAYOUT: Layout = {
  craters: [
    { x: 0.54, y: 4.39, r: 0.25, depth: 0.14 },
    { x: 6.15, y: 4.27, r: 0.24, depth: 0.12 },
    { x: 3.15, y: 1.0, r: 0.22, depth: 0.16 },
  ],
  rocks: [
    { x: 1.92, y: 4.34, rx: 0.19, ry: 0.15, rz: 0.16, yaw: 0.4 },
    { x: 3.48, y: 4.45, rx: 0.17, ry: 0.18, rz: 0.2, yaw: 1.2 },
    { x: 0.38, y: 2.76, rx: 0.16, ry: 0.12, rz: 0.18, yaw: 2.0 },
    { x: 2.83, y: 2.76, rx: 0.2, ry: 0.2, rz: 0.17, yaw: 0.9 },
    { x: 4.61, y: 2.64, rx: 0.18, ry: 0.14, rz: 0.19, yaw: 2.6 },
    { x: 6.47, y: 3.11, rx: 0.15, ry: 0.11, rz: 0.17, yaw: 0.2 },
    { x: 2.3, y: 0.71, rx: 0.19, ry: 0.17, rz: 0.15, yaw: 1.7 },
  ],
};

/**
 * Closed slalom through the obstacle field (arena coords). Tuned so the centripetal spline keeps
 * ≥0.95 m from the walls and ≥0.5 m from the column and every Figure 9 boulder/crater.
 */
export const TOUR_WAYPOINTS: [number, number][] = [
  [1.0, 1.0], [2.2, 1.6], [3.0, 1.75], [3.7, 1.6], [4.4, 1.85], [5.6, 2.1], [5.8, 2.9],
  [5.5, 3.9], [4.5, 3.6], [3.6, 3.5], [2.6, 3.7], [1.5, 3.4], [1.1, 2.4], [1.0, 1.6],
];

export function toWorld(ax: number, ay: number, h = 0) {
  return new THREE.Vector3(ax, h, -ay);
}

// ---------- hit classification ----------
export enum Surface { Ground = 0, Crater = 1, Berm = 2, Rock = 3, Column = 4, Wall = 5, Pipe = 6, Miss = 7 }
export const SURFACE_NAMES = ['Regolith', 'Crater', 'Berm', 'Boulder', 'Column', 'Wall', 'PVC pipe', 'No return'];
export const SURFACE_COLORS = [0x9a9080, 0x3da5ff, 0xffb020, 0xff4d4d, 0xc77dff, 0xdfe6f0, 0xffe066, 0x3a4150].map(
  (c) => new THREE.Color(c),
);
/** Rough laser albedo used for the simulated intensity: BP-1 is dark crushed basalt (§11.1.3). */
export const SURFACE_ALBEDO = [0.1, 0.08, 0.11, 0.16, 0.45, 0.5, 0.85, 0];

export interface Hit {
  t: number;
  nx: number; ny: number; nz: number;
  surface: Surface;
}

// ---------- analytic scene ----------
/** Everything needed to ray-cast the arena without a mesh BVH. */
export class ArenaCaster {
  private craters: { x: number; z: number; r: number; depth: number }[] = [];
  private rocks: { x: number; z: number; yc: number; rx: number; ry: number; rz: number; c: number; s: number }[] = [];
  bermVisible = true;
  private hMin = -0.3;
  private hMax = 0.3;
  /** Robot body as an oriented box so beams aimed down through the chassis are masked like a real driver does. */
  private robot = { x: 0, z: 0, c: 1, s: 0 };

  setRobotPose(x: number, z: number, heading: number) {
    this.robot.x = x; this.robot.z = z;
    this.robot.c = Math.cos(heading); this.robot.s = Math.sin(heading);
  }

  setLayout(layout: Layout) {
    this.craters = layout.craters.map((c) => ({ x: c.x, z: -c.y, r: c.r, depth: c.depth }));
    this.rocks = layout.rocks.map((r) => ({
      x: r.x, z: -r.y, yc: r.ry * 0.3, rx: r.rx, ry: r.ry, rz: r.rz, c: Math.cos(r.yaw), s: Math.sin(r.yaw),
    }));
    this.hMin = -Math.max(0.05, ...layout.craters.map((c) => c.depth)) - 0.01;
    this.hMax = ARENA.berm.h + 0.06;
  }

  /** Terrain height at world (x, z). */
  height(x: number, z: number) {
    // raked "fluffy" top layer: a few mm of texture so flat ground is not perfectly flat
    let h = 0.004 * Math.sin(x * 7.3) * Math.sin(z * 6.1) + 0.003 * Math.sin(x * 17 + 1) * Math.cos(z * 13);
    for (const c of this.craters) {
      const dx = x - c.x, dz = z - c.z;
      const rr = c.r * 1.4;
      const q = dx * dx + dz * dz;
      if (q > rr * rr) continue;
      const u = Math.sqrt(q) / c.r;
      if (u < 1) {
        const w = 1 - u * u;
        h -= c.depth * w * w;
      }
      const e = (u - 1.08) / 0.2; // ejecta rim
      h += 0.22 * c.depth * Math.exp(-e * e);
    }
    if (this.bermVisible) {
      const b = ARENA.berm;
      const ex = (x - b.cx) / (b.l / 2), ez = (z + b.cy) / (b.w / 2);
      const e2 = ex * ex + ez * ez;
      if (e2 < 1) h += b.h * Math.pow(1 - e2, 0.8);
    }
    return h;
  }

  private classifyGround(x: number, z: number, h: number): Surface {
    const b = ARENA.berm;
    if (this.bermVisible) {
      const ex = (x - b.cx) / (b.l / 2), ez = (z + b.cy) / (b.w / 2);
      if (ex * ex + ez * ez < 1 && h > 0.015) return Surface.Berm;
    }
    return h < -0.015 ? Surface.Crater : Surface.Ground;
  }

  /** Cast a ray from (ox,oy,oz) along unit (dx,dy,dz), up to `range`. Returns false on a miss. */
  cast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, range: number, out: Hit): boolean {
    let best = range;
    out.surface = Surface.Miss;

    // --- walls (interior faces + top are what matters) ---
    const { L, W, wallH, wallT } = ARENA;
    best = this.box(ox, oy, oz, dx, dy, dz, -wallT, 0, -W - wallT, 0, wallH, wallT, best, Surface.Wall, out);
    best = this.box(ox, oy, oz, dx, dy, dz, L, 0, -W - wallT, L + wallT, wallH, wallT, best, Surface.Wall, out);
    best = this.box(ox, oy, oz, dx, dy, dz, -wallT, 0, 0, L + wallT, wallH, wallT, best, Surface.Wall, out);
    best = this.box(ox, oy, oz, dx, dy, dz, -wallT, 0, -W - wallT, L + wallT, wallH, -W, best, Surface.Wall, out);

    // --- column ---
    const c = ARENA.column;
    best = this.box(ox, oy, oz, dx, dy, dz, c.cx - c.s / 2, 0, -c.cy - c.s / 2, c.cx + c.s / 2, c.h, -c.cy + c.s / 2, best, Surface.Column, out);

    // --- PVC pipe along the four walls ---
    const pr = ARENA.pipeR;
    best = this.cylX(ox, oy, oz, dx, dy, dz, pr, -pr, 0, L, best, out); // along +X at y=0 edge (z = −r)
    best = this.cylX(ox, oy, oz, dx, dy, dz, pr, -W + pr, 0, L, best, out);
    best = this.cylZ(ox, oy, oz, dx, dy, dz, pr, pr, -W, 0, best, out);
    best = this.cylZ(ox, oy, oz, dx, dy, dz, pr, L - pr, -W, 0, best, out);

    // --- boulders (ellipsoids, yawed about Y) ---
    for (const r of this.rocks) {
      // transform to the rock's local frame
      const px = ox - r.x, pz = oz - r.z, py = oy - r.yc;
      const lx = (px * r.c + pz * r.s) / r.rx, lz = (-px * r.s + pz * r.c) / r.rz, ly = py / r.ry;
      const ldx = (dx * r.c + dz * r.s) / r.rx, ldz = (-dx * r.s + dz * r.c) / r.rz, ldy = dy / r.ry;
      const A = ldx * ldx + ldy * ldy + ldz * ldz;
      const B = 2 * (lx * ldx + ly * ldy + lz * ldz);
      const C = lx * lx + ly * ly + lz * lz - 1;
      const disc = B * B - 4 * A * C;
      if (disc < 0) continue;
      const t = (-B - Math.sqrt(disc)) / (2 * A);
      if (t <= 0 || t >= best) continue;
      best = t;
      // normal in local sphere space → world
      const sx = lx + ldx * t, sy = ly + ldy * t, sz = lz + ldz * t;
      const gx = sx / r.rx, gy = sy / r.ry, gz = sz / r.rz; // gradient in rock frame
      const wx = gx * r.c - gz * r.s, wz = gx * r.s + gz * r.c;
      const n = Math.hypot(wx, gy, wz) || 1;
      out.nx = wx / n; out.ny = gy / n; out.nz = wz / n;
      out.surface = Surface.Rock;
    }

    // --- terrain heightfield: march only through the band [hMin, hMax] ---
    let t0 = 0, t1 = best;
    if (Math.abs(dy) > 1e-6) {
      const ta = (this.hMax - oy) / dy, tb = (this.hMin - oy) / dy;
      t0 = Math.max(0, Math.min(ta, tb));
      t1 = Math.min(best, Math.max(ta, tb));
    } else if (oy > this.hMax || oy < this.hMin) {
      t1 = -1;
    }
    if (t1 > t0) {
      let tPrev = t0;
      let fPrev = oy + dy * tPrev - this.height(ox + dx * tPrev, oz + dz * tPrev);
      if (fPrev > 0) {
        for (;;) {
          // adaptive step: terrain slope is ≲1.1 and the ray drops ≤|dy| per metre, so 0.4·clearance cannot skip a hit
          const tc = Math.min(tPrev + Math.max(0.05, Math.min(0.5, 0.4 * fPrev)), t1);
          const sx = ox + dx * tc, sz = oz + dz * tc;
          if (sx < 0 || sx > ARENA.L || sz > 0 || sz < -ARENA.W) break; // left the arena over the wall
          const f = oy + dy * tc - this.height(sx, sz);
          if (f <= 0) {
            // refine by bisection
            let a = tPrev, b = tc;
            for (let i = 0; i < 6; i++) {
              const m = (a + b) / 2;
              const fm = oy + dy * m - this.height(ox + dx * m, oz + dz * m);
              if (fm <= 0) b = m; else a = m;
            }
            const th = (a + b) / 2;
            if (th < best) {
              best = th;
              const hx = ox + dx * th, hz = oz + dz * th;
              const e = 0.02;
              const nx = this.height(hx - e, hz) - this.height(hx + e, hz);
              const nz = this.height(hx, hz - e) - this.height(hx, hz + e);
              const n = Math.hypot(nx, 2 * e, nz);
              out.nx = nx / n; out.ny = (2 * e) / n; out.nz = nz / n;
              out.surface = this.classifyGround(hx, hz, oy + dy * th);
            }
            break;
          }
          if (tc >= t1) break;
          tPrev = tc;
          fPrev = f;
        }
      }
    }

    out.t = best;
    if (out.surface === Surface.Miss) return false;

    // --- self-occlusion: stowed robot envelope ≈ 108 × 74 × 73 cm around the chassis origin ---
    const rb = this.robot;
    const px = ox - rb.x, pz = oz - rb.z;
    const lx = px * rb.c - pz * rb.s, lz = px * rb.s + pz * rb.c;
    const ldx = dx * rb.c - dz * rb.s, ldz = dx * rb.s + dz * rb.c;
    const saved = out.surface;
    const tSelf = this.box(lx, oy, lz, ldx, dy, ldz, -0.63, 0, -0.37, 0.45, 0.73, 0.37, best, Surface.Miss, out);
    if (tSelf < best) {
      out.t = tSelf;
      return false;
    }
    out.surface = saved;
    return true;
  }

  private box(
    ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
    x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
    best: number, surf: Surface, out: Hit,
  ) {
    if (z0 > z1) { const t = z0; z0 = z1; z1 = t; }
    let tmin = 0, tmax = best, axis = -1, sign = 0;
    // slab test, unrolled per axis to stay allocation-free (this runs ~10× per beam)
    if (Math.abs(dx) < 1e-9) {
      if (ox < x0 || ox > x1) return best;
    } else {
      const inv = 1 / dx;
      let ta = (x0 - ox) * inv, tb = (x1 - ox) * inv, s = -1;
      if (ta > tb) { const t = ta; ta = tb; tb = t; s = 1; }
      if (ta > tmin) { tmin = ta; axis = 0; sign = s; }
      if (tb < tmax) tmax = tb;
      if (tmin > tmax) return best;
    }
    if (Math.abs(dy) < 1e-9) {
      if (oy < y0 || oy > y1) return best;
    } else {
      const inv = 1 / dy;
      let ta = (y0 - oy) * inv, tb = (y1 - oy) * inv, s = -1;
      if (ta > tb) { const t = ta; ta = tb; tb = t; s = 1; }
      if (ta > tmin) { tmin = ta; axis = 1; sign = s; }
      if (tb < tmax) tmax = tb;
      if (tmin > tmax) return best;
    }
    if (Math.abs(dz) < 1e-9) {
      if (oz < z0 || oz > z1) return best;
    } else {
      const inv = 1 / dz;
      let ta = (z0 - oz) * inv, tb = (z1 - oz) * inv, s = -1;
      if (ta > tb) { const t = ta; ta = tb; tb = t; s = 1; }
      if (ta > tmin) { tmin = ta; axis = 2; sign = s; }
      if (tb < tmax) tmax = tb;
      if (tmin > tmax) return best;
    }
    if (axis < 0 || tmin <= 0 || tmin >= best) return best;
    out.nx = axis === 0 ? sign : 0; out.ny = axis === 1 ? sign : 0; out.nz = axis === 2 ? sign : 0;
    out.surface = surf;
    return tmin;
  }

  /** Cylinder along X at (y=cy, z=cz) spanning x0..x1. */
  private cylX(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, r: number, cz: number, x0: number, x1: number, best: number, out: Hit) {
    const py = oy - r, pz = oz - cz;
    const A = dy * dy + dz * dz, B = 2 * (py * dy + pz * dz), C = py * py + pz * pz - r * r;
    const disc = B * B - 4 * A * C;
    if (A < 1e-12 || disc < 0) return best;
    const t = (-B - Math.sqrt(disc)) / (2 * A);
    if (t <= 0 || t >= best) return best;
    const hx = ox + dx * t;
    if (hx < x0 || hx > x1) return best;
    out.nx = 0; out.ny = (py + dy * t) / r; out.nz = (pz + dz * t) / r;
    out.surface = Surface.Pipe;
    return t;
  }

  /** Cylinder along Z at (x=cx, y=r) spanning z0..z1. */
  private cylZ(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, r: number, cx: number, z0: number, z1: number, best: number, out: Hit) {
    const px = ox - cx, py = oy - r;
    const A = dx * dx + dy * dy, B = 2 * (px * dx + py * dy), C = px * px + py * py - r * r;
    const disc = B * B - 4 * A * C;
    if (A < 1e-12 || disc < 0) return best;
    const t = (-B - Math.sqrt(disc)) / (2 * A);
    if (t <= 0 || t >= best) return best;
    const hz = oz + dz * t;
    if (hz < z0 || hz > z1) return best;
    out.nx = (px + dx * t) / r; out.ny = (py + dy * t) / r; out.nz = 0;
    out.surface = Surface.Pipe;
    return t;
  }
}

// ---------- tour path ----------
export class TourPath {
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;
  private readonly samples: THREE.Vector3[];
  constructor(points: [number, number][]) {
    this.curve = new THREE.CatmullRomCurve3(points.map(([x, y]) => toWorld(x, y)), true, 'centripetal', 0.5);
    this.length = this.curve.getLength();
    this.samples = this.curve.getSpacedPoints(300);
  }
  /** Position/heading at arc-length `s` (metres, wraps). */
  sample(s: number, pos: THREE.Vector3, tangent: THREE.Vector3) {
    const u = ((s / this.length) % 1 + 1) % 1;
    this.curve.getPointAt(u, pos);
    this.curve.getTangentAt(u, tangent);
    pos.y = 0;
    tangent.y = 0;
    tangent.normalize();
  }
  /** Minimum distance from the path to an arena-frame point. */
  distanceTo(ax: number, ay: number) {
    let d = Infinity;
    for (const p of this.samples) d = Math.min(d, Math.hypot(p.x - ax, -p.z - ay));
    return d;
  }
}

// ---------- random layout (§11.4: ≥3 boulders 30–40 cm, ≥3 craters ≤ 40–50 cm, none in the starting zone) ----------
export function randomLayout(path: TourPath, rng: () => number = Math.random): Layout {
  const rocks: Rock[] = [];
  const craters: Crater[] = [];
  const placed: { x: number; y: number; r: number }[] = [];
  const nRocks = 5 + Math.floor(rng() * 4), nCraters = 3 + Math.floor(rng() * 3);
  const { L, W, startZone, construction, column } = ARENA;

  const tryPlace = (r: number, clearance: number) => {
    for (let i = 0; i < 200; i++) {
      const x = 0.35 + rng() * (L - 0.7), y = 0.35 + rng() * (W - 0.7);
      if (x < startZone.x + r && y < startZone.y + r) continue; // §11: no rocks or craters in the starting zone
      if (x > construction.x0 - r && y < construction.y1 + r) continue; // keep the construction zone clear
      if (Math.abs(x - column.cx) < column.s / 2 + r + 0.3 && Math.abs(y - column.cy) < column.s / 2 + r + 0.3) continue;
      if (path.distanceTo(x, y) < clearance) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + r + 0.35)) continue;
      placed.push({ x, y, r });
      return { x, y };
    }
    return null;
  };

  for (let i = 0; i < nRocks; i++) {
    const rx = 0.15 + rng() * 0.05, rz = 0.15 + rng() * 0.05, ry = 0.1 + rng() * 0.1;
    const p = tryPlace(Math.max(rx, rz), 0.72);
    if (p) rocks.push({ ...p, rx, ry, rz, yaw: rng() * Math.PI });
  }
  for (let i = 0; i < nCraters; i++) {
    const r = 0.2 + rng() * 0.05;
    const p = tryPlace(r, 0.78);
    if (p) craters.push({ ...p, r, depth: 0.08 + rng() * 0.1 });
  }
  return { rocks, craters };
}

// ---------- renderable arena ----------
function label(text: string, pos: THREE.Vector3, cls = 'label') {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  const o = new CSS2DObject(el);
  o.position.copy(pos);
  return o;
}

export class ArenaView extends THREE.Group {
  readonly caster = new ArenaCaster();
  private ground: THREE.Mesh;
  private rockGroup = new THREE.Group();
  readonly markings = new THREE.Group();
  private readonly segX = 172;
  private readonly segZ = 125;

  constructor(layout: Layout) {
    super();
    const { L, W, wallH, wallT, pipeR, column } = ARENA;

    // terrain
    const g = new THREE.PlaneGeometry(L, W, this.segX, this.segZ);
    g.rotateX(-Math.PI / 2);
    g.translate(L / 2, 0, -W / 2);
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
    this.ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    this.ground.receiveShadow = true;
    this.add(this.ground);

    // walls (translucent so the camera can look in from outside)
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x6b7686, roughness: 0.6, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    const wall = (w: number, d: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
      m.position.set(x, wallH / 2, z);
      this.add(m);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x9aa6b8 }));
      e.position.copy(m.position);
      this.add(e);
    };
    wall(L + 2 * wallT, wallT, L / 2, wallT / 2);
    wall(L + 2 * wallT, wallT, L / 2, -W - wallT / 2);
    wall(wallT, W, -wallT / 2, -W / 2);
    wall(wallT, W, L + wallT / 2, -W / 2);

    // PVC duct along the inside perimeter
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.5 });
    const pipe = (len: number, axis: 'x' | 'z', x: number, z: number) => {
      const pg = new THREE.CylinderGeometry(pipeR, pipeR, len, 20);
      if (axis === 'x') pg.rotateZ(Math.PI / 2); else pg.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(pg, pipeMat);
      m.position.set(x, pipeR, z);
      m.castShadow = true;
      this.add(m);
    };
    pipe(L, 'x', L / 2, -pipeR);
    pipe(L, 'x', L / 2, -W + pipeR);
    pipe(W, 'z', pipeR, -W / 2);
    pipe(W, 'z', L - pipeR, -W / 2);

    // central support column
    const col = new THREE.Mesh(
      new THREE.BoxGeometry(column.s, column.h, column.s),
      new THREE.MeshStandardMaterial({ color: 0x8c3b3b, roughness: 0.7 }),
    );
    col.position.set(column.cx, column.h / 2, -column.cy);
    col.castShadow = col.receiveShadow = true;
    this.add(col);
    const colLabel = label('Support column (permanent, §11.4.2)', new THREE.Vector3(0, 1.0, 0));
    col.add(colLabel);

    this.add(this.rockGroup);
    this.add(this.markings);
    this.buildMarkings();
    this.setLayout(layout);
  }

  private buildMarkings() {
    const { L, W, excavationX, startZone, construction, berm } = ARENA;
    const line = (pts: [number, number][], color: number, dashed = false, closed = true) => {
      const v: THREE.Vector3[] = [];
      const seq = closed ? [...pts, pts[0]] : pts;
      for (let i = 0; i < seq.length - 1; i++) {
        const [ax, ay] = seq[i], [bx, by] = seq[i + 1];
        const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.05));
        for (let k = 0; k <= n; k++) {
          const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n;
          v.push(toWorld(x, y, this.caster.height(x, -y) + 0.012));
        }
      }
      const geo = new THREE.BufferGeometry().setFromPoints(v);
      const mat = dashed
        ? new THREE.LineDashedMaterial({ color, dashSize: 0.12, gapSize: 0.08 })
        : new THREE.LineBasicMaterial({ color });
      const l = new THREE.Line(geo, mat);
      if (dashed) l.computeLineDistances();
      this.markings.add(l);
    };
    line([[excavationX, 0], [excavationX, W]], 0xcfd8e8, true, false);
    line([[0, 0], [startZone.x, 0], [startZone.x, startZone.y], [0, startZone.y]], 0x3fbf6f, true);
    line([[construction.x0, 0], [L, 0], [L, construction.y1], [construction.x0, construction.y1]], 0xcfd8e8, true);
    const bx0 = berm.cx - berm.l / 2, bx1 = berm.cx + berm.l / 2, by0 = berm.cy - berm.w / 2, by1 = berm.cy + berm.w / 2;
    line([[bx0, by0], [bx1, by0], [bx1, by1], [bx0, by1]], 0xff4040);

    const zl = (t: string, x: number, y: number) => this.markings.add(label(t, toWorld(x, y, 0.05), 'label zone'));
    zl('Starting zone 2 × 2 m', 1.0, 1.0);
    zl('Excavation zone 2.5 m', 1.25, 4.6);
    zl('Obstacle zone 4.38 m', 4.7, 4.6);
    zl('Construction zone', 5.4, 1.4);
    zl('Berm 2.2 × 0.9 m @ (5.38, 0.9)', 5.38, 0.4);
    zl('(0,0)', 0.15, 0.15);
  }

  setLayout(layout: Layout) {
    this.caster.setLayout(layout);
    this.rebuildGround();
    this.rockGroup.clear();
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x5c5650, roughness: 0.95, flatShading: true });
    for (const r of layout.rocks) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), rockMat);
      m.scale.set(r.rx, r.ry, r.rz);
      m.rotation.y = -r.yaw;
      m.position.set(r.x, r.ry * 0.3, -r.y);
      m.castShadow = m.receiveShadow = true;
      this.rockGroup.add(m);
    }
  }

  setBerm(on: boolean) {
    this.caster.bermVisible = on;
    this.rebuildGround();
  }

  private rebuildGround() {
    const pos = this.ground.geometry.attributes.position as THREE.BufferAttribute;
    const col = this.ground.geometry.attributes.color as THREE.BufferAttribute;
    const base = new THREE.Color(0x6a655d);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.caster.height(x, z);
      pos.setY(i, h);
      // crater floors read darker, fresh berm a touch lighter
      const k = THREE.MathUtils.clamp(1 + h * 1.6, 0.55, 1.25);
      c.copy(base).multiplyScalar(k);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.ground.geometry.computeVertexNormals();
  }
}

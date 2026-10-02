import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

/** Live pose of the robot. Angles in radians, scalars 0..1 unless noted. */
export interface RobotPose {
  /** Ladder angle about its pivot. 0 = horizontal forward (+X), negative = dug into ground, PI = stowed back over hopper. */
  ladderAngle: number;
  /** Hopper belt-floor speed 0..1 (discharges over the rear roller). */
  belt: number;
  /** Rear gate opening 0..1. */
  gate: number;
  /** Track ground speed, m/s (signed). */
  trackSpeed: number;
  /** Bucket chain speed 0..1. */
  chainSpeed: number;
  /** Mast extension 0..1. */
  mast: number;
  /** Hopper fill 0..1. */
  fill: number;
}

// ---------- materials ----------
const M = {
  alu: new THREE.MeshStandardMaterial({ color: 0xb8bec8, metalness: 0.75, roughness: 0.35 }),
  aluDark: new THREE.MeshStandardMaterial({ color: 0x6d7480, metalness: 0.7, roughness: 0.45 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x3b4149, metalness: 0.8, roughness: 0.4 }),
  black: new THREE.MeshStandardMaterial({ color: 0x15181d, metalness: 0.2, roughness: 0.85 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x23262b, metalness: 0.1, roughness: 0.95 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xffb020, metalness: 0.5, roughness: 0.4 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x2f6fb5, metalness: 0.3, roughness: 0.55 }),
  red: new THREE.MeshStandardMaterial({ color: 0xd62828, metalness: 0.2, roughness: 0.5 }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xf2d23c, metalness: 0.2, roughness: 0.6 }),
  white: new THREE.MeshStandardMaterial({ color: 0xe9ecf2, metalness: 0.1, roughness: 0.6 }),
  lens: new THREE.MeshStandardMaterial({ color: 0x10141c, metalness: 0.9, roughness: 0.1 }),
  regolith: new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 1, metalness: 0 }),
  orange: new THREE.MeshStandardMaterial({ color: 0xff7a1a, metalness: 0.3, roughness: 0.5 }),
  green: new THREE.MeshStandardMaterial({ color: 0x3fbf6f, emissive: 0x1a5c33, roughness: 0.5 }),
};
export const allMaterials = Object.values(M);

// ---------- key dimensions (metres). Robot frame: +X forward, +Y up, +Z left/right. Origin at ground under chassis. ----------
export const D = {
  trackLen: 0.80, // sprocket centre to centre
  trackR: 0.09,
  trackW: 0.12,
  trackZ: 0.30, // centreline of each track
  trackX0: -0.47, // rear sprocket centre
  frameY: 0.19, // centre of main frame rails
  frameX0: -0.55,
  frameX1: 0.45,
  frameZ: 0.26,
  tube: 0.04, // 40×40 mm extrusion
  // Belt-floor hopper: rear roller overhangs the tracks so discharge clears them; front wall sits
  // under the ladder discharge arc and below the bucket swing circle (r ≈ 0.14 about the pivot).
  hopX0: -0.60, // rear roller centre
  hopX1: 0.20, // front roller centre
  hopY: 0.245, // roller centreline
  hopR: 0.025, // roller + belt radius
  hopH: 0.11, // sidewall height above the belt
  hopZ: 0.23, // half-width inside the frame rails
  // Pivot lowered so the stowed ladder (buckets up) tops out at 73 cm < 75 cm envelope;
  // ladder lengthened so −45° reaches ~10 cm below grade with the bucket tip 25 cm ahead of the tracks.
  ladderPivot: new THREE.Vector3(0.30, 0.56, 0),
  ladderLen: 0.70,
  ladderR: 0.06, // chain sprocket radius
  ladderZ: 0.14, // half-width of ladder rails
  bucketN: 7,
  mastPos: new THREE.Vector3(-0.50, 0, -0.33), // outboard of the hopper sidewall + rib (z −0.27)
};

export const STOWED_ENVELOPE = { l: 1.5, w: 0.75, h: 0.75 };

// ---------- helpers ----------
function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}

function cyl(r: number, len: number, mat: THREE.Material, axis: 'x' | 'y' | 'z' = 'z', seg = 24) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** Straight tube between two points (struts, wiring). */
function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = cyl(r, dir.length(), mat, 'y');
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

function label(text: string, pos: THREE.Vector3) {
  const el = document.createElement('div');
  el.className = 'label';
  el.textContent = text;
  const o = new CSS2DObject(el);
  o.position.copy(pos);
  return o;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** Electric linear actuator: body at `base`, rod extends toward `tip`. */
class Actuator extends THREE.Group {
  private rod: THREE.Mesh;
  private bodyLen: number;
  constructor(bodyLen: number, r: number) {
    super();
    this.bodyLen = bodyLen;
    const body = cyl(r, bodyLen, M.black, 'y');
    this.rod = cyl(r * 0.5, 1, M.alu, 'y');
    const eye = cyl(r * 1.1, r * 0.9, M.steel, 'z');
    eye.position.y = -bodyLen / 2;
    const motor = box(r * 1.6, r * 2.2, r * 1.6, M.aluDark, 0, -bodyLen / 2 + r * 1.6, r * 1.3);
    this.add(body, this.rod, eye, motor);
  }
  /** Endpoints expressed in the actuator's parent space. */
  update(base: THREE.Vector3, tip: THREE.Vector3) {
    const dir = new THREE.Vector3().subVectors(tip, base);
    const len = dir.length();
    dir.normalize();
    this.position.copy(base).addScaledVector(dir, this.bodyLen / 2);
    this.quaternion.setFromUnitVectors(Y_AXIS, dir);
    const rodLen = Math.max(0.01, len - this.bodyLen);
    this.rod.scale.y = rodLen;
    this.rod.position.y = this.bodyLen / 2 + rodLen / 2;
  }
}

/**
 * Closed loop around two sprockets (radius r) at x=0 and x=len, traversed clockwise:
 * bottom run +X, around far end, top run -X, around near end. Writes point + unit tangent.
 */
function loopPoint(s: number, len: number, r: number, out: THREE.Vector3, tangent: THREE.Vector3) {
  const arc = Math.PI * r;
  const per = 2 * len + 2 * arc;
  s = ((s % per) + per) % per;
  if (s < len) { out.set(s, -r, 0); tangent.set(1, 0, 0); return; }
  s -= len;
  if (s < arc) {
    const a = -Math.PI / 2 + s / r;
    out.set(len + r * Math.cos(a), r * Math.sin(a), 0);
    tangent.set(-Math.sin(a), Math.cos(a), 0);
    return;
  }
  s -= arc;
  if (s < len) { out.set(len - s, r, 0); tangent.set(-1, 0, 0); return; }
  s -= len;
  const a = Math.PI / 2 + s / r;
  out.set(r * Math.cos(a), r * Math.sin(a), 0);
  tangent.set(-Math.sin(a), Math.cos(a), 0);
}
const loopPerimeter = (len: number, r: number) => 2 * len + 2 * Math.PI * r;

/** Belt: rounded loop ring extruded along Z. */
function beltGeometry(len: number, r: number, thickness: number, width: number) {
  const ring = (rad: number, path: THREE.Path) => {
    path.absarc(0, 0, rad, Math.PI / 2, (3 * Math.PI) / 2, false);
    path.lineTo(len, -rad);
    path.absarc(len, 0, rad, -Math.PI / 2, Math.PI / 2, false);
    path.lineTo(0, rad);
  };
  const outer = new THREE.Shape();
  ring(r, outer);
  const hole = new THREE.Path();
  ring(r - thickness, hole);
  outer.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(outer, { depth: width, bevelEnabled: false, curveSegments: 24 });
  g.translate(0, 0, -width / 2);
  return g;
}

// ---------- track unit (origin at rear sprocket centre) ----------
class Track extends THREE.Group {
  private cleats: THREE.Mesh[] = [];
  private wheels: THREE.Mesh[] = [];
  private phase = 0;
  private per: number;
  constructor() {
    super();
    const { trackLen: L, trackR: R, trackW: W } = D;
    this.per = loopPerimeter(L, R);

    const belt = new THREE.Mesh(beltGeometry(L, R, 0.016, W), M.rubber);
    belt.castShadow = belt.receiveShadow = true;
    this.add(belt);

    for (const x of [0, L]) {
      const s = cyl(R - 0.02, W * 0.85, M.aluDark, 'z', 12);
      s.position.set(x, 0, 0);
      const hub = cyl(0.03, W * 0.95, M.steel, 'z');
      hub.position.set(x, 0, 0);
      this.add(s, hub);
      this.wheels.push(s);
    }
    for (let i = 1; i <= 3; i++) {
      const w = cyl(R - 0.035, W * 0.6, M.aluDark, 'z', 16);
      w.position.set((L * i) / 4, -0.012, 0);
      this.add(w);
      this.wheels.push(w);
    }
    // side plates of track frame
    for (const z of [-1, 1]) this.add(box(L + 0.02, 0.07, 0.012, M.alu, L / 2, 0.015, z * (W / 2 + 0.008)));

    const cg = new THREE.BoxGeometry(0.03, 0.022, W + 0.01);
    for (let i = 0; i < 26; i++) {
      const c = new THREE.Mesh(cg, M.steel);
      c.castShadow = true;
      this.cleats.push(c);
      this.add(c);
    }
    this.layout();
  }
  private layout() {
    const p = new THREE.Vector3(), t = new THREE.Vector3(), n = new THREE.Vector3();
    const N = this.cleats.length;
    for (let i = 0; i < N; i++) {
      loopPoint(this.phase + (i / N) * this.per, D.trackLen, D.trackR, p, t);
      n.set(t.y, -t.x, 0); // outward normal for clockwise loop
      const c = this.cleats[i];
      c.position.copy(p).addScaledVector(n, 0.011);
      c.rotation.z = Math.atan2(t.y, t.x);
    }
  }
  advance(dist: number) {
    this.phase = (this.phase + dist) % this.per;
    for (const w of this.wheels) w.rotation.z -= dist / D.trackR;
    this.layout();
  }
}

// ---------- bucket ladder (origin at pivot/top sprocket, +X runs down the ladder) ----------
class Ladder extends THREE.Group {
  private buckets: THREE.Group[] = [];
  private sprockets: THREE.Mesh[] = [];
  private phase = 0;
  private per: number;
  constructor() {
    super();
    const { ladderLen: L, ladderR: R, ladderZ: Z } = D;
    this.per = loopPerimeter(L, R);
    const chainZ = Z - 0.03;

    for (const z of [-Z, Z]) {
      this.add(box(L + 0.12, 0.05, 0.02, M.alu, L / 2 - 0.02, 0, z));
      for (let i = 1; i < 4; i++) this.add(box(0.02, 0.045, 0.02, M.aluDark, (L * i) / 4, 0, z * 0.5));
    }
    for (const x of [0.14, L * 0.55, L - 0.04]) {
      const cm = cyl(0.011, Z * 2, M.alu, 'z');
      cm.position.set(x, R + 0.02, 0);
      this.add(cm);
    }
    for (const x of [0, L]) {
      for (const z of [-chainZ, chainZ]) {
        const s = cyl(R, 0.02, M.aluDark, 'z', 12);
        s.position.set(x, 0, z);
        this.add(s);
        this.sprockets.push(s);
      }
      const shaft = cyl(0.011, Z * 2 + 0.04, M.steel, 'z');
      shaft.position.set(x, 0, 0);
      this.add(shaft);
    }
    for (const z of [-chainZ, chainZ]) {
      this.add(box(L, 0.014, 0.012, M.steel, L / 2, R, z));
      this.add(box(L, 0.014, 0.012, M.steel, L / 2, -R, z));
    }
    // chain drive motor + gearbox on the top shaft, outboard of the rail
    const gb = box(0.08, 0.08, 0.05, M.aluDark, 0, 0, Z + 0.045);
    const motor = cyl(0.033, 0.11, M.black, 'z');
    motor.position.set(0, 0, Z + 0.125);
    this.add(gb, motor);

    // buckets: open toward +X (travel), extend outward toward -Y (clockwise loop outward side)
    const bw = Z * 2 - 0.11;
    for (let i = 0; i < D.bucketN; i++) {
      const g = new THREE.Group();
      const back = box(0.01, 0.07, bw, M.alu, -0.04, -0.035, 0);
      const inner = box(0.085, 0.008, bw, M.alu, 0, -0.004, 0);
      const outer = box(0.085, 0.008, bw, M.alu, 0, -0.066, 0);
      const sl = box(0.085, 0.07, 0.008, M.alu, 0, -0.035, -bw / 2);
      const sr = box(0.085, 0.07, 0.008, M.alu, 0, -0.035, bw / 2);
      g.add(back, inner, outer, sl, sr);
      for (let k = -2; k <= 2; k++) {
        const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.028, 4), M.steel);
        tooth.position.set(0.052, -0.066, k * (bw / 5));
        tooth.rotation.z = -Math.PI / 2;
        g.add(tooth);
      }
      this.buckets.push(g);
      this.add(g);
    }
    this.layout();
  }
  private layout() {
    const p = new THREE.Vector3(), t = new THREE.Vector3(), n = new THREE.Vector3();
    const N = this.buckets.length;
    for (let i = 0; i < N; i++) {
      loopPoint(this.phase + (i / N) * this.per, D.ladderLen, D.ladderR, p, t);
      n.set(t.y, -t.x, 0);
      const b = this.buckets[i];
      b.position.copy(p).addScaledVector(n, 0.012);
      b.rotation.z = Math.atan2(t.y, t.x);
    }
  }
  advance(dist: number) {
    this.phase = (this.phase + dist) % this.per;
    for (const s of this.sprockets) s.rotation.z -= dist / D.ladderR;
    this.layout();
  }
}

// ---------- hopper belt floor (origin at rear roller centre, runs +X to the front roller) ----------
class BeltFloor extends THREE.Group {
  private lugs: THREE.Mesh[] = [];
  private rollers: THREE.Mesh[] = [];
  private phase = 0;
  private per: number;
  private len: number;
  private r: number;
  constructor() {
    super();
    const len = D.hopX1 - D.hopX0, r = D.hopR, w = D.hopZ * 2 - 0.01;
    this.len = len; this.r = r;
    this.per = loopPerimeter(len, r);
    const belt = new THREE.Mesh(beltGeometry(len, r, 0.005, w), M.rubber);
    belt.castShadow = belt.receiveShadow = true;
    this.add(belt);
    for (const x of [0, len]) {
      const roller = cyl(r - 0.006, w + 0.02, M.aluDark, 'z', 16);
      roller.position.set(x, 0, 0);
      this.add(roller);
      this.rollers.push(roller);
    }
    // belt drive gearmotor on the rear roller, outboard of the +Z rail
    const motor = cyl(0.025, 0.08, M.black, 'z');
    motor.position.set(0, 0, D.hopZ + 0.075);
    this.add(motor);
    const lg = new THREE.BoxGeometry(0.012, 0.01, w - 0.02);
    for (let i = 0; i < 14; i++) {
      const l = new THREE.Mesh(lg, M.steel);
      this.lugs.push(l);
      this.add(l);
    }
    this.layout();
  }
  private layout() {
    const p = new THREE.Vector3(), t = new THREE.Vector3(), n = new THREE.Vector3();
    const N = this.lugs.length;
    for (let i = 0; i < N; i++) {
      // loopPoint's top run travels -X (toward the rear roller) so the load discharges rearward
      loopPoint(this.phase + (i / N) * this.per, this.len, this.r, p, t);
      n.set(t.y, -t.x, 0);
      const l = this.lugs[i];
      l.position.copy(p).addScaledVector(n, 0.005);
      l.rotation.z = Math.atan2(t.y, t.x);
    }
  }
  advance(dist: number) {
    this.phase = (this.phase + dist) % this.per;
    for (const r of this.rollers) r.rotation.z -= dist / this.r;
    this.layout();
  }
}

// ---------- complete robot ----------
export class Robot extends THREE.Group {
  private trackL = new Track();
  private trackR = new Track();
  private ladderPivot = new THREE.Group();
  private ladder = new Ladder();
  private belt = new BeltFloor();
  private gatePivot = new THREE.Group();
  private gateAct = new Actuator(0.09, 0.013);
  private mastInner: THREE.Mesh;
  private mastHead = new THREE.Group();
  private fillMesh: THREE.Mesh;
  readonly labels: THREE.Object3D[] = [];
  readonly envelope: THREE.LineSegments;

  constructor() {
    super();
    const { trackR: R, trackZ: TZ, trackX0: TX, frameY: fy, frameZ: fz, tube: t } = D;
    const fx0 = D.frameX0, fx1 = D.frameX1;

    // ---- tracks + drive motors ----
    this.trackL.position.set(TX, R, -TZ);
    this.trackR.position.set(TX, R, TZ);
    this.add(this.trackL, this.trackR);
    for (const z of [-1, 1]) {
      const m = cyl(0.035, 0.12, M.black, 'z');
      m.position.set(TX, R, z * (TZ - D.trackW / 2 - 0.075));
      this.add(m);
    }
    this.labels.push(label('Tracked skid-steer drive (2× BLDC gearmotors)', new THREE.Vector3(TX, 0.02, TZ + 0.1)));

    // ---- main frame: 40×40 extrusion ----
    const L = fx1 - fx0;
    for (const z of [-fz, fz]) this.add(box(L, t, t, M.alu, (fx0 + fx1) / 2, fy, z));
    for (const x of [fx0 + t / 2, -0.30, -0.05, 0.20, fx1 - t / 2]) this.add(box(t, t, fz * 2, M.alu, x, fy, 0));
    for (const x of [TX, TX + D.trackLen]) for (const z of [-1, 1]) {
      this.add(box(t, 0.05, TZ - fz + 0.04, M.aluDark, x, fy - 0.01, z * (fz + (TZ - fz) / 2)));
    }
    this.add(box(0.48, 0.006, fz * 2 - 0.02, M.aluDark, 0.21, fy + t / 2 + 0.003, 0)); // front deck plate

    // ---- sealed e-bay under the ladder tower (hopper now occupies the deck behind it) ----
    const deck = fy + t / 2;
    this.add(box(0.20, 0.12, 0.20, M.blue, 0.335, deck + 0.06, 0.08));
    this.labels.push(label('Battery (48 V LiFePO₄)', new THREE.Vector3(0.335, deck + 0.15, 0.14)));
    this.add(box(0.18, 0.10, 0.16, M.aluDark, 0.335, deck + 0.05, -0.14));
    this.labels.push(label('Avionics + motor controllers', new THREE.Vector3(0.335, deck + 0.13, -0.2)));
    // Lid seals the bay against dust and catches any forward spill from the bucket discharge.
    this.add(box(0.22, 0.006, 0.44, M.aluDark, 0.335, 0.345, 0));
    this.labels.push(label('Sealed e-bay lid / spill deflector', new THREE.Vector3(0.42, 0.40, 0.25)));
    // Logger rides the front tower strut at ~0.5 m so a judge can read/remove it standing (§13.1.1).
    this.add(box(0.07, 0.04, 0.05, M.white, 0.33, 0.50, 0.23));
    this.add(box(0.012, 0.012, 0.004, M.green, 0.33, 0.51, 0.256));
    this.labels.push(label('COTS power logger (battery → logger → E-stop)', new THREE.Vector3(0.33, 0.58, 0.30)));
    this.add(strut(new THREE.Vector3(0.40, 0.348, 0.15), new THREE.Vector3(0.33, 0.48, 0.21), 0.004, M.red));
    this.add(strut(new THREE.Vector3(0.33, 0.52, 0.21), new THREE.Vector3(0.30, 0.62, -0.20), 0.004, M.red));

    // ---- ladder tower (A-frame) + pivot bearings + slew gearmotor ----
    const P = D.ladderPivot;
    const tz = D.ladderZ + 0.04;
    for (const z of [-tz, tz]) {
      const zb = Math.sign(z) * 0.235; // strut feet outboard of the e-bay, just inside the rails
      this.add(strut(new THREE.Vector3(0.44, deck, zb), new THREE.Vector3(P.x, P.y, z), 0.016, M.alu));
      this.add(strut(new THREE.Vector3(0.24, deck, zb), new THREE.Vector3(P.x, P.y, z), 0.016, M.alu));
      const brg = cyl(0.035, 0.03, M.aluDark, 'z');
      brg.position.set(P.x, P.y, z);
      this.add(brg);
    }
    const crossbar = cyl(0.012, tz * 2, M.alu, 'z');
    crossbar.position.set(0.32, 0.40, 0);
    this.add(crossbar);
    const shaft = cyl(0.016, tz * 2 + 0.1, M.steel, 'z');
    shaft.position.copy(P);
    this.add(shaft);
    const slewBox = box(0.09, 0.09, 0.05, M.aluDark, P.x, P.y, -(tz + 0.045));
    const slewMotor = cyl(0.03, 0.12, M.black, 'x');
    slewMotor.position.set(P.x - 0.105, P.y, -(tz + 0.045));
    this.add(slewBox, slewMotor);
    this.labels.push(label('Ladder slew: worm gearmotor (−60°…180°)', new THREE.Vector3(P.x - 0.15, P.y + 0.05, -tz - 0.05)));

    // ---- E-stop: 40 mm red mushroom on top of the slew housing — highest fixed point, clear of the stowed ladder ----
    const es = new THREE.Group();
    es.add(box(0.07, 0.05, 0.07, M.yellow, 0, 0.025, 0));
    const stem = cyl(0.012, 0.025, M.black, 'y');
    stem.position.y = 0.06;
    const cap = cyl(0.02, 0.018, M.red, 'y');
    cap.position.y = 0.082;
    es.add(stem, cap);
    es.position.set(P.x, P.y + 0.045, -(tz + 0.045));
    this.add(es);
    this.labels.push(label('E-stop (Ø40 mm, highest fixed point, unobstructed)', new THREE.Vector3(P.x, P.y + 0.24, -tz - 0.05)));

    // ---- ladder ----
    this.ladderPivot.position.copy(P);
    this.ladderPivot.add(this.ladder);
    this.add(this.ladderPivot);
    this.labels.push(label('Bucket-ladder: 7 buckets, dual roller chain, 0–15 cm dig depth', new THREE.Vector3(0.45, -0.05, 0)));
    this.ladder.add(this.labels[this.labels.length - 1]);

    // ---- belt-floor hopper: buckets discharge straight in behind the pivot; belt carries the load rearward ----
    const { hopX0: hx0, hopX1: hx1, hopY: hy, hopR: hr, hopH: hh, hopZ: hz } = D;
    const sh = 0.004;
    const floorY = hy + hr;
    const hl = hx1 - hx0 + 2 * hr; // overall bin length incl. roller ends
    const hcx = (hx0 + hx1) / 2;
    this.belt.position.set(hx0, hy, 0);
    this.add(this.belt);
    for (const z of [-hz, hz]) {
      this.add(box(hl, hh + hr, sh, M.alu, hcx, floorY - hr / 2 + hh / 2, z)); // sidewall + skirt
      for (const x of [hx0 + 0.05, hcx, hx1 - 0.05]) this.add(box(0.03, hh, 0.008, M.aluDark, x, floorY + hh / 2, Math.sign(z) * (hz + 0.006)));
    }
    this.add(box(sh, hh + hr, hz * 2, M.alu, hx1 + hr, floorY - hr / 2 + hh / 2, 0)); // front wall
    this.labels.push(label('Belt-floor hopper (~32 L working, rear discharge)', new THREE.Vector3(-0.2, 0.50, 0)));

    this.fillMesh = box(hl - 0.03, 1, hz * 2 - 0.02, M.regolith, hcx, floorY + 0.002, 0);
    this.fillMesh.geometry.translate(0, 0.5, 0);
    this.add(this.fillMesh);

    // rear gate hinged at the top-rear edge, lifted by one small actuator on the +Z sidewall
    this.gatePivot.position.set(hx0 - hr, floorY + hh, 0);
    this.gatePivot.add(box(sh, hh + hr - 0.004, hz * 2 - 0.01, M.gold, 0, -(hh + hr) / 2, 0));
    this.gatePivot.add(cyl(0.011, hz * 2 + 0.02, M.steel, 'z'));
    this.gatePivot.add(box(0.012, 0.03, 0.03, M.steel, -0.006, -0.07, hz + 0.02)); // actuator lug
    this.add(this.gatePivot, this.gateAct);
    this.labels.push(label('Actuated rear gate', new THREE.Vector3(hx0 - 0.05, floorY + hh + 0.08, hz + 0.05)));

    // ---- lifting points ----
    for (const x of [fx0 + 0.07, fx1 - 0.07]) for (const z of [-fz, fz]) {
      const eye = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.006, 8, 16), M.orange);
      eye.position.set(x, fy + 0.05, z);
      eye.castShadow = true;
      const post = cyl(0.006, 0.04, M.orange, 'y');
      post.position.set(x, fy + 0.03, z);
      this.add(eye, post);
    }
    this.labels.push(label('Marked lifting point ×4', new THREE.Vector3(fx1 - 0.07, fy + 0.12, fz)));

    // ---- telescoping sensor mast (rear-left, clear of ladder sweep and hopper) ----
    const mp = D.mastPos;
    this.add(box(0.06, 0.025, 0.08, M.aluDark, mp.x, fy + 0.0325, mp.z + 0.01));
    const mastBase = cyl(0.025, 0.26, M.alu, 'y');
    mastBase.position.set(mp.x, fy + 0.045 + 0.13, mp.z);
    this.add(mastBase);
    this.mastInner = cyl(0.016, 1, M.aluDark, 'y');
    this.mastInner.geometry.translate(0, 0.5, 0);
    this.mastInner.position.set(mp.x, fy + 0.045 + 0.26 - 0.02, mp.z);
    this.add(this.mastInner);

    const lidar = cyl(0.045, 0.06, M.black, 'y');
    const lidarBand = cyl(0.046, 0.018, M.lens, 'y');
    const camBar = box(0.03, 0.03, 0.22, M.aluDark, 0.03, -0.055, 0);
    this.mastHead.add(lidar, lidarBand, camBar);
    for (const z of [-0.09, 0.09]) {
      const lens = cyl(0.012, 0.02, M.lens, 'x');
      lens.position.set(0.055, -0.055, z);
      this.mastHead.add(lens);
    }
    // Rear camera: the robot reverses to dump, and the starting-zone fiducials (§13.7.2) are behind it in transit.
    const rearCam = cyl(0.012, 0.02, M.lens, 'x');
    rearCam.position.set(-0.03, -0.055, 0);
    this.mastHead.add(rearCam);
    // 2×2 MIMO Wi‑Fi client lives on the mast head (Ethernet down the mast, no coax loss);
    // two dipoles spaced ~λ/2 at 2.4 GHz for spatial diversity on the forced 20 MHz Channel 1.
    const radio = box(0.05, 0.02, 0.09, M.aluDark, -0.04, 0.045, 0);
    this.mastHead.add(radio);
    for (const z of [-0.06, 0.06]) {
      const ant = cyl(0.004, 0.08, M.black, 'y');
      ant.position.set(-0.04, 0.095, z);
      this.mastHead.add(ant);
    }
    const headLabel = label('3D LiDAR + stereo + rear camera + 2×2 MIMO 2.4/5 GHz radio', new THREE.Vector3(0, 0.18, 0));
    this.mastHead.add(headLabel);
    this.labels.push(headLabel);
    this.add(this.mastHead);

    // ---- stowed envelope wireframe ----
    const eg = new THREE.BoxGeometry(STOWED_ENVELOPE.l, STOWED_ENVELOPE.h, STOWED_ENVELOPE.w);
    this.envelope = new THREE.LineSegments(
      new THREE.EdgesGeometry(eg),
      new THREE.LineDashedMaterial({ color: 0x3da5ff, dashSize: 0.04, gapSize: 0.025 }),
    );
    this.envelope.computeLineDistances();
    this.envelope.position.set(-0.05, STOWED_ENVELOPE.h / 2, 0);
    this.envelope.visible = false;
    this.add(this.envelope);

    for (const l of this.labels) if (!l.parent) this.add(l);
  }

  update(pose: RobotPose, dt: number) {
    // ladder slew + chain
    this.ladderPivot.rotation.z = pose.ladderAngle;
    if (pose.chainSpeed > 0.001) this.ladder.advance(pose.chainSpeed * 0.6 * dt);

    // belt floor
    if (pose.belt > 0.001) this.belt.advance(pose.belt * 0.25 * dt);

    // gate swings rearward (bottom edge toward -X) about its top hinge
    const ga = -pose.gate * 1.15;
    this.gatePivot.rotation.z = ga;
    const gBase = new THREE.Vector3(D.hopX0 + 0.14, D.hopY + D.hopR + D.hopH + 0.02, D.hopZ + 0.02);
    const gLug = new THREE.Vector3(0, -0.07, D.hopZ + 0.02).applyAxisAngle(Z_AXIS, ga).add(this.gatePivot.position);
    this.gateAct.update(gBase, gLug);

    this.fillMesh.scale.y = Math.max(0.001, pose.fill * (D.hopH - 0.015));

    // telescoping mast
    const ext = 0.04 + pose.mast * 0.8;
    this.mastInner.scale.y = ext;
    const mp = D.mastPos;
    this.mastHead.position.set(mp.x, D.frameY + 0.045 + 0.26 - 0.02 + ext + 0.03, mp.z);

    const dist = pose.trackSpeed * dt;
    if (Math.abs(dist) > 1e-6) {
      this.trackL.advance(dist);
      this.trackR.advance(dist);
    }
  }

  setWireframe(on: boolean) {
    for (const m of allMaterials) m.wireframe = on;
  }
  setLabels(on: boolean) {
    for (const l of this.labels) l.visible = on;
  }
}

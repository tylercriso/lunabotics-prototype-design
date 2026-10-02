import * as THREE from 'three';
import { ArenaCaster, Surface, SURFACE_ALBEDO, SURFACE_COLORS, type Hit } from './arena';

export interface SensorConfig {
  name: string;
  kind: '2d' | '3d';
  /** Max range, m. */
  range: number;
  /** Horizontal field of view, degrees, centred on the robot's forward axis. */
  hfov: number;
  /** Azimuth step, degrees. */
  azStep: number;
  /** Revolutions per second. */
  rate: number;
  /** Pitch of the whole sensor, degrees (+ up, − down). */
  tilt: number;
  /** Vertical channels (1 for a 2D scanner). */
  channels: number;
  /** Total vertical field of view, degrees (3D only). */
  vfov: number;
  note: string;
}

export const PRESETS_2D: SensorConfig[] = [
  { name: 'RPLIDAR A1 — horizontal', kind: '2d', range: 12, hfov: 360, azStep: 1, rate: 5.5, tilt: 0, channels: 1, vfov: 0,
    note: 'Budget 360° triangulation scanner. Level at 1.3 m it clears every 30–40 cm boulder and the ~1 m walls: only the column returns.' },
  { name: 'RPLIDAR A1 — tilted 20° (push-broom)', kind: '2d', range: 12, hfov: 360, azStep: 1, rate: 5.5, tilt: -20, channels: 1, vfov: 0,
    note: 'Same scanner pitched down. The scan plane cuts the floor in a line ~3.5 m ahead; driving sweeps that line over rocks and craters so the map fills in.' },
  { name: 'Hokuyo UST-10LX — tilted 25°', kind: '2d', range: 10, hfov: 270, azStep: 0.25, rate: 40, tilt: -25, channels: 1, vfov: 0,
    note: '270° time-of-flight scanner, 0.25° steps at 40 Hz: 43 k points/s on a single plane.' },
  { name: 'SICK TiM571 — tilted 15°', kind: '2d', range: 25, hfov: 270, azStep: 0.33, rate: 15, tilt: -15, channels: 1, vfov: 0,
    note: 'Industrial 270° scanner. Longer range than the arena needs; the push-broom line lands ~5 m out.' },
];

export const PRESETS_3D: SensorConfig[] = [
  { name: 'Velodyne VLP-16 (Puck)', kind: '3d', range: 30, hfov: 360, azStep: 0.4, rate: 10, tilt: 0, channels: 16, vfov: 30,
    note: '16 lasers spread ±15° spinning at 10 Hz. Level on the mast the lowest beam reaches the floor ~5 m out. Shown at 0.4° columns; the real unit fires every 0.2°.' },
  { name: 'Velodyne VLP-16 — tilted 20°', kind: '3d', range: 30, hfov: 360, azStep: 0.4, rate: 10, tilt: -20, channels: 16, vfov: 30,
    note: 'Pitched down so the fan covers the floor from ~2 m to the far wall ahead, at the cost of the view behind.' },
  { name: 'Ouster OS1-32', kind: '3d', range: 30, hfov: 360, azStep: 0.7, rate: 10, tilt: -10, channels: 32, vfov: 45,
    note: '32 channels over 45° in its 512-column mode (~16 k points per revolution). Denser vertical coverage picks out crater floors sooner.' },
  { name: 'Livox Mid-360 (inverted, approx.)', kind: '3d', range: 30, hfov: 360, azStep: 0.75, rate: 10, tilt: -22.5, channels: 40, vfov: 59,
    note: 'Non-repetitive pattern approximated as 40 lines over its −7°…+52° FOV, mounted upside-down so the wide side looks at the floor.' },
];

/**
 * Upper bound on beams cast per animation frame. The analytic caster costs ~1 µs per beam, so a
 * real VLP-16 (288 k beams/s) cannot be simulated at 60 fps in JavaScript; above this budget the
 * scanner head simply turns slower than real time instead of the frame rate collapsing.
 */
const RAY_BUDGET = 8000;

export type ColorMode = 0 | 1 | 2; // surface | height | intensity

const MAX_POINTS = 64 * 1440; // 64 channels × 0.25° steps
const MAP_POINTS = 300_000;

const SHADER_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aIntensity;
attribute float aTime;
uniform float uNow, uPeriod, uMode, uSize, uAlpha, uHold, uPixelRatio;
varying vec4 vColor;
vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c1 = vec3(0.15, 0.25, 0.95), c2 = vec3(0.1, 0.85, 0.9), c3 = vec3(0.2, 0.9, 0.3), c4 = vec3(1.0, 0.9, 0.2), c5 = vec3(1.0, 0.25, 0.15);
  if (t < 0.25) return mix(c1, c2, t / 0.25);
  if (t < 0.5) return mix(c2, c3, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c3, c4, (t - 0.5) / 0.25);
  return mix(c4, c5, (t - 0.75) / 0.25);
}
void main() {
  float age = uNow - aTime;
  float a = uHold > 0.5 ? 1.0 : ((age < 0.0 || age > uPeriod) ? 0.0 : 1.0 - 0.75 * age / uPeriod);
  // unwritten ring-buffer slots (aTime = -1e9) and expired returns: push outside the clip volume so
  // they are culled before rasterisation instead of piling up as hundreds of thousands of sprites
  if (aTime < -1.0e8 || a <= 0.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    #ifdef POINTS
    gl_PointSize = 0.0;
    #endif
    vColor = vec4(0.0);
    return;
  }
  vec3 c = uMode < 0.5 ? aColor : (uMode < 1.5 ? ramp((position.y + 0.3) / 1.8) : mix(vec3(0.08, 0.12, 0.3), vec3(1.0, 0.97, 0.8), aIntensity));
  vColor = vec4(c, a * uAlpha);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  #ifdef POINTS
  gl_PointSize = clamp(uSize * uPixelRatio * 3.0 / -mv.z, 1.5 * uPixelRatio, 10.0 * uPixelRatio);
  #endif
  gl_Position = projectionMatrix * mv;
}`;

const SHADER_FRAG = /* glsl */ `
varying vec4 vColor;
void main() {
  if (vColor.a < 0.01) discard;
  #ifdef POINTS
  if (length(gl_PointCoord - 0.5) > 0.5) discard;
  #endif
  gl_FragColor = vColor;
}`;

function makeMaterial(points: boolean, size: number, alpha: number, hold: boolean) {
  return new THREE.ShaderMaterial({
    vertexShader: SHADER_VERT,
    fragmentShader: SHADER_FRAG,
    defines: points ? { POINTS: 1 } : {},
    uniforms: {
      uNow: { value: 0 }, uPeriod: { value: 0.1 }, uMode: { value: 0 }, uSize: { value: size },
      uAlpha: { value: alpha }, uHold: { value: hold ? 1 : 0 }, uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    transparent: true,
    depthWrite: false,
    blending: points ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
}

/** Ring-buffered geometry with the attributes the shader needs. */
class RingBuffer {
  readonly geometry = new THREE.BufferGeometry();
  readonly pos: THREE.BufferAttribute;
  readonly col: THREE.BufferAttribute;
  readonly inten: THREE.BufferAttribute;
  readonly time: THREE.BufferAttribute;
  head = 0;
  private dirtyStart = -1;
  private dirtyEnd = -1;
  private wrapped = false;

  constructor(readonly capacity: number) {
    this.pos = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    this.inten = new THREE.BufferAttribute(new Float32Array(capacity), 1);
    this.time = new THREE.BufferAttribute(new Float32Array(capacity).fill(-1e9), 1);
    for (const a of [this.pos, this.col, this.inten, this.time]) a.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.pos);
    this.geometry.setAttribute('aColor', this.col);
    this.geometry.setAttribute('aIntensity', this.inten);
    this.geometry.setAttribute('aTime', this.time);
    // the arena is small: skip frustum culling rather than keep recomputing a bounding sphere
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(3.44, 0.5, -2.5), 12);
  }

  write(x: number, y: number, z: number, c: THREE.Color, intensity: number, t: number) {
    const i = this.head;
    this.pos.setXYZ(i, x, y, z);
    this.col.setXYZ(i, c.r, c.g, c.b);
    this.inten.setX(i, intensity);
    this.time.setX(i, t);
    if (this.dirtyStart < 0) this.dirtyStart = i;
    this.dirtyEnd = i;
    this.head = i + 1;
    if (this.head >= this.capacity) {
      this.head = 0;
      this.wrapped = true;
    }
  }

  flush() {
    if (this.dirtyStart < 0) return;
    for (const a of [this.pos, this.col, this.inten, this.time]) {
      a.clearUpdateRanges();
      const n = a.itemSize;
      if (this.wrapped) {
        a.addUpdateRange(this.dirtyStart * n, (this.capacity - this.dirtyStart) * n);
        a.addUpdateRange(0, (this.dirtyEnd + 1) * n);
      } else {
        a.addUpdateRange(this.dirtyStart * n, (this.dirtyEnd - this.dirtyStart + 1) * n);
      }
      a.needsUpdate = true;
    }
    this.dirtyStart = this.dirtyEnd = -1;
    this.wrapped = false;
  }

  clear() {
    (this.time.array as Float32Array).fill(-1e9);
    this.time.clearUpdateRanges();
    this.time.needsUpdate = true;
    this.head = 0;
    this.dirtyStart = this.dirtyEnd = -1;
    this.wrapped = false;
  }
}

export interface ScanStats {
  pointsPerRev: number;
  pointsPerSec: number;
  /** Returns / fired over the last complete revolution. */
  returns: number;
  fired: number;
  mapPoints: number;
}

export class LidarSensor {
  config: SensorConfig;
  readonly group = new THREE.Group();
  readonly scanPoints: THREE.Points;
  readonly rays: THREE.LineSegments;
  readonly map: THREE.Points;
  showMisses = false;
  mapEnabled = true;
  readonly stats: ScanStats = { pointsPerRev: 0, pointsPerSec: 0, returns: 0, fired: 0, mapPoints: 0 };

  private scanBuf = new RingBuffer(MAX_POINTS);
  private rayBuf = new RingBuffer(MAX_POINTS * 2);
  private mapBuf = new RingBuffer(MAP_POINTS);
  private mapCells = new Set<number>();
  private dirs = new Float32Array(0); // [channels × azSteps] × 3, sensor frame incl. tilt
  private azSteps = 0;
  private cursor = 0;
  private revFired = 0;
  private revReturns = 0;
  private hit: Hit = { t: 0, nx: 0, ny: 1, nz: 0, surface: Surface.Miss };
  private mats: THREE.ShaderMaterial[];

  constructor(config: SensorConfig) {
    this.config = { ...config };
    const scanMat = makeMaterial(true, 5, 1, false);
    const rayMat = makeMaterial(false, 0, 0.4, false);
    const mapMat = makeMaterial(true, 2.6, 0.85, true);
    this.mats = [scanMat, rayMat, mapMat];
    this.scanPoints = new THREE.Points(this.scanBuf.geometry, scanMat);
    this.rays = new THREE.LineSegments(this.rayBuf.geometry, rayMat);
    this.map = new THREE.Points(this.mapBuf.geometry, mapMat);
    this.rays.renderOrder = 1;
    this.scanPoints.renderOrder = 2;
    this.group.add(this.map, this.rays, this.scanPoints);
    this.setConfig(this.config);
  }

  setConfig(c: SensorConfig) {
    this.config = { ...c };
    const { hfov, azStep, channels, vfov, tilt } = this.config;
    this.azSteps = Math.max(1, Math.round(hfov / azStep));
    const n = this.azSteps * channels;
    this.dirs = new Float32Array(n * 3);
    const T = THREE.MathUtils.degToRad(tilt);
    const cT = Math.cos(T), sT = Math.sin(T);
    let k = 0;
    for (let i = 0; i < this.azSteps; i++) {
      // for a full circle do not repeat the first beam at 360°
      const az = THREE.MathUtils.degToRad(hfov >= 360 ? (i * 360) / this.azSteps : -hfov / 2 + i * azStep);
      for (let ch = 0; ch < channels; ch++) {
        const el = THREE.MathUtils.degToRad(channels === 1 ? 0 : -vfov / 2 + (vfov * ch) / (channels - 1));
        const x = Math.cos(el) * Math.cos(az), y = Math.sin(el), z = -Math.cos(el) * Math.sin(az);
        // pitch the whole sensor about its lateral axis
        this.dirs[k++] = x * cT - y * sT;
        this.dirs[k++] = x * sT + y * cT;
        this.dirs[k++] = z;
      }
    }
    this.cursor = 0;
    this.revFired = this.revReturns = 0;
    this.stats.pointsPerRev = n;
    this.stats.pointsPerSec = Math.round(n * this.config.rate);
    this.scanBuf.clear();
    this.rayBuf.clear();
    for (const m of this.mats) m.uniforms.uPeriod.value = 1 / this.config.rate;
    // additive rays saturate quickly: fade each beam as the count per revolution grows
    this.mats[1].uniforms.uAlpha.value = THREE.MathUtils.clamp(0.4 * Math.sqrt(720 / n), 0.04, 0.4);
  }

  setColorMode(mode: ColorMode) {
    for (const m of this.mats) m.uniforms.uMode.value = mode;
  }

  clearMap() {
    this.mapBuf.clear();
    this.mapCells.clear();
    this.stats.mapPoints = 0;
  }

  /** Direction of the beam at azimuth 0 / centre elevation, in world space (for the time-of-flight demo). */
  centreBeam(heading: number, out: THREE.Vector3) {
    const chMid = Math.floor((this.config.channels - 1) / 2);
    const i0 = (this.config.hfov >= 360 ? 0 : Math.floor(this.azSteps / 2)) * this.config.channels + chMid;
    const dx = this.dirs[i0 * 3], dy = this.dirs[i0 * 3 + 1], dz = this.dirs[i0 * 3 + 2];
    const cH = Math.cos(heading), sH = Math.sin(heading);
    return out.set(dx * cH + dz * sH, dy, -dx * sH + dz * cH);
  }

  /**
   * Advance the scanner by `dt` seconds. `origin` is the optical centre in world space, `heading` the
   * robot yaw (0 = +X). Casts every beam whose azimuth the spinning head passed since the last frame.
   */
  step(dt: number, now: number, origin: THREE.Vector3, heading: number, caster: ArenaCaster) {
    const { channels, range, rate } = this.config;
    const advance = Math.min(this.azSteps, rate * dt * this.azSteps, Math.max(1, Math.floor(RAY_BUDGET / channels)));
    const start = Math.floor(this.cursor);
    const end = Math.floor(this.cursor + advance);
    this.cursor = (this.cursor + advance) % this.azSteps;

    const cH = Math.cos(heading), sH = Math.sin(heading);
    const ox = origin.x, oy = origin.y, oz = origin.z;
    const hit = this.hit;
    const missColor = SURFACE_COLORS[Surface.Miss];

    for (let a = start; a < end; a++) {
      const ai = a % this.azSteps;
      if (ai === 0 && a > start) this.endRevolution();
      for (let ch = 0; ch < channels; ch++) {
        const k = (ai * channels + ch) * 3;
        const lx = this.dirs[k], ly = this.dirs[k + 1], lz = this.dirs[k + 2];
        const dx = lx * cH + lz * sH, dy = ly, dz = -lx * sH + lz * cH;
        this.revFired++;
        if (caster.cast(ox, oy, oz, dx, dy, dz, range, hit)) {
          this.revReturns++;
          const t = hit.t;
          const hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t;
          const cosInc = Math.abs(dx * hit.nx + dy * hit.ny + dz * hit.nz);
          const intensity = Math.min(1, Math.sqrt((SURFACE_ALBEDO[hit.surface] * cosInc) / (0.6 * (1 + (t / 10) * (t / 10)))));
          const c = SURFACE_COLORS[hit.surface];
          this.scanBuf.write(hx, hy, hz, c, intensity, now);
          this.rayBuf.write(ox, oy, oz, c, intensity, now);
          this.rayBuf.write(hx, hy, hz, c, intensity, now);
          if (this.mapEnabled) this.addToMap(hx, hy, hz, c, intensity, now);
        } else if (this.showMisses) {
          // hit.t is the range for a true miss, or the distance to the robot's own body for a masked self-hit
          const t = hit.t;
          this.rayBuf.write(ox, oy, oz, missColor, 0, now);
          this.rayBuf.write(ox + dx * t, oy + dy * t, oz + dz * t, missColor, 0, now);
        }
      }
    }
    if (end > start && (end % this.azSteps) === 0) this.endRevolution();

    this.scanBuf.flush();
    this.rayBuf.flush();
    this.mapBuf.flush();
    for (const m of this.mats) m.uniforms.uNow.value = now;
  }

  private endRevolution() {
    this.stats.fired = this.revFired;
    this.stats.returns = this.revReturns;
    this.revFired = this.revReturns = 0;
  }

  private addToMap(x: number, y: number, z: number, c: THREE.Color, intensity: number, now: number) {
    // 2 cm voxel de-duplication keeps the map bounded by surface area rather than time
    const key = (((x * 50 + 16) | 0) * 512 + ((-z * 50 + 16) | 0)) * 256 + (((y + 0.5) * 50) | 0);
    if (this.mapCells.has(key)) return;
    if (this.mapBuf.head === this.mapBuf.capacity - 1) this.mapCells.clear();
    this.mapCells.add(key);
    this.mapBuf.write(x, y, z, c, intensity, now);
    this.stats.mapPoints = this.mapCells.size;
  }

  setPixelRatio(pr: number) {
    for (const m of this.mats) m.uniforms.uPixelRatio.value = pr;
  }
}

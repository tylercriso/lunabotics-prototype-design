import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Robot, type RobotPose } from './robot';
import { ARENA, ArenaView, FIGURE_9_LAYOUT, randomLayout, SURFACE_COLORS, SURFACE_NAMES, TOUR_WAYPOINTS, TourPath, toWorld, type Hit, Surface } from './arena';
import { LidarSensor, PRESETS_2D, PRESETS_3D, type ColorMode, type SensorConfig } from './lidarSensor';

const deg = (d: number) => (d * Math.PI) / 180;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- demonstrations ----------
interface Demo { name: string; key: '2d' | '3d'; desc: string; presets: SensorConfig[] }
const DEMOS: Demo[] = [
  {
    name: '2D LiDAR', key: '2d', presets: PRESETS_2D,
    desc: 'One laser spins in a single plane and returns one range per angle — a slice of the world. Level on the mast it looks straight over the 30–40 cm boulders and the ~1 m walls, so only the column comes back. Tilt it down and the plane becomes a push-broom: the line it draws on the floor kinks up over a boulder and drops into a crater, and driving sweeps that line across the arena to build the map.',
  },
  {
    name: '3D LiDAR', key: '3d', presets: PRESETS_3D,
    desc: 'A stack of lasers at different elevations spins together, so every revolution returns a fan of rings across the floor, the obstacles and the walls. Boulders, crater bowls and the column appear directly as shapes in the point cloud — this is the mast-head unit in the robot concept, and it is how the robot can see a crater (a negative obstacle) before driving into it.',
  },
];

// ---------- renderer / scene ----------
const canvas = $<HTMLCanvasElement>('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.position = 'fixed';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.left = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1116);
scene.fog = new THREE.Fog(0x0e1116, 18, 40);

const arenaCentre = toWorld(ARENA.L / 2, ARENA.W / 2);
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 80);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.minDistance = 0.8;
controls.maxDistance = 25;

scene.add(new THREE.HemisphereLight(0xcfd8e8, 0x3a3328, 0.6));
const sun = new THREE.DirectionalLight(0xfff2e0, 1.9);
sun.position.copy(arenaCentre).add(new THREE.Vector3(4, 8, 3));
sun.target.position.copy(arenaCentre);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 25;
const sc = sun.shadow.camera as THREE.OrthographicCamera;
sc.left = sc.bottom = -5.5;
sc.right = sc.top = 5.5;
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
const fillLight = new THREE.DirectionalLight(0x8fb3ff, 0.35);
fillLight.position.copy(arenaCentre).add(new THREE.Vector3(-4, 3, -4));
scene.add(fillLight);

// floor outside the arena so the walls do not float in space
const apron = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 1 }));
apron.rotation.x = -Math.PI / 2;
apron.position.copy(arenaCentre).setY(-0.01);
apron.receiveShadow = true;
scene.add(apron);

// ---------- arena, path, robot, sensor ----------
const path = new TourPath(TOUR_WAYPOINTS);
const arena = new ArenaView(FIGURE_9_LAYOUT);
scene.add(arena);

const pathLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints(path.curve.getSpacedPoints(200).map((p) => p.setY(0.02))),
  new THREE.LineDashedMaterial({ color: 0x3fbf6f, dashSize: 0.1, gapSize: 0.1, transparent: true, opacity: 0.5 }),
);
pathLine.computeLineDistances();
arena.markings.add(pathLine);

const robot = new Robot();
robot.setLabels(false);
scene.add(robot);

const pose: RobotPose = { ladderAngle: deg(176), belt: 0, gate: 0, trackSpeed: 0.35, chainSpeed: 0, mast: 1, fill: 0 };
const sensor = new LidarSensor(PRESETS_2D[1]);
scene.add(sensor.group);

// ---------- time-of-flight demo: one highlighted beam with a visible pulse ----------
const tof = new THREE.Group();
const tofBeam = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
);
const tofPulse = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
const tofSpot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffb020 }));
const tofLabelEl = document.createElement('div');
tofLabelEl.className = 'label tof';
const tofLabel = new CSS2DObject(tofLabelEl);
tofLabel.position.y = 0.12;
tofSpot.add(tofLabel);
tof.add(tofBeam, tofPulse, tofSpot);
scene.add(tof);
let tofPhase = 0;
const TOF_VISUAL_SPEED = 3; // m/s on screen; light does it 1e8× faster

// ---------- state ----------
let demoIdx = 0;
let config: SensorConfig = { ...PRESETS_2D[1] };
let playing = true;
let speed = 0.35;
let follow = true;
let tourS = 0;
const robotPos = new THREE.Vector3();
const robotTan = new THREE.Vector3();
const sensorPos = new THREE.Vector3();
const beamDir = new THREE.Vector3();
const tofHit: Hit = { t: 0, nx: 0, ny: 1, nz: 0, surface: Surface.Miss };
let heading = 0;

// ---------- UI: demos ----------
const demoButtons: HTMLButtonElement[] = [];
const demosEl = $('demos');
DEMOS.forEach((d, i) => {
  const b = document.createElement('button');
  b.textContent = d.name;
  b.addEventListener('click', () => selectDemo(i, 0));
  demosEl.appendChild(b);
  demoButtons.push(b);
});

const presetEl = $<HTMLSelectElement>('preset');
const sliders = {
  range: $<HTMLInputElement>('range'), hfov: $<HTMLInputElement>('hfov'), azStep: $<HTMLInputElement>('azstep'),
  rate: $<HTMLInputElement>('rate'), tilt: $<HTMLInputElement>('tilt'), channels: $<HTMLInputElement>('channels'),
  vfov: $<HTMLInputElement>('vfov'),
};
const mastSlider = $<HTMLInputElement>('mast');
mastSlider.min = '40';

function selectDemo(i: number, presetIdx: number) {
  demoIdx = i;
  const d = DEMOS[i];
  demoButtons.forEach((b, k) => b.classList.toggle('active', k === i));
  $('demo-desc').textContent = d.desc;
  document.body.classList.toggle('demo-3d', d.key === '3d');
  presetEl.innerHTML = '';
  d.presets.forEach((p, k) => {
    const o = document.createElement('option');
    o.value = String(k);
    o.textContent = p.name;
    presetEl.appendChild(o);
  });
  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = 'Custom (sliders)';
  presetEl.appendChild(custom);
  applyPreset(presetIdx);
}

function applyPreset(k: number) {
  const p = DEMOS[demoIdx].presets[k];
  config = { ...p };
  presetEl.value = String(k);
  $('preset-note').textContent = p.note;
  syncSliders();
  sensor.setConfig(config);
  sensor.clearMap();
}

presetEl.addEventListener('change', () => {
  if (presetEl.value !== 'custom') applyPreset(Number(presetEl.value));
});

function syncSliders() {
  sliders.range.value = String(config.range);
  sliders.hfov.value = String(config.hfov);
  sliders.azStep.value = String(config.azStep);
  sliders.rate.value = String(config.rate);
  sliders.tilt.value = String(config.tilt);
  sliders.channels.value = String(Math.max(2, config.channels));
  sliders.vfov.value = String(Math.max(5, config.vfov));
  updateSliderLabels();
}

function updateSliderLabels() {
  $('range-val').textContent = `${sliders.range.value} m`;
  $('hfov-val').textContent = `${sliders.hfov.value}°`;
  $('azstep-val').textContent = `${Number(sliders.azStep.value).toFixed(2)}° → ${Math.round(Number(sliders.hfov.value) / Number(sliders.azStep.value))} beams`;
  $('rate-val').textContent = `${sliders.rate.value} Hz`;
  $('tilt-val').textContent = `${sliders.tilt.value}°`;
  $('channels-val').textContent = sliders.channels.value;
  $('vfov-val').textContent = `±${(Number(sliders.vfov.value) / 2).toFixed(1)}°`;
  $('mast-val').textContent = `${sensorPos.y.toFixed(2)} m`;
  $('speed-val').textContent = `${speed.toFixed(2)} m/s`;
}

function onSensorSlider() {
  const is3d = DEMOS[demoIdx].key === '3d';
  config = {
    ...config,
    name: 'Custom',
    range: Number(sliders.range.value),
    hfov: Number(sliders.hfov.value),
    azStep: Number(sliders.azStep.value),
    rate: Number(sliders.rate.value),
    tilt: Number(sliders.tilt.value),
    channels: is3d ? Number(sliders.channels.value) : 1,
    vfov: is3d ? Number(sliders.vfov.value) : 0,
  };
  presetEl.value = 'custom';
  $('preset-note').textContent = '';
  updateSliderLabels();
  sensor.setConfig(config);
}
for (const s of Object.values(sliders)) s.addEventListener('input', onSensorSlider);

mastSlider.value = '100';

// ---------- UI: tour ----------
const playBtn = $<HTMLButtonElement>('play');
function setPlaying(on: boolean) {
  playing = on;
  playBtn.textContent = on ? 'Pause' : 'Play';
}
playBtn.addEventListener('click', () => setPlaying(!playing));

const speedSlider = $<HTMLInputElement>('speed');
speedSlider.value = '35';
speedSlider.addEventListener('input', () => {
  speed = Number(speedSlider.value) / 100;
  updateSliderLabels();
});

function randomise() {
  arena.setLayout(randomLayout(path));
  sensor.clearMap();
}
$('randomize').addEventListener('click', randomise);
$('clear-map').addEventListener('click', () => sensor.clearMap());

$<HTMLInputElement>('follow').addEventListener('change', (e) => { follow = (e.target as HTMLInputElement).checked; });

function overviewCamera() {
  follow = false;
  $<HTMLInputElement>('follow').checked = false;
  camera.position.copy(arenaCentre).add(new THREE.Vector3(-1.5, 7.5, 6.0));
  controls.target.copy(arenaCentre).setY(0.2);
}
function chaseCamera() {
  follow = true;
  $<HTMLInputElement>('follow').checked = true;
  camera.position.copy(robotPos).addScaledVector(robotTan, -3.2).add(new THREE.Vector3(0, 2.2, 0));
  controls.target.copy(robotPos).setY(0.6);
}
$('cam-over').addEventListener('click', overviewCamera);
$('cam-chase').addEventListener('click', chaseCamera);

// ---------- UI: view ----------
const bind = (id: string, fn: (on: boolean) => void) => {
  const el = $<HTMLInputElement>(id);
  el.addEventListener('change', () => fn(el.checked));
  fn(el.checked);
};
bind('show-rays', (on) => { sensor.rays.visible = on; });
bind('show-misses', (on) => { sensor.showMisses = on; });
bind('show-scan', (on) => { sensor.scanPoints.visible = on; });
bind('show-map', (on) => { sensor.map.visible = on; sensor.mapEnabled = on; });
bind('show-zones', (on) => { arena.markings.visible = on; });
bind('show-berm', (on) => { arena.setBerm(on); sensor.clearMap(); });
bind('show-tof', (on) => { tof.visible = on; });

const colorModeEl = $<HTMLSelectElement>('color-mode');
const legendEl = $('legend');
function renderLegend() {
  const mode = Number(colorModeEl.value) as ColorMode;
  sensor.setColorMode(mode);
  legendEl.innerHTML = '';
  if (mode === 0) {
    SURFACE_NAMES.forEach((n, i) => {
      if (i === Surface.Miss && !sensor.showMisses) return;
      const s = document.createElement('span');
      s.innerHTML = `<i style="background:#${SURFACE_COLORS[i].getHexString()}"></i>${n}`;
      legendEl.appendChild(s);
    });
  } else if (mode === 1) {
    legendEl.innerHTML = '<span class="ramp height"></span><span class="ramp-ends"><em>−0.3 m</em><em>+1.5 m</em></span>';
  } else {
    legendEl.innerHTML = '<span class="ramp intensity"></span><span class="ramp-ends"><em>weak (dark BP‑1, grazing)</em><em>strong</em></span>';
  }
}
colorModeEl.addEventListener('change', renderLegend);
$<HTMLInputElement>('show-misses').addEventListener('change', renderLegend);

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
  if (e.key === '1') selectDemo(0, 0);
  else if (e.key === '2') selectDemo(1, 0);
  else if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
  else if (e.key === 'r' || e.key === 'R') randomise();
  else if (e.key === 'c' || e.key === 'C') sensor.clearMap();
});

// ---------- start-up ----------
const params = new URLSearchParams(location.search);
const startDemo = params.get('demo') === '3d' ? 1 : 0;
const startPreset = Number(params.get('preset') ?? (startDemo === 0 ? 1 : 0));
selectDemo(startDemo, Number.isFinite(startPreset) ? Math.min(startPreset, DEMOS[startDemo].presets.length - 1) : 0);
renderLegend();
updateRobot(0);
chaseCamera();
if (params.get('cam') === 'overview') overviewCamera();

$('version').textContent = `Design rev v${__APP_VERSION__} · build ${__GIT_SHA__} · ${__BUILD_DATE__}`;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  sensor.setPixelRatio(renderer.getPixelRatio());
}
window.addEventListener('resize', resize);
resize();

// ---------- per-frame helpers ----------
function updateRobot(dt: number) {
  path.sample(tourS, robotPos, robotTan);
  heading = Math.atan2(-robotTan.z, robotTan.x);
  robot.position.copy(robotPos);
  robot.rotation.y = heading;
  pose.trackSpeed = playing ? speed : 0;
  robot.update(pose, dt);
  robot.getLidarWorldPosition(sensorPos);
  arena.caster.setRobotPose(robotPos.x, robotPos.z, heading);
}

function updateTof(dt: number) {
  if (!tof.visible) return;
  sensor.centreBeam(heading, beamDir);
  const ok = arena.caster.cast(sensorPos.x, sensorPos.y, sensorPos.z, beamDir.x, beamDir.y, beamDir.z, config.range, tofHit);
  const d = tofHit.t;
  const end = new THREE.Vector3().copy(sensorPos).addScaledVector(beamDir, d);
  const pos = tofBeam.geometry.attributes.position as THREE.BufferAttribute;
  pos.setXYZ(0, sensorPos.x, sensorPos.y, sensorPos.z);
  pos.setXYZ(1, end.x, end.y, end.z);
  pos.needsUpdate = true;
  tofSpot.position.copy(end);
  tofSpot.visible = ok;
  (tofSpot.material as THREE.MeshBasicMaterial).color.copy(SURFACE_COLORS[tofHit.surface]);

  // pulse goes out, bounces, comes back, then pauses briefly
  const cycle = (2 * d) / TOF_VISUAL_SPEED + 0.5;
  tofPhase = (tofPhase + dt) % cycle;
  const travelled = tofPhase * TOF_VISUAL_SPEED;
  const along = travelled <= d ? travelled : travelled <= 2 * d ? 2 * d - travelled : 0;
  tofPulse.position.copy(sensorPos).addScaledVector(beamDir, along);
  tofPulse.visible = travelled <= 2 * d;
  const ns = (2 * d) / 0.299792458; // round trip in nanoseconds
  const txt = ok
    ? `${SURFACE_NAMES[tofHit.surface]} at ${d.toFixed(2)} m · round trip ${ns.toFixed(1)} ns`
    : `no return within ${config.range} m`;
  tofLabelEl.textContent = ok ? `${d.toFixed(2)} m · ${ns.toFixed(1)} ns` : '';
  $('ro-tof').textContent = txt;
}

let readoutTimer = 0;
function updateReadouts(dt: number) {
  readoutTimer += dt;
  if (readoutTimer < 0.25) return;
  readoutTimer = 0;
  const s = sensor.stats;
  $('ro-rev').textContent = s.pointsPerRev.toLocaleString();
  $('ro-sec').textContent = s.pointsPerSec.toLocaleString();
  $('ro-returns').textContent = s.fired ? `${s.returns.toLocaleString()} / ${s.fired.toLocaleString()} (${Math.round((100 * s.returns) / s.fired)} %)` : '–';
  $('ro-map').textContent = s.mapPoints.toLocaleString();
  $('ro-height').textContent = `${sensorPos.y.toFixed(2)} m above grade`;
  $('mast-val').textContent = `${sensorPos.y.toFixed(2)} m`;
}

// ---------- animation loop ----------
const clock = new THREE.Clock();
const prevRobot = new THREE.Vector3();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = clock.elapsedTime;

  pose.mast += (Number(mastSlider.value) / 100 - pose.mast) * Math.min(1, 1.5 * dt);
  prevRobot.copy(robotPos);
  if (playing) tourS += speed * dt;
  updateRobot(dt);

  if (follow) {
    const delta = new THREE.Vector3().subVectors(robotPos, prevRobot);
    camera.position.add(delta);
    controls.target.add(delta);
  }

  sensor.step(dt, now, sensorPos, heading, arena.caster);
  updateTof(dt);
  updateReadouts(dt);

  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();

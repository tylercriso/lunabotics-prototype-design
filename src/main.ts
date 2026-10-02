import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Robot, type RobotPose } from './robot';

const deg = (d: number) => (d * Math.PI) / 180;

// ---------- operation modes ----------
interface Mode {
  name: string;
  desc: string;
  pose: RobotPose;
  /** berm pile target 0..1 (null = leave as is) */
  berm: number | null;
}

const MODES: Mode[] = [
  {
    name: 'Stow',
    desc: 'Inspection / start configuration: ladder folded back over the hopper, mast collapsed, gate shut. ≈108×74×73 cm inside the 150×75×75 cm envelope. Comms must come up in this pose (setup starts here).',
    pose: { ladderAngle: deg(180), belt: 0, gate: 0, trackSpeed: 0, chainSpeed: 0, mast: 0, fill: 0 },
    berm: 0,
  },
  {
    name: 'Drive',
    desc: 'Traverse to the excavation zone. Mast deployed for LiDAR/stereo localisation, ladder raised and locked back.',
    pose: { ladderAngle: deg(176), belt: 0, gate: 0, trackSpeed: 0.35, chainSpeed: 0, mast: 1, fill: 0 },
    berm: null,
  },
  {
    name: 'Excavate',
    desc: 'Ladder slewed down ~45° so the buckets cut ~10 cm below grade (slew to −60° for 15 cm). Bucket chain runs, robot creeps forward; buckets invert over the top sprocket and drop straight into the belt-floor hopper.',
    pose: { ladderAngle: deg(-45), belt: 0, gate: 0, trackSpeed: 0.04, chainSpeed: 1, mast: 1, fill: 1 },
    berm: null,
  },
  {
    name: 'Transit',
    desc: 'Loaded hopper, ladder raised back for stability, driving to the construction zone.',
    pose: { ladderAngle: deg(176), belt: 0, gate: 0, trackSpeed: 0.35, chainSpeed: 0, mast: 1, fill: 1 },
    berm: null,
  },
  {
    name: 'Dump',
    desc: 'Backed up to the berm with the ladder still raised. Rear gate lifts, then the belt floor runs and meters regolith off the rear roller at ~27 cm — low drop, little dust, no tipping load.',
    pose: { ladderAngle: deg(176), belt: 1, gate: 1, trackSpeed: 0, chainSpeed: 0, mast: 1, fill: 0 },
    berm: 1,
  },
  {
    name: 'Manual',
    desc: 'Pose set from the sliders below.',
    pose: { ladderAngle: deg(0), belt: 0, gate: 0, trackSpeed: 0, chainSpeed: 0, mast: 1, fill: 0.5 },
    berm: null,
  },
];

// ---------- renderer / scene ----------
const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.position = 'fixed';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.left = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
document.body.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1116);
scene.fog = new THREE.Fog(0x0e1116, 8, 18);

const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 60);
camera.position.set(2.3, 1.5, 2.1);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.35, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.02;
controls.minDistance = 0.8;
controls.maxDistance = 10;

scene.add(new THREE.HemisphereLight(0xcfd8e8, 0x3a3328, 0.75));
const sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
sun.position.set(3, 5, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 15;
const sc = sun.shadow.camera as THREE.OrthographicCamera;
sc.left = sc.bottom = -3;
sc.right = sc.top = 3;
sun.shadow.bias = -0.0005;
scene.add(sun);
const fill = new THREE.DirectionalLight(0x8fb3ff, 0.5);
fill.position.set(-3, 2, -3);
scene.add(fill);

// ground (regolith) + grid
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(14, 14),
  new THREE.MeshStandardMaterial({ color: 0x5f5a52, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(14, 28, 0x2d3440, 0x1d222c);
grid.position.y = 0.002;
scene.add(grid);

// berm construction zone outline (2.2 × 0.9 m) behind the robot
const bermZone = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.9, 2.2)),
  new THREE.LineBasicMaterial({ color: 0xffb020 }),
);
bermZone.rotation.x = -Math.PI / 2;
bermZone.position.set(-1.35, 0.004, 0);
scene.add(bermZone);

// growing berm pile
const bermPile = new THREE.Mesh(
  new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 1 }),
);
bermPile.castShadow = bermPile.receiveShadow = true;
bermPile.position.set(-1.1, 0, 0);
scene.add(bermPile);

// excavation pit indicator (slightly darker patch ahead)
const pit = new THREE.Mesh(
  new THREE.CircleGeometry(0.35, 32),
  new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 1 }),
);
pit.rotation.x = -Math.PI / 2;
pit.position.set(0.85, 0.003, 0);
scene.add(pit);

const robot = new Robot();
scene.add(robot);

// ---------- state ----------
const current: RobotPose = { ...MODES[0].pose };
const target: RobotPose = { ...MODES[0].pose };
let bermCurrent = 0;
let bermTarget = 0;
let manual = false;

// ---------- UI ----------
const modesEl = document.getElementById('modes')!;
const descEl = document.getElementById('mode-desc')!;
const sliders = {
  ladder: document.getElementById('ladder') as HTMLInputElement,
  belt: document.getElementById('belt') as HTMLInputElement,
  gate: document.getElementById('gate') as HTMLInputElement,
  speed: document.getElementById('speed') as HTMLInputElement,
  fill: document.getElementById('fill') as HTMLInputElement,
};
sliders.ladder.min = '-60';
sliders.ladder.max = '180';
const vals = {
  ladder: document.getElementById('ladder-val')!,
  belt: document.getElementById('belt-val')!,
  gate: document.getElementById('gate-val')!,
  speed: document.getElementById('speed-val')!,
  fill: document.getElementById('fill-val')!,
};
const buttons: HTMLButtonElement[] = [];

function selectMode(i: number) {
  const m = MODES[i];
  manual = m.name === 'Manual';
  if (!manual) Object.assign(target, m.pose);
  if (m.berm !== null) bermTarget = m.berm;
  descEl.textContent = m.desc;
  buttons.forEach((b, k) => b.classList.toggle('active', k === i));
  syncSliders();
}

MODES.forEach((m, i) => {
  const b = document.createElement('button');
  b.textContent = m.name;
  b.addEventListener('click', () => selectMode(i));
  modesEl.appendChild(b);
  buttons.push(b);
});

function syncSliders() {
  sliders.ladder.value = String(Math.round((target.ladderAngle * 180) / Math.PI));
  sliders.belt.value = String(Math.round(target.belt * 100));
  sliders.gate.value = String(Math.round(target.gate * 100));
  sliders.speed.value = String(Math.round((target.trackSpeed / 0.5) * 100));
  sliders.fill.value = String(Math.round(target.fill * 100));
  updateSliderLabels();
}

function updateSliderLabels() {
  vals.ladder.textContent = `${sliders.ladder.value}°`;
  vals.belt.textContent = `${sliders.belt.value}%`;
  vals.gate.textContent = `${sliders.gate.value}%`;
  vals.speed.textContent = `${((Number(sliders.speed.value) / 100) * 0.5).toFixed(2)} m/s`;
  vals.fill.textContent = `${sliders.fill.value}%`;
}

function onSlider() {
  if (!manual) selectMode(MODES.findIndex((m) => m.name === 'Manual'));
  target.ladderAngle = deg(Number(sliders.ladder.value));
  target.belt = Number(sliders.belt.value) / 100;
  target.gate = Number(sliders.gate.value) / 100;
  target.trackSpeed = (Number(sliders.speed.value) / 100) * 0.5;
  target.fill = Number(sliders.fill.value) / 100;
  target.chainSpeed = target.ladderAngle < deg(-20) ? 1 : 0;
  target.mast = 1;
  updateSliderLabels();
}
for (const s of Object.values(sliders)) s.addEventListener('input', onSlider);

(document.getElementById('envelope') as HTMLInputElement).addEventListener('change', (e) => {
  robot.envelope.visible = (e.target as HTMLInputElement).checked;
});
(document.getElementById('labels') as HTMLInputElement).addEventListener('change', (e) => {
  robot.setLabels((e.target as HTMLInputElement).checked);
});
(document.getElementById('wire') as HTMLInputElement).addEventListener('change', (e) => {
  robot.setWireframe((e.target as HTMLInputElement).checked);
});

window.addEventListener('keydown', (e) => {
  const n = Number(e.key);
  if (n >= 1 && n <= MODES.length) selectMode(n - 1);
});

// URL params for deep-linking / screenshots: ?mode=Dump&snap&cam=2,1.5,2&labels=1
const params = new URLSearchParams(location.search);
const modeParam = params.get('mode');
const startIdx = modeParam ? MODES.findIndex((m) => m.name.toLowerCase() === modeParam.toLowerCase()) : 0;
selectMode(startIdx >= 0 ? startIdx : 0);
if (params.has('snap')) {
  Object.assign(current, target);
  bermCurrent = bermTarget;
  if (current.fill > 0 && current.gate > 0.5) current.fill = 0;
}
const camParam = params.get('cam');
if (camParam) {
  const [x, y, z] = camParam.split(',').map(Number);
  if ([x, y, z].every(Number.isFinite)) camera.position.set(x, y, z);
}
const labelsBox = document.getElementById('labels') as HTMLInputElement;
labelsBox.checked = params.get('labels') === '1';
robot.setLabels(labelsBox.checked);

// ---------- resize ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- version footer (values injected at build time, see vite.config.ts) ----------
document.getElementById('version')!.textContent = `Design rev v${__APP_VERSION__} · build ${__GIT_SHA__} · ${__BUILD_DATE__}`;

// ---------- animation loop ----------
const clock = new THREE.Clock();
const RATES: Record<keyof RobotPose, number> = {
  ladderAngle: 1.6,
  belt: 2.5,
  gate: 2.5,
  trackSpeed: 3,
  chainSpeed: 3,
  mast: 1.2,
  fill: 0.35,
};

function approach(a: number, b: number, rate: number, dt: number) {
  const k = 1 - Math.exp(-rate * dt);
  const v = a + (b - a) * k;
  return Math.abs(b - v) < 1e-4 ? b : v;
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);

  for (const key of Object.keys(RATES) as (keyof RobotPose)[]) {
    if (key === 'gate' || key === 'belt' || key === 'fill') continue;
    current[key] = approach(current[key], target[key], RATES[key], dt);
  }
  // Dump sequencing: gate opens first; belt starts once the gate is clear; hopper empties while the belt runs.
  current.gate = approach(current.gate, target.gate, RATES.gate, dt);
  const beltGoal = target.belt > 0 && current.gate < 0.6 ? 0 : target.belt;
  current.belt = approach(current.belt, beltGoal, RATES.belt, dt);
  const emptying = target.fill < current.fill;
  const fillGoal = emptying && (current.gate < 0.6 || current.belt < 0.3) ? current.fill : target.fill;
  current.fill = approach(current.fill, fillGoal, emptying ? 1.2 : RATES.fill, dt);

  bermCurrent = approach(bermCurrent, bermTarget, 0.4, dt);
  const s = 0.03 + bermCurrent * 0.42;
  bermPile.scale.set(s * 0.85, s * 0.45, s * 1.9);

  robot.update(current, dt);
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();

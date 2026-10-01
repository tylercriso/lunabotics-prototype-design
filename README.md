# Lunabotics Bucket-Ladder Excavator – 3D Preview

**Live preview:** https://tylercriso.github.io/lunabotics-prototype-design/

A deliberately simple Vite + Three.js previewer for a single NASA Lunabotics 2026–27
robot concept. No framework, no state library — just an orbit camera, a procedurally
built robot, and buttons for each operating mode.

## Run

```bash
npm install
npm run dev
```

Open the printed URL. `npm run build` type-checks and bundles to `dist/`.

## Controls

- **Mode buttons** (or keys `1`–`6`): Stow · Drive · Excavate · Transit · Dump · Manual
- **Sliders**: ladder angle, bed tilt, gate, track speed, hopper fill — moving one switches to Manual
- **View**: 150×75×75 cm stowed-envelope wireframe, component labels, wireframe shading
- Drag to orbit, wheel to zoom, right-drag to pan
- Deep-link: `?mode=Dump&snap&cam=-2.2,1.2,1.8&labels=1`

## Concept

| Subsystem | Design |
| --- | --- |
| Mobility | Tracked skid-steer, 2 × BLDC gearmotors, rigid steel cleats on a compliant belt (no pneumatic tires) |
| Excavation | Bucket ladder: 7 buckets on dual roller chain, 62 cm rails, worm-gear slew at the pivot (−48° dig → 180° stow) |
| Transfer | Buckets invert over the top sprocket into a sloped chute feeding the hopper (no bulldozing) |
| Hopper / dump | ~50 L tip bed, rear hinge, 2 × electric linear actuators, actuator-lifted rear gate |
| Sensing | Telescoping rear mast: 3D LiDAR, stereo camera pair, 2.4/5 GHz radio |
| Safety | Top-mounted Ø40 mm red E-stop, 4 marked lifting eyes, COTS power logger wired battery → logger → E-stop |

Stowed footprint ≈ 106 × 72 × 72 cm inside the 150 × 75 × 75 cm limit; deployed mast ≈ 160 cm
(limit 250 cm); mass budget ≈ 62 kg (limit 80 kg).

The geometry is a dimensioned concept, not fabrication CAD. Motor sizing, tooth forces,
tip stability, dust sealing, and controls need independent engineering. Model code lives
in `src/robot.ts`; scene, modes, and UI in `src/main.ts`.

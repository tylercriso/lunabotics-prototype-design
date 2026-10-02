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
- **Sliders**: ladder angle, belt floor speed, gate, track speed, hopper fill — moving one switches to Manual
- **View**: 150×75×75 cm stowed-envelope wireframe, component labels, wireframe shading
- Drag to orbit, wheel to zoom, right-drag to pan
- Deep-link: `?mode=Dump&snap&cam=-2.2,1.2,1.8&labels=1`

## Concept

| Subsystem | Design |
| --- | --- |
| Mobility | Tracked skid-steer, 2 × BLDC gearmotors, rigid steel cleats on a compliant belt (no pneumatic tires) |
| Excavation | Bucket ladder: 7 buckets on dual roller chain, 70 cm rails, worm-gear slew at a 56 cm pivot (−60° … 180°). −45° cuts ≈ 10 cm below grade, −60° ≈ 15 cm, bucket tip ≥ 25 cm ahead of the tracks |
| Transfer | Buckets invert over the top sprocket and drop straight into the hopper behind the pivot — no chute, no bulldozing, nothing for cohesive BP‑1 to bridge on |
| Hopper / dump | Belt‑floor hopper, 85 × 46 × 11 cm bin (≈ 42 L geometric, **~32 L working**, ≈ 50–60 kg BP‑1). Belt runs rearward and meters regolith off the rear roller at 27 cm; one small actuator lifts the top‑hinged rear gate. No tipping load, CG stays low, dump with the ladder still raised |
| Electronics | Battery + avionics in a sealed e‑bay under the ladder tower; the lid doubles as a spill deflector under the bucket discharge arc |
| Sensing / comms | Telescoping rear mast: 3D LiDAR, forward stereo pair, rear camera (reverse-to-dump, starting-zone fiducials), mast-head 2×2 MIMO 802.11 client (dual diversity antennas, Ethernet down the mast). Link must work with the mast stowed — setup starts in Stow. |
| Dust tolerance | Ladder chains run in C‑channel covers with capped sprockets (buckets hang on link ears outside the slot); track sprockets/idlers behind outboard cover plates with labyrinth shaft seals; drive, slew and belt gearmotors in sealed housings; bellows on the gate actuator; wiper seal on the telescoping mast; sealed e‑bay. Rotary brush on the mast head sweeps the LiDAR window and all three lenses (no compressed air). Discharge side shields + e‑bay lid keep bucket spill off the deck |
| Safety | Ø40 mm red E-stop on top of the slew housing (highest fixed point, outboard of the stowed ladder), 4 marked lifting eyes, COTS power logger on the tower strut at ~0.5 m wired battery → logger → E-stop |

Stowed footprint ≈ 108 × 74 × 73 cm (track covers flush with the frame side plates) inside the 150 × 75 × 75 cm limit; deployed mast ≈ 160 cm
(limit 250 cm); mass budget ≈ 60 kg (limit 80 kg).

The geometry is a dimensioned concept, not fabrication CAD. Motor sizing, tooth forces,
tip stability, dust sealing, and controls need independent engineering. Model code lives
in `src/robot.ts`; scene, modes, and UI in `src/main.ts`.

## Guidebook review (2026–27, rev 9‑17‑26)

Where the points are, per 15‑min run: autonomy up to **1400** (travel 500 / excavation 200 / dump 100;
1000 for all cycles automated; 1400 for hands‑free from the starting zone with ≥ 2 full cycles — all
× a berm multiplier that is 1.0 only above 25 L), BCP‑mass ≈ 4.4 × cm³ / 15 / kg (~350), BCP‑energy
≈ 1.5 × cm³ / 15 / Wh (~215), bandwidth up to 120 (zero above 4 Mbps incl. 0.5 Mbps per arena
camera), dust‑tolerant design 30, dust‑free operation 30, obstacle penalty up to −100.
The mechanical design should therefore optimise for **repeatable short autonomous cycles**,
low mass and energy, and dust control — not peak hopper volume.

### Fixed in this revision

| § | Rule | Was | Now |
| --- | --- | --- | --- |
| 13.3.1 | Stowed envelope ≤ 150 × 75 × 75 cm | Ladder stowed buckets‑up topped out at **77 cm** | Pivot lowered 60 → 56 cm; stowed height 73 cm |
| 13.2.4–6 | E‑stop at the highest location, reachable without reaching over/around | On the front deck at ~30 cm, under the A‑frame | On top of the slew gearbox at ~70 cm, outboard corner, clear of the stowed ladder |
| 13.1.1 | Power logger reachable without kneeling | On the deck at ~25 cm | On the front tower strut at ~50 cm, display outboard |
| 13.9.8 / 17.1 | Excavation must actually acquire regolith | −48° max slew gave a **3 cm** cut; −65° put the bucket tip into the track | 70 cm ladder: −45° → 10 cm, −60° → 15 cm, tip ≥ 25 cm ahead of the tracks |
| 14.1 | Single 802.11 link, 20 MHz on Ch 1, no amplification, no backchannels | Single stub antenna | 2×2 MIMO client on the mast head, Ethernet down the mast; no second radio (nothing else can reach the MCC) |
| 16.2 / 13.7.2 | Dump localisation; fiducials allowed on the starting‑zone frame | Forward stereo only | Rear camera on the mast head |
| — | Model interference | Mast bracket intersected the hopper sidewall/rib | Mast moved outboard to z = −33 cm |
| 17.1 / 13.4 | Payload vs. mass and tip stability | 55 L tip bed held 60–85 kg of BP‑1 (more than the robot) and lifted it 50° on two actuators | **Belt‑floor hopper**, ~32 L working: discharges rearward at 27 cm with no tipping, no chute, one gate actuator; battery/avionics moved to a sealed e‑bay under the tower |
| 13.9.8 | Material must actually transfer | 10° chute — BP‑1 (angle of repose > 35°) would bridge | Buckets discharge straight into the bin; the e‑bay lid catches any forward spill |

### Open design trades (need a decision)

1. ~~Hopper payload~~ — **resolved**: ~32 L working belt‑floor hopper. Full autonomy needs ≥ 2 complete
   cycles and the berm multiplier saturates at 25 L; ~32 L filled in ~1.5–2 min gives 3–4 cycles with a
   lighter frame and no tip actuators. Caveat: discharge is only 27 cm above grade, so the berm is built
   by backing up in steps and relying on the metered belt to pile rather than by dropping from height —
   verify the pile reaches the scored height, or add a short tail flap to the gate.
2. ~~Transfer chute~~ — **resolved** by (c): belt floor, discharge straight into the bin.
3. ~~Dust points~~ — **resolved in the model** (judges still decide at inspection):
   | Points | Feature |
   | --- | --- |
   | Drivetrain enclosed (15) | Chain‑run covers + sprocket caps on the ladder; outboard track covers over sprockets/idlers; drive, slew and belt gearmotors in housings; belt floor fully inside the bin |
   | Active dust control (5) | Rotary brush on the mast head across the LiDAR band, cammed wiper blades on the three lenses — runs whenever the mast is up |
   | Custom seals (10) | Labyrinth/felt seals on slew bearings and track shafts, bellows on the gate actuator rod, mast wiper seal, gasketed e‑bay lid |
   | Transfer without dumping on robot (5) | Buckets discharge inside the bin walls; side shields extend the walls forward past the pivot; e‑bay lid is the deflector under the arc |
   | Digging / driving without dust (20 + 5) | Operational: slow chain (buckets cut, don't fling), 4 cm/s creep, metered belt discharge from 27 cm rather than a tip‑dump. Covers are drawn translucent in the model so the mechanisms stay visible. |
   Also bring a dust cover for the WAP on the arena wall (§14 encourages it); it is team‑supplied.
4. **Localisation.** No GPS/compass; walls usable only as detected features, not a‑priori. Plan on
   self‑powered AprilTag boards clamped to the starting‑zone frame (mass counts toward 80 kg) seen by
   the rear camera, plus LiDAR odometry. The autonomy review requires a live obstacle‑map + path
   visualisation in the MCC.
5. **Bandwidth.** Scoring wants < 1 Mbps average; stream one low‑rate compressed camera on demand,
   send the LiDAR map as occupancy cells, not point clouds. Both arena cameras cost 1 Mbps.

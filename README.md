# CHERNOBYL MALL — AI System Documentation

## Architecture Overview

```
EnemyManager
├── Rezagado × 4      (patrol + hideout learning)
├── Vigilante × 1     (vibration sentinel)
├── Presencia × 1     (perception distortion)
├── Colectivo × 1     (mass, destroys hideouts)
└── ViktorBoss × 1    (final boss, sewer chase)

NightProgression      (activates enemies by night, fires events)
TensionSystem         (tension 0–1, dosimeter, audio state, post-FX)
HideoutSystem         (discovery, entry/exit, progressive closure)

Core dependencies:
  StateMachine        (generic FSM + AI_STATE constants)
  AIStateMachine      (pre-built states: Patrol/Alert/Chase/Search/Check/Stun/Frenzy)
  NavigationMesh      (A* pathfinding on XZ grid, path smoothing)
  EventBus            (pub/sub, EV catalogue)
```

---

## FSM States (shared)

| State           | Description                              |
| --------------- | ---------------------------------------- |
| `dormant`       | Daytime / not yet active. Mesh hidden.   |
| `idle`          | Night, standing. Short timer → patrol.   |
| `patrol`        | Follows waypoint loop.                   |
| `alert`         | Heard noise → moving to source.          |
| `search`        | Lost player → expanding spiral search.   |
| `chase`         | LOS on player → pursuit. Catch at 1 m.   |
| `check_hideout` | Walking to inspect a known hiding spot.  |
| `stunned`       | Drawn by audio lure (projector / radio). |
| `frenzy`        | Night 5 max aggression. No search phase. |

Viktor boss additionally has: `viktor_observe`, `viktor_sewer_approach`, `viktor_pursue`, `viktor_collapse`, `viktor_buried`.

---

## Detection Systems

### Hearing (all except Vigilante)

- Player emits noise events via `Bus.emit(EV.PLAYER_NOISE, { position, intensity, wet })`
- Noise intensity: walk=1.0, run=4.0, crouch=0.2, interact=2.5
- Wet feet multiply by 1.8
- Each enemy compares `dist ≤ hearingRange` and `intensity > 0`

### Vibration (Vigilante only)

- Same noise events but uses `_vibrationRange=20 m` and `_vibrationThreshold`
- Threshold scales down per night (night 1: 2.5 → night 5: 0.5)
- Running triggers IMMEDIATELY within range regardless of threshold

### Sight (all)

- Raycast from eye height against `collidables[]`
- Sight cone check using dot product against forward vector
- Rezagado/Colectivo: 60° cone, 8–12 m; Viktor: omnidirectional 40 m

---

## Hideout System

### Closure Logic (core design rule)

1. **Most-recently-used hideout closes first** — never random
2. Closures happen at **night start** (during "day" phase — invisible to player)
3. Night 5: one additional hideout may close **mid-night**

### Open Counts Per Night

| Night | Open Hideouts             |
| ----- | ------------------------- |
| 1     | 8                         |
| 2     | 6                         |
| 3     | 4                         |
| 4     | 3                         |
| 5     | 2 (–1 mid-night possible) |

### Rezagado Learning

- 2+ uses of same hideout in one night → enemy learns it, schedules a check
- Night 3+: Rezagado patrols include detours to all learned hideouts

---

## Night Progression

| Night | Active Enemies                                  | Special Event            |
| ----- | ----------------------------------------------- | ------------------------ |
| 1     | 1 Rezagado                                      | First sighting (atrium)  |
| 2     | 2 Rezagados + Vigilante                         | 90s blackout             |
| 3     | 3 Rezagados + Vigilante + Presencia             | Radio voice (Semenov)    |
| 4     | 4 Rezagados + Vigilante + Presencia + Colectivo | Viktor cameo silhouette  |
| 5     | All + Viktor active                             | Frenzy mode, sewer chase |

---

## Viktor Boss Phases

```
DORMANT
  ↓ bus: boss:trigger_cameo
OBSERVE       (Night 4 — 5–9s, stares, vanishes)
  ↓ bus: boss:trigger_sewer
SEWER_APPROACH (amber reflection in water, player descends)
  ↓ auto: player reaches sewerDepth >= 2
PURSUE        (constant speed 3.8 m/s, no stop, no sound except limb-scrapes)
  ↓ auto: player.userData.inCollapseRoom === true
COLLAPSE      (Viktor enters room, 8s countdown, player must flee)
  ↓ auto: countdown ends
BURIED        (mesh sinks, Bus.emit(GAME_WIN))
```

---

## Tension & Dosimeter

### Tension sources (per second)

| Condition                 | Rate    |
| ------------------------- | ------- |
| Enemy chasing player      | +1.0/s  |
| Enemy in alert, same zone | +0.8/s  |
| Enemy searching nearby    | +0.5/s  |
| Enemy patrolling nearby   | +0.3/s  |
| No enemy nearby           | −0.02/s |

### Audio states (driven by tension)

| Tension | Audio State |
| ------- | ----------- |
| 0.0+    | explore     |
| 0.25+   | alert       |
| 0.55+   | danger      |
| 0.80+   | contact     |

### Dosimeter effects (driven by normalised 0–1)

| Level | Effect                       |
| ----- | ---------------------------- |
| 0.30  | Chromatic aberration begins  |
| 0.50  | Camera shake begins          |
| 0.65  | Edge desaturation begins     |
| 0.75  | Phantom audio hallucinations |
| 0.90  | Screen distortion            |

---

## Integration Example

```js
import { EnemyManager } from "./enemies/EnemyManager.js";
import { NightProgression } from "./systems/NightProgression.js";
import { HideoutSystem } from "./systems/HideoutSystem.js";
import { TensionSystem } from "./systems/TensionSystem.js";
import { Bus, EV } from "./core/EventBus.js";

// 1. Build navmesh
navMesh.buildFlat(-50, 50, -50, 50);
navMesh.blockSceneObjects(scene);

// 2. Create enemies
const enemies = new EnemyManager({
  scene,
  navMesh,
  playerRef: player,
  collidables: worldMeshes,
  patrolRoutes: [route1, route2, route3, route4],
  vigilantePositions: [pos1, pos2, pos3],
  manifestPoints: manifestArray,
  colectivoZones: ["atrio", "zona_i", "zona_e"],
  cameoPosition: new THREE.Vector3(10, 0, 5),
  collapseRoomCenter: new THREE.Vector3(0, -6, 0),
});
enemies.init();

// 3. Create supporting systems
const hideouts = new HideoutSystem(engine);
const tension = new TensionSystem(
  engine,
  player,
  enemies.activeEnemyList,
  zones,
);
const progression = new NightProgression({
  enemyRegistry: enemies.registry,
  hideoutSystem: hideouts,
  tensionSystem: tension,
});

// 4. Game loop
function update(dt) {
  enemies.update(dt);
  hideouts.update(dt);
  tension.update(dt);
  progression.update(dt);
}

// 5. Start
Bus.emit(EV.NIGHT_START, { nightNumber: 1 });
```

---

## File Map (AI system files only)

```
core/
  StateMachine.js      Generic FSM + AI_STATE constants
  EventBus.js          Pub/sub + EV event catalogue

world/
  NavigationMesh.js    A* pathfinding grid

enemies/
  EnemyBase.js         Abstract base: sensors, LOS, memory, adaptation
  AIStateMachine.js    Pre-built states + buildAIFSM() factory
  Rezagado.js          Patrol + hideout learning
  Vigilante.js         Vibration sentinel
  Presencia.js         Perception distortion entity
  Colectivo.js         Fused mass, hideout destruction
  ViktorBoss.js        5-phase boss sequence
  EnemyManager.js      Top-level orchestrator + sound dispatch

systems/
  HideoutSystem.js     Discovery, entry, progressive closure
  TensionSystem.js     Tension 0–1, dosimeter, audio state, post-FX driver
  NightProgression.js  Enemy activation, difficulty scaling, scripted events
```

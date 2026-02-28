/**
 * enemies/Rezagado.js
 * CRIATURA 01 — EL REZAGADO (Otstalyy)
 *
 * Former maintenance workers mutated by LESNOJ isotopes.
 * Primary patroller; learns player's hideout habits and verifies them.
 *
 * Special mechanics:
 *  - Uses same hideout twice in one night → Rezagado adds it to patrol
 *  - Night 3+ begins systematically checking previously-used hideouts
 *  - Bioluminescent eye-cavities (green PointLight on mesh)
 *  - Dragging gait audio cue handled via userData for AudioSystem
 */

import * as THREE from "three";
import { EnemyBase } from "./EnemyBase.js";
import { buildAIFSM } from "./AIStateMachine.js";
import { AI_STATE } from "../core/StateMachine.js";
import { Bus, EV } from "../core/EventBus.js";
import { AI_STATE as S } from "../core/StateMachine.js";

// Re-import from AIStateMachine explicitly
import {
  DormantState,
  IdleState,
  AlertState,
  ChaseState,
  CheckHideoutState,
  StunnedState,
  FrenzyState,
} from "./AIStateMachine.js";
import { State } from "../core/StateMachine.js";

// ── Custom PatrolState with hideout verification injected ─────
class RezagadoPatrolState extends State {
  constructor(owner) {
    super(AI_STATE.PATROL, owner);
  }

  onEnter() {
    this._path = [];
    this._wpIdx = this.owner._patrolIndex ?? 0;
    this._nextHideoutCheck = this._pickHideoutCheck();
    this._requestPath();
  }

  _pickHideoutCheck() {
    // Night 3+: cycle through known (used) hideouts during patrol
    if (this.owner._nightLevel < 3) return null;
    const list = [...this.owner._usedHideouts];
    if (list.length === 0) return null;
    // Pick the most recently used
    return list[list.length - 1];
  }

  _requestPath() {
    const wps = this.owner.patrolWaypoints;
    if (!wps?.length) {
      this.owner.fsm.setState(AI_STATE.IDLE);
      return;
    }
    const target = wps[this._wpIdx];
    this._path = this.owner.navMesh.findPath(this.owner.mesh.position, target);
    this._path = this.owner.navMesh.smoothPath(this._path);
  }

  onUpdate(dt) {
    // Periodically detour to inspect a known hideout
    if (this._nextHideoutCheck && Math.random() < 0.002) {
      this.owner._hideoutToCheck = this._nextHideoutCheck;
      this.go(AI_STATE.CHECK_HIDEOUT);
      return;
    }

    const wps = this.owner.patrolWaypoints;
    if (!wps?.length) {
      this.go(AI_STATE.IDLE);
      return;
    }

    const reached = this._moveAlongPath(dt);
    if (reached) {
      this._wpIdx = (this._wpIdx + 1) % wps.length;
      this.owner._patrolIndex = this._wpIdx;
      this.go(AI_STATE.IDLE);
    }
  }

  _moveAlongPath(dt) {
    if (!this._path?.length) return true;
    const t = this._path[0];
    const dir = new THREE.Vector3(
      t.x - this.owner.mesh.position.x,
      0,
      t.z - this.owner.mesh.position.z,
    );
    const dist = dir.length();
    if (dist < 0.15) {
      this._path.shift();
      return this._path.length === 0;
    }
    dir.normalize().multiplyScalar(this.owner.patrolSpeed * dt);
    this.owner.mesh.position.add(dir);
    this.owner.mesh.rotation.y = Math.atan2(dir.x, dir.z);

    // Dragging gait — emit audio cue each 0.7 s
    this.owner._gaitTimer = (this.owner._gaitTimer ?? 0) - dt;
    if (this.owner._gaitTimer <= 0) {
      this.owner._gaitTimer = 0.7;
      this.owner.mesh.userData.gaitStep = true; // AudioSystem reads this
    }
    return false;
  }
}

// ── Custom SearchState: tighter spiral + returns to last hideout ─
class RezagadoSearchState extends State {
  constructor(owner) {
    super(AI_STATE.SEARCH, owner);
  }

  onEnter(prev) {
    Bus.emit(EV.ENEMY_STATE_CHANGE, {
      enemy: this.owner,
      from: prev?.name,
      to: this.name,
    });
    this._buildPoints();
    this._idx = 0;
    this._timer = 0;
    this._max = 18 + Math.random() * 8;
    this._advance();
  }

  _buildPoints() {
    const c =
      this.owner._lastKnownPlayerPos?.clone() ??
      this.owner.mesh.position.clone();
    this._pts = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 * 2.5;
      const r = (i / 10) * this.owner.searchRadius;
      this._pts.push(
        new THREE.Vector3(c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r),
      );
    }
    // Append known hideouts as extra check points
    if (this.owner._nightLevel >= 3) {
      for (const h of this.owner._usedHideouts) {
        if (h.position) this._pts.push(h.position.clone());
      }
    }
  }

  _advance() {
    if (this._idx >= this._pts.length) {
      this.go(AI_STATE.PATROL);
      return;
    }
    this._path = this.owner.navMesh.findPath(
      this.owner.mesh.position,
      this._pts[this._idx],
    );
    this._path = this.owner.navMesh.smoothPath(this._path);
  }

  onUpdate(dt) {
    this._timer += dt;
    if (this._timer >= this._max) {
      this.go(AI_STATE.PATROL);
      return;
    }

    if (!this._path?.length) {
      this._idx++;
      this._advance();
      return;
    }

    const t = this._path[0];
    const dir = new THREE.Vector3(
      t.x - this.owner.mesh.position.x,
      0,
      t.z - this.owner.mesh.position.z,
    );
    const d = dir.length();
    if (d < 0.15) {
      this._path.shift();
      if (!this._path.length) {
        this._idx++;
        this._advance();
      }
      return;
    }
    dir.normalize().multiplyScalar(this.owner.alertSpeed * dt);
    this.owner.mesh.position.add(dir);
    this.owner.mesh.rotation.y = Math.atan2(dir.x, dir.z);
  }
}

// ── Rezagado class ─────────────────────────────────────────────
export class Rezagado extends EnemyBase {
  static BASE_HEARING = 12;
  static BASE_SIGHT = 8;
  static BASE_CHASE = 3.2;

  constructor(cfg) {
    super({
      ...cfg,
      stats: {
        patrolSpeed: 1.2,
        alertSpeed: 2.0,
        chaseSpeed: 3.2,
        hearingRange: 12,
        sightRange: 8,
        sightAngle: Math.PI / 3,
        searchRadius: 8,
        radiationEmit: 0.5,
        ...(cfg.stats ?? {}),
      },
    });

    // Hideout usage memory (persists across sessions in same night)
    this._usedHideouts = []; // array of hideout objects, ordered by use time
    this._hideoutUseCount = new Map(); // hideoutId -> use count this night

    // Subscribe to hideout events
    this._unsubs.push(Bus.on(EV.HIDEOUT_USED, (d) => this._onHideoutUsed(d)));
  }

  _buildMesh() {
    const group = new THREE.Group();

    // Body
    const bodyGeo = new THREE.CapsuleGeometry(0.3, 1.1, 4, 8);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a1a,
      roughness: 0.9,
      metalness: 0.0,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.9;
    body.castShadow = true;
    group.add(body);

    // Head (larger, hunched)
    const headGeo = new THREE.SphereGeometry(0.22, 8, 8);
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.set(0.05, 1.75, -0.1); // slightly forward-hunched
    head.castShadow = true;
    group.add(head);

    // Bioluminescent eye glow (green)
    this._eyeLight = new THREE.PointLight(0x33ff44, 0.4, 2.5);
    this._eyeLight.position.set(0.05, 1.78, 0.15);
    group.add(this._eyeLight);

    // Audio cue metadata
    group.userData.audioType = "rezagado";
    group.userData.enemyId = this.id;
    return group;
  }

  _buildFSM() {
    return buildAIFSM(this, {
      [AI_STATE.PATROL]: RezagadoPatrolState,
      [AI_STATE.SEARCH]: RezagadoSearchState,
    });
  }

  // ── Eye glow pulse ───────────────────────────────────────────
  update(dt) {
    super.update(dt);
    if (this._eyeLight) {
      const pulse = 0.4 + Math.sin(Date.now() * 0.003) * 0.1;
      this._eyeLight.intensity = pulse;
    }
  }

  // ── Hideout learning ─────────────────────────────────────────
  _onHideoutUsed({ hideout, nightNumber }) {
    if (!hideout) return;

    const count = (this._hideoutUseCount.get(hideout.id) ?? 0) + 1;
    this._hideoutUseCount.set(hideout.id, count);

    // Track ordered list (most recent last)
    this._usedHideouts = this._usedHideouts.filter((h) => h.id !== hideout.id);
    this._usedHideouts.push(hideout);

    // After 2 uses in one night, add to known set and schedule a check
    if (count >= 2 && this._nightLevel >= 2) {
      this.learnHideout(hideout.id);
      this.scheduleHideoutCheck(hideout);
    }
  }

  /** Called by NightProgression at night end to reset per-night counters. */
  resetNightMemory() {
    this._hideoutUseCount.clear();
    // Keep _usedHideouts across nights for night 3+ patrol integration
  }
}

export default Rezagado;

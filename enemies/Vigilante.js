/**
 * enemies/Vigilante.js
 * CRIATURA 02 — EL VIGILANTE (Strazh)
 *
 * Former security guards. No eyes — senses ground vibration.
 * Does NOT patrol. Stands at strategic positions.
 * Night 4+ slowly drifts between positions.
 *
 * Detection mechanics:
 *  - Walking (vibration 1.0) does NOT trigger within range
 *  - Running (vibration 4.0) triggers IMMEDIATELY
 *  - Crouching (vibration 0.1) — practically invisible
 *  - Wet feet multiply vibration by 1.8
 *  - Detection threshold scales DOWN each night (harder to avoid)
 *
 * Unique behaviour:
 *  - When activated: one sharp CLICK, then absolute silence
 *  - Stays at position for 10 s scanning, then resets
 *  - Night 4+: slowly walks to next strategic position
 */

import * as THREE from "three";
import { EnemyBase } from "./EnemyBase.js";
import { buildAIFSM } from "./AIStateMachine.js";
import { State, AI_STATE } from "../core/StateMachine.js";
import { Bus, EV } from "../core/EventBus.js";

// Vibration thresholds per night
const VIBRATION_THRESHOLDS = [
  null, // placeholder index 0
  2.5, // Night 1: only running triggers
  2.0, // Night 2
  1.5, // Night 3
  0.8, // Night 4: even moderate walking can trigger
  0.5, // Night 5: near-silent steps may trigger
];

// ── Custom IDLE: stand still and scan ────────────────────────
class VigilanteIdleState extends State {
  constructor(owner) {
    super(AI_STATE.IDLE, owner);
  }
  onEnter() {
    this.owner._scanAngle = 0;
    this._scanTimer = 0;
  }

  onUpdate(dt) {
    // Slow head-scan oscillation
    this._scanTimer += dt;
    this.owner.mesh.rotation.y =
      this.owner._baseYaw + Math.sin(this._scanTimer * 0.4) * (Math.PI / 6);
  }
}

// ── Custom ALERT: click + scan mode (no movement) ────────────
class VigilanteAlertState extends State {
  constructor(owner) {
    super(AI_STATE.ALERT, owner);
  }
  onEnter(prev) {
    Bus.emit(EV.ENEMY_STATE_CHANGE, {
      enemy: this.owner,
      from: prev?.name,
      to: this.name,
    });
    // Trigger click audio cue
    this.owner.mesh.userData.playSound = "vigilante_click";
    this._timer = 10;
    this._turned = false;
    // Face toward the vibration source
    const src = this.owner._alertTarget;
    if (src) {
      const dir = new THREE.Vector3(
        src.x - this.owner.mesh.position.x,
        0,
        src.z - this.owner.mesh.position.z,
      );
      if (dir.length() > 0) {
        this.owner.mesh.rotation.y = Math.atan2(dir.x, dir.z);
      }
    }
  }

  onUpdate(dt) {
    this._timer -= dt;
    if (this._timer <= 0) {
      this.go(AI_STATE.IDLE);
      return;
    }
    // Check if player is within catch range
    const player = this.owner._playerRef;
    if (!player) return;
    const dist = this.owner.mesh.position.distanceTo(player.position);
    if (dist < 1.2) {
      Bus.emit(EV.PLAYER_CAUGHT);
    }
    // Transition to full chase if they move further
    if (dist < this.owner.sightRange && this.owner._checkLOS(player.position)) {
      this.go(AI_STATE.CHASE);
    }
  }
}

// ── Custom PATROL: slow drift between positions (Night 4+) ───
class VigilanteDriftState extends State {
  constructor(owner) {
    super(AI_STATE.PATROL, owner);
  }

  onEnter() {
    const positions = this.owner._strategicPositions;
    if (!positions?.length) {
      this.go(AI_STATE.IDLE);
      return;
    }
    this._posIdx = (this.owner._posIdx ?? 0 + 1) % positions.length;
    this.owner._posIdx = this._posIdx;
    const target = positions[this._posIdx];
    this._path = this.owner.navMesh.findPath(this.owner.mesh.position, target);
    this._path = this.owner.navMesh.smoothPath(this._path);
  }

  onUpdate(dt) {
    if (!this._path?.length) {
      this.go(AI_STATE.IDLE);
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
        this.owner._baseYaw = this.owner.mesh.rotation.y;
        this.go(AI_STATE.IDLE);
      }
      return;
    }
    dir.normalize().multiplyScalar(this.owner.patrolSpeed * 0.6 * dt);
    this.owner.mesh.position.add(dir);
    this.owner.mesh.rotation.y = Math.atan2(dir.x, dir.z);
  }
}

// ── Vigilante class ─────────────────────────────────────────────
export class Vigilante extends EnemyBase {
  static BASE_HEARING = 0; // no hearing
  static BASE_SIGHT = 0; // no vision
  static BASE_CHASE = 3.0;

  /**
   * @param {THREE.Vector3[]} cfg.strategicPositions — positions to guard / drift between
   */
  constructor(cfg) {
    super({
      ...cfg,
      stats: {
        patrolSpeed: 0.8,
        alertSpeed: 2.5,
        chaseSpeed: 3.0,
        hearingRange: 0, // overridden — uses vibration instead
        sightRange: 10, // only used when in chase mode
        sightAngle: Math.PI * 1.5, // nearly 270°
        searchRadius: 5,
        radiationEmit: 0.6,
        ...(cfg.stats ?? {}),
      },
    });

    this._strategicPositions = cfg.strategicPositions ?? [];
    this._posIdx = 0;
    this._vibrationRange = 20; // detection radius
    this._vibrationThreshold = 2.5; // overridden per night in setNightLevel
    this._baseYaw = 0;

    // Subscribe to player movement events (vibration sensing)
    this._unsubs.push(
      Bus.on(EV.PLAYER_NOISE, (d) => this._onVibration(d)),
      Bus.on(EV.PLAYER_RUN_START, () => this._onRunDetected()),
    );
  }

  _buildFSM() {
    return buildAIFSM(this, {
      [AI_STATE.IDLE]: VigilanteIdleState,
      [AI_STATE.ALERT]: VigilanteAlertState,
      [AI_STATE.PATROL]: VigilanteDriftState,
    });
  }

  _buildMesh() {
    const group = new THREE.Group();

    // Tall, wide-shouldered body
    const bodyGeo = new THREE.CapsuleGeometry(0.38, 1.4, 4, 8);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a14,
      roughness: 1.0,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 1.05;
    body.castShadow = true;
    group.add(body);

    // Head (tilted)
    const headGeo = new THREE.SphereGeometry(0.24, 8, 8);
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.set(0.05, 2.1, 0.0);
    head.rotation.z = 0.25; // permanently tilted
    head.castShadow = true;
    group.add(head);

    // Nerve-network on face (thin lines simulated via emissive plane)
    const nerveMat = new THREE.MeshStandardMaterial({
      color: 0xff4422,
      emissive: 0xff2200,
      emissiveIntensity: 0.3,
      roughness: 1.0,
    });
    const nervePlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.3),
      nerveMat,
    );
    nervePlane.position.set(0, 2.12, 0.23);
    group.add(nervePlane);

    group.userData.audioType = "vigilante";
    group.userData.enemyId = this.id;
    return group;
  }

  // ── Vibration detection (overrides hearing) ──────────────────

  _onVibration({ position, intensity, wet }) {
    if (this.fsm.isAny(AI_STATE.DORMANT, AI_STATE.STUNNED, AI_STATE.CHASE))
      return;

    const dist = this.mesh.position.distanceTo(position);
    if (dist > this._vibrationRange) return;

    const adjusted = intensity * (wet ? 1.8 : 1.0);
    if (adjusted >= this._vibrationThreshold) {
      this._alertTarget = position.clone();
      this.mesh.userData.playSound = "vigilante_click";
      Bus.emit(EV.ENEMY_HEARD_NOISE, { enemy: this, noisePos: position });
      this.fsm.setState(AI_STATE.ALERT);
    }
  }

  _onRunDetected() {
    // Running near vigilante triggers immediately regardless of threshold
    if (!this._playerRef) return;
    const dist = this.mesh.position.distanceTo(this._playerRef.position);
    if (
      dist <= this._vibrationRange &&
      !this.fsm.isAny(AI_STATE.DORMANT, AI_STATE.CHASE)
    ) {
      this._alertTarget = this._playerRef.position.clone();
      this.mesh.userData.playSound = "vigilante_click";
      this.fsm.setState(AI_STATE.ALERT);
    }
  }

  // ── Override base hearing sensor (we use vibration instead) ──
  _runSensors(dt) {
    if (this.fsm.isAny(AI_STATE.DORMANT, AI_STATE.STUNNED)) return;

    // Chase if has LOS and player is close
    if (!this.fsm.is(AI_STATE.CHASE) && this._playerRef) {
      const dist = this.mesh.position.distanceTo(this._playerRef.position);
      if (dist < this.sightRange && this._checkLOS(this._playerRef.position)) {
        this.fsm.setState(AI_STATE.CHASE);
      }
    }
  }

  setNightLevel(nightLevel, adaptRate = 0) {
    super.setNightLevel(nightLevel, adaptRate);
    this._vibrationThreshold =
      VIBRATION_THRESHOLDS[
        Math.min(nightLevel, VIBRATION_THRESHOLDS.length - 1)
      ] ?? 2.5;
  }

  update(dt) {
    super.update(dt);
    // Night 4+: allow drift between positions
    if (this._nightLevel >= 4 && this.fsm.is(AI_STATE.IDLE)) {
      this._driftTimer = (this._driftTimer ?? 0) + dt;
      if (this._driftTimer > 30) {
        this._driftTimer = 0;
        this.fsm.setState(AI_STATE.PATROL);
      }
    }
  }
}

export default Vigilante;

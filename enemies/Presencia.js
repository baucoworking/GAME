/**
 * enemies/Presencia.js
 * CRIATURA 03 — LA PRESENCIA (Prisutstviye)
 *
 * Former LESNOJ researcher. Does NOT attack directly.
 * Instead, distorts the player's perception of the world.
 *
 * Mechanics:
 *  - Appears as a seemingly-normal woman in a lab coat at distance
 *  - Close up: flat/non-3D appearance, depth-inverted perspective
 *  - When active in a zone: UI notes show altered text, doors seem closed
 *  - Only repelled by correct radio frequency (puzzle P-03)
 *  - Night 2: scripted appearance; Night 3+: dynamic system
 *  - Emits typewriter / echo sounds through AudioSystem
 *
 * Does NOT use navmesh movement in the traditional sense.
 * Teleports between predefined "manifestation points" silently.
 * Her "movement" is discontinuous to maximise cognitive horror.
 */

import * as THREE from "three";
import { EnemyBase } from "./EnemyBase.js";
import { buildAIFSM } from "./AIStateMachine.js";
import { State, AI_STATE } from "../core/StateMachine.js";
import { Bus, EV } from "../core/EventBus.js";

// ── Custom states ─────────────────────────────────────────────

/** Dormant: fully absent from scene */
class PresenciaDormantState extends State {
  constructor(owner) {
    super(AI_STATE.DORMANT, owner);
  }
  onEnter() {
    this.owner.mesh.visible = false;
    Bus.emit(EV.PERCEPTION_RESTORE);
  }
  onExit() {
    this.owner.mesh.visible = true;
  }
}

/** Idle: manifests at a point but does nothing yet */
class PresenciaIdleState extends State {
  constructor(owner) {
    super(AI_STATE.IDLE, owner);
  }
  onEnter() {
    this.owner._manifestAt(this.owner._nextManifestPoint());
    this._timer = 5 + Math.random() * 8;
  }
  onUpdate(dt) {
    this._timer -= dt;
    if (this._timer <= 0) this.go(AI_STATE.PATROL);
  }
}

/** Patrol: silently teleport between manifest points, emitting distortion */
class PresenciaPatrolState extends State {
  constructor(owner) {
    super(AI_STATE.PATROL, owner);
  }
  onEnter() {
    this._dwellTimer = 3 + Math.random() * 5;
    this._distortActive = false;
  }
  onUpdate(dt) {
    if (!this.owner._playerRef) return;
    const dist = this.owner.mesh.position.distanceTo(
      this.owner._playerRef.position,
    );

    // If player is in same zone, activate perception distortion
    if (dist < 25 && !this._distortActive) {
      this._distortActive = true;
      Bus.emit(EV.PERCEPTION_DISTORT, {
        intensity: THREE.MathUtils.clamp(1 - dist / 25, 0.1, 1),
      });
    } else if (dist >= 25 && this._distortActive) {
      this._distortActive = false;
      Bus.emit(EV.PERCEPTION_RESTORE);
    }

    this._dwellTimer -= dt;
    if (this._dwellTimer <= 0) {
      // Teleport: blink out, reappear at new point
      this.owner._blink(() => {
        this.owner._manifestAt(this.owner._nextManifestPoint());
        this._dwellTimer = 3 + Math.random() * 5;
      });
    }
  }
  onExit() {
    if (this._distortActive) Bus.emit(EV.PERCEPTION_RESTORE);
  }
}

/** Chase: player is staring at her — she approaches from unexpected angle */
class PresenciaApproachState extends State {
  constructor(owner) {
    super(AI_STATE.CHASE, owner);
  }
  onEnter(prev) {
    Bus.emit(EV.ENEMY_STATE_CHANGE, {
      enemy: this.owner,
      from: prev?.name,
      to: this.name,
    });
    // Teleport BEHIND player
    const player = this.owner._playerRef;
    if (player) {
      const behind = player.position
        .clone()
        .add(
          new THREE.Vector3(0, 0, -2).applyEuler(
            new THREE.Euler(0, player.rotation?.y ?? 0, 0),
          ),
        );
      this.owner.mesh.position.copy(behind);
    }
    this._timer = 4;
  }
  onUpdate(dt) {
    this._timer -= dt;
    const player = this.owner._playerRef;
    if (player) {
      const dist = this.owner.mesh.position.distanceTo(player.position);
      if (dist < 1.0) {
        // Touching causes hallucination episode, not game-over
        Bus.emit(EV.PERCEPTION_DISTORT, { intensity: 1.0, type: "episode" });
        this.go(AI_STATE.PATROL);
        return;
      }
      // Inverted movement: mesh appears to move AWAY but actually closes in
      // (achieved by reversing the direction vector from player's perspective)
      const dir = new THREE.Vector3()
        .subVectors(player.position, this.owner.mesh.position)
        .normalize()
        .multiplyScalar(1.2 * dt);
      this.owner.mesh.position.add(dir);
    }
    if (this._timer <= 0) this.go(AI_STATE.PATROL);
  }
}

/** Stunned: repelled by correct radio frequency */
class PresenciaRepelledState extends State {
  constructor(owner) {
    super(AI_STATE.STUNNED, owner);
  }
  onEnter() {
    Bus.emit(EV.PERCEPTION_RESTORE);
    this._timer = 45; // 45 s of silence after repelling
    // Move away rapidly
    const player = this.owner._playerRef;
    if (player) {
      const away = new THREE.Vector3()
        .subVectors(this.owner.mesh.position, player.position)
        .normalize()
        .multiplyScalar(20);
      this.owner.mesh.position.add(away);
    }
    this.owner.mesh.visible = false;
  }
  onUpdate(dt) {
    this._timer -= dt;
    if (this._timer <= 0) {
      this.owner.mesh.visible = true;
      this.go(AI_STATE.IDLE);
    }
  }
}

// ── La Presencia class ────────────────────────────────────────
export class Presencia extends EnemyBase {
  static BASE_HEARING = 0;
  static BASE_SIGHT = 0;
  static BASE_CHASE = 0;

  /**
   * @param {THREE.Vector3[]} cfg.manifestPoints — positions she can teleport to
   */
  constructor(cfg) {
    super({
      ...cfg,
      stats: {
        patrolSpeed: 0,
        alertSpeed: 0,
        chaseSpeed: 0,
        hearingRange: 0,
        sightRange: 0,
        searchRadius: 0,
        radiationEmit: 0.2,
        ...(cfg.stats ?? {}),
      },
    });

    this._manifestPoints = cfg.manifestPoints ?? [];
    this._manifestIdx = 0;
    this._blinkInProgress = false;

    // Subscribe to radio frequency solve event (puzzle P-03)
    this._unsubs.push(
      Bus.on(EV.PUZZLE_SOLVED, ({ puzzleId }) => {
        if (puzzleId === "radio" && !this.fsm.is(AI_STATE.DORMANT)) {
          this._stunDuration = 45;
          this.fsm.setState(AI_STATE.STUNNED);
        }
      }),
      // Player staring at her (passed from InteractionSystem)
      Bus.on("presencia:stared", () => {
        if (!this.fsm.isAny(AI_STATE.DORMANT, AI_STATE.STUNNED)) {
          this.fsm.setState(AI_STATE.CHASE);
        }
      }),
    );
  }

  _buildFSM() {
    return buildAIFSM(this, {
      [AI_STATE.DORMANT]: PresenciaDormantState,
      [AI_STATE.IDLE]: PresenciaIdleState,
      [AI_STATE.PATROL]: PresenciaPatrolState,
      [AI_STATE.CHASE]: PresenciaApproachState,
      [AI_STATE.STUNNED]: PresenciaRepelledState,
    });
  }

  _buildMesh() {
    const group = new THREE.Group();

    // Deliberately flat/billboard-like to emphasise her 2D quality
    const bodyGeo = new THREE.PlaneGeometry(0.7, 1.8);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xe8e8d8,
      roughness: 0.8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.9;
    body.castShadow = false; // no shadow — adds to uncanny feel
    group.add(body);

    // Faint aura — barely perceptible
    this._auraLight = new THREE.PointLight(0xffffff, 0.05, 4);
    this._auraLight.position.y = 1.0;
    group.add(this._auraLight);

    group.userData.audioType = "presencia";
    group.userData.enemyId = this.id;
    group.visible = false;
    return group;
  }

  // ── Teleport mechanics ────────────────────────────────────────

  _nextManifestPoint() {
    if (!this._manifestPoints.length) return this.mesh.position.clone();
    // Prefer points close to player for horror effect
    const player = this._playerRef;
    if (player && this._nightLevel >= 3) {
      // Sort by distance to player, pick one in mid range (not too close, not too far)
      const sorted = [...this._manifestPoints].sort((a, b) => {
        const da = a.distanceTo(player.position);
        const db = b.distanceTo(player.position);
        // Prefer ~15-25 m from player — visible but not immediate
        const scoreA = Math.abs(da - 18);
        const scoreB = Math.abs(db - 18);
        return scoreA - scoreB;
      });
      return sorted[0];
    }
    this._manifestIdx = (this._manifestIdx + 1) % this._manifestPoints.length;
    return this._manifestPoints[this._manifestIdx];
  }

  _manifestAt(pos) {
    this.mesh.position.copy(pos);
    // Always face player
    if (this._playerRef) {
      const dir = new THREE.Vector3().subVectors(this._playerRef.position, pos);
      this.mesh.rotation.y = Math.atan2(dir.x, dir.z);
    }
    this.mesh.userData.playSound = "typewriter_burst";
  }

  _blink(callback) {
    if (this._blinkInProgress) return;
    this._blinkInProgress = true;
    this.mesh.visible = false;
    setTimeout(() => {
      callback();
      this.mesh.visible = true;
      this._blinkInProgress = false;
    }, 120);
  }

  // ── Override sensors (she doesn't sense player normally) ─────
  _runSensors() {
    // La Presencia has no standard sensors
    // Her behaviour is entirely event-driven
  }

  update(dt) {
    this.fsm.update(dt); // skip EnemyBase super (no standard sensing)
    // Flicker opacity
    if (this.mesh.children[0]?.material) {
      this.mesh.children[0].material.opacity =
        0.75 + Math.sin(Date.now() * 0.005) * 0.1;
    }
  }
}

export default Presencia;

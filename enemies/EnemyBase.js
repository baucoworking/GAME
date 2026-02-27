/**
 * enemies/EnemyBase.js
 * Abstract base class for every creature in Chernobyl Mall.
 *
 * Provides:
 *  - FSM management via AIStateMachine
 *  - Sound detection (hearing radius, intensity threshold)
 *  - Line-of-sight (raycasting against scene geometry)
 *  - Player proximity / vibration sensing
 *  - Patrol waypoint management
 *  - Per-frame sensor tick (batched at Config.AI_UPDATE_INTERVAL)
 *  - Night-level adaptation (speed, detection range scaling)
 *  - Memory: last-known positions, hideout usage log
 *
 * Concrete enemies subclass this and:
 *   1. Override `_buildFSM()` to supply custom state overrides
 *   2. Override `_buildMesh()` to create their Three.js geometry
 *   3. Override `_sensorTick()` to add species-specific sensing
 */

import * as THREE from "three";
import { buildAIFSM } from "./AIStateMachine.js";
import { AI_STATE } from "../core/StateMachine.js";
import { Bus, EV } from "../core/EventBus.js";

// Shared raycaster — allocated once, reused each frame
const _raycaster = new THREE.Raycaster();
const _dir = new THREE.Vector3();

let _idCounter = 0;

export class EnemyBase {
  /**
   * @param {object}              cfg
   * @param {THREE.Scene}         cfg.scene
   * @param {NavigationMesh}      cfg.navMesh
   * @param {THREE.Vector3[]}     cfg.patrolWaypoints
   * @param {object}              cfg.playerRef   — live reference to player object { position, isHiding, currentHideout }
   * @param {object}              [cfg.stats]     — overrides for hearing/sight/speed
   * @param {THREE.Object3D[]}    [cfg.collidables] — meshes used for LOS raycasting
   */
  constructor(cfg) {
    this.id = `enemy_${++_idCounter}`;
    this.scene = cfg.scene;
    this.navMesh = cfg.navMesh;
    this.collidables = cfg.collidables ?? [];

    // Player reference (live object, updated externally)
    this._playerRef = cfg.playerRef ?? null;

    // ── Stats (can be overridden per subclass / per night) ──
    const s = cfg.stats ?? {};
    this.patrolSpeed = s.patrolSpeed ?? 1.2;
    this.alertSpeed = s.alertSpeed ?? 2.0;
    this.chaseSpeed = s.chaseSpeed ?? 3.5;
    this.hearingRange = s.hearingRange ?? 12;
    this.sightRange = s.sightRange ?? 8;
    this.sightAngle = s.sightAngle ?? Math.PI / 3; // 60°
    this.searchRadius = s.searchRadius ?? 8;
    this.radiationEmit = s.radiationEmit ?? 0.4; // mSv/h at 1 m

    // ── Patrol ──────────────────────────────────────────────
    this.patrolWaypoints = cfg.patrolWaypoints ?? [];
    this._patrolIndex = 0;

    // ── Memory ──────────────────────────────────────────────
    this._lastKnownPlayerPos = null;
    this._alertTarget = null; // noise origin currently investigating
    this._hideoutToCheck = null; // hideout scheduled for inspection
    this._lurePosition = null;
    this._stunDuration = 30;
    this._memoryDecayTimer = 0;
    this._memoryDecayTimeout = 120; // seconds

    // ── Night-level adaptations ──────────────────────────────
    this._nightLevel = 1; // 1..5
    this._adaptRate = 0; // 0..1, lerped by NightProgression
    this._knownHideouts = new Set(); // hideout ids enemy has checked

    // ── Sensor batching ──────────────────────────────────────
    this._sensorTimer = Math.random() * 0.1; // stagger initial ticks
    this._sensorInterval = 0.1; // 10 Hz

    // ── Three.js mesh (created in subclass) ──────────────────
    this.mesh = this._buildMesh();
    if (this.mesh) {
      this.mesh.userData.enemyId = this.id;
      this.scene.add(this.mesh);
    }

    // ── FSM ──────────────────────────────────────────────────
    this.fsm = this._buildFSM();
    this.fsm.setState(AI_STATE.DORMANT);

    // ── Event subscriptions ───────────────────────────────────
    this._unsubs = [];
    this._unsubs.push(Bus.on(EV.PLAYER_NOISE, (d) => this._onPlayerNoise(d)));
    this._unsubs.push(Bus.on(EV.NIGHT_START, (d) => this._onNightStart(d)));
    this._unsubs.push(Bus.on(EV.DAY_START, () => this._onDayStart()));
    this._unsubs.push(Bus.on(EV.AUDIO_LURE_START, (d) => this._onAudioLure(d)));
  }

  // ── Abstract – subclasses override ─────────────────────────

  /** @returns {THREE.Object3D} */
  _buildMesh() {
    // Default: invisible placeholder box
    const geo = new THREE.BoxGeometry(0.6, 1.8, 0.6);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      visible: false,
    });
    return new THREE.Mesh(geo, mat);
  }

  /**
   * Build and return the FSM for this enemy.
   * Override to pass custom state class overrides to buildAIFSM.
   * @returns {StateMachine}
   */
  _buildFSM() {
    return buildAIFSM(this);
  }

  /**
   * Species-specific sensing called at _sensorInterval Hz.
   * Called AFTER the base hearing/sight checks.
   * @param {number} dt
   */
  _sensorTick(dt) {}

  // ── Main update loop ────────────────────────────────────────

  /** Call from the game loop each frame. @param {number} dt */
  update(dt) {
    this.fsm.update(dt);
    this._updateMemoryDecay(dt);

    // Batch sensor checks
    this._sensorTimer -= dt;
    if (this._sensorTimer <= 0) {
      this._sensorTimer = this._sensorInterval;
      this._runSensors(dt);
    }
  }

  // ── Sensor system ───────────────────────────────────────────

  _runSensors(dt) {
    if (!this._playerRef) return;

    // Don't sense during dormant or stunned
    if (this.fsm.isAny(AI_STATE.DORMANT, AI_STATE.STUNNED)) return;

    const playerPos = this._playerRef.position;
    const dist = this.mesh.position.distanceTo(playerPos);

    // Sight check
    if (!this.fsm.is(AI_STATE.CHASE) && dist <= this.sightRange) {
      if (this._checkLOS(playerPos) && this._inSightCone(playerPos)) {
        this._onPlayerSpotted(playerPos);
        return;
      }
    }

    // Memory decay check: was chasing and now lost?
    if (this.fsm.is(AI_STATE.CHASE)) {
      if (!this._checkLOS(playerPos) || dist > this.sightRange * 1.5) {
        // Handled inside ChaseState — see lostTimer
      }
    }

    // Species-specific extra sensors
    this._sensorTick(dt);
  }

  /** Called when the enemy spots the player visually. */
  _onPlayerSpotted(playerPos) {
    this._lastKnownPlayerPos = playerPos.clone();
    if (!this.fsm.is(AI_STATE.CHASE) && !this.fsm.is(AI_STATE.FRENZY)) {
      this.fsm.setState(AI_STATE.CHASE);
    }
  }

  /** Called when a noise event is received on the bus. */
  _onPlayerNoise({ position, intensity, wet }) {
    if (
      this.fsm.isAny(
        AI_STATE.DORMANT,
        AI_STATE.STUNNED,
        AI_STATE.CHASE,
        AI_STATE.FRENZY,
      )
    )
      return;

    const dist = this.mesh.position.distanceTo(position);
    const effectiveRange = this.hearingRange * (1 + (wet ? 0.5 : 0));
    const threshold = intensity;

    if (dist <= effectiveRange && threshold > 0) {
      this._alertTarget = position.clone();
      Bus.emit(EV.ENEMY_HEARD_NOISE, { enemy: this, noisePos: position });
      this.fsm.setState(AI_STATE.ALERT);
    }
  }

  // ── LOS / cone helpers ──────────────────────────────────────

  /**
   * Raycast from enemy eye to target position.
   * @param {THREE.Vector3} targetPos
   * @returns {boolean}
   */
  _checkLOS(targetPos) {
    const origin = this.mesh.position.clone().add(new THREE.Vector3(0, 1.4, 0)); // eye height
    _dir.subVectors(targetPos, origin).normalize();
    _raycaster.set(origin, _dir);
    _raycaster.far = this.sightRange * 1.5;

    const hits = _raycaster.intersectObjects(this.collidables, true);
    if (hits.length === 0) return true; // unobstructed

    const hitDist = hits[0].distance;
    const targetDist = origin.distanceTo(targetPos);
    return hitDist >= targetDist - 0.3; // player is closer than first wall
  }

  /**
   * Check if `targetPos` is within this enemy's forward sight cone.
   * @param {THREE.Vector3} targetPos
   * @returns {boolean}
   */
  _inSightCone(targetPos) {
    const toTarget = _dir.subVectors(targetPos, this.mesh.position).normalize();
    const forward = new THREE.Vector3(
      -Math.sin(this.mesh.rotation.y),
      0,
      -Math.cos(this.mesh.rotation.y),
    );
    const dot = forward.dot(toTarget);
    return dot >= Math.cos(this.sightAngle / 2);
  }

  // ── Memory decay ────────────────────────────────────────────

  _updateMemoryDecay(dt) {
    if (!this._lastKnownPlayerPos) return;
    this._memoryDecayTimer += dt;
    if (this._memoryDecayTimer >= this._memoryDecayTimeout) {
      this._lastKnownPlayerPos = null;
      this._memoryDecayTimer = 0;
    }
  }

  // ── Night progression ────────────────────────────────────────

  /**
   * Called by NightProgression system to tune enemy difficulty.
   * @param {number} nightLevel   1–5
   * @param {number} adaptRate    0..1 linear adaptation within the night
   */
  setNightLevel(nightLevel, adaptRate = 0) {
    this._nightLevel = nightLevel;
    this._adaptRate = adaptRate;

    // Scale sensing by night
    const scale = 1 + (nightLevel - 1) * 0.15; // +15% per night
    this.hearingRange = (this.constructor.BASE_HEARING ?? 12) * scale;
    this.sightRange = (this.constructor.BASE_SIGHT ?? 8) * scale;
    this.chaseSpeed =
      (this.constructor.BASE_CHASE ?? 3.5) * (1 + (nightLevel - 1) * 0.1);

    // Night 5: frenzy mode enabled
    if (nightLevel >= 5 && !this.fsm.is(AI_STATE.DORMANT)) {
      this.fsm.setState(AI_STATE.FRENZY);
    }
  }

  /** Schedule a hideout to be inspected. */
  scheduleHideoutCheck(hideout) {
    if (this._knownHideouts.has(hideout.id)) return; // already checked
    this._hideoutToCheck = hideout;
    if (!this.fsm.isAny(AI_STATE.CHASE, AI_STATE.FRENZY, AI_STATE.STUNNED)) {
      this.fsm.setState(AI_STATE.CHECK_HIDEOUT);
    }
  }

  /** Mark a hideout as known (so it gets added to patrol route verification). */
  learnHideout(hideoutId) {
    this._knownHideouts.add(hideoutId);
  }

  // ── Lifecycle events ────────────────────────────────────────

  _onNightStart({ nightNumber }) {
    this._nightLevel = nightNumber;
    this.fsm.setState(AI_STATE.IDLE);
    Bus.emit(EV.ENEMY_SPAWNED, { enemy: this });
  }

  _onDayStart() {
    this.fsm.setState(AI_STATE.DORMANT);
  }

  _onAudioLure({ position, duration }) {
    if (this.fsm.isAny(AI_STATE.DORMANT, AI_STATE.CHASE, AI_STATE.FRENZY))
      return;
    this._lurePosition = position.clone();
    this._stunDuration = duration ?? 30;
    this.fsm.setState(AI_STATE.STUNNED);
  }

  // ── Disposal ─────────────────────────────────────────────────

  dispose() {
    this._unsubs.forEach((u) => u());
    if (this.mesh) this.scene.remove(this.mesh);
  }
}

export default EnemyBase;

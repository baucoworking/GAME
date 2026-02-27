/**
 * enemies/ViktorBoss.js
 * BOSS FINAL — VIKTOR SEMENOV (El Guardián / Khranitel)
 *
 * Viktor is the former security chief, 40 years mutated in the sewers.
 * 3.5 m, spider-like, completely silent, four amber eyes.
 *
 * BOSS SEQUENCE PHASES:
 *  Phase 0 - DORMANT         (not yet activated)
 *  Phase 1 - OBSERVE         (Night 4 cameo: silhouette at corridor end, no attack)
 *  Phase 2 - SEWER_APPROACH  (Night 5, player enters sewer Lvl2: amber reflection)
 *  Phase 3 - PURSUE          (Viktor appears, flows toward player at constant speed)
 *  Phase 4 - COLLAPSE_ROOM   (chamber trigger: player pulls lever, 8s countdown)
 *  Phase 5 - BURIED          (collapse animation, Viktor buried)
 *
 * Viktor CANNOT be damaged at any point.
 * Viktor DOES NOT run — constant speed slightly > player walk speed.
 * Viktor DOES NOT make sounds except limb-scrape on tunnel walls.
 * Viktor CAN be lost only if player takes correct bifurcations in labyrinth.
 *
 * The amber eye light is his only tell.
 */

import * as THREE from "three";
import { EnemyBase } from "./EnemyBase.js";
import { buildAIFSM } from "./AIStateMachine.js";
import { State, AI_STATE } from "../core/StateMachine.js";
import { Bus, EV } from "../core/EventBus.js";

// ── Boss-specific state names ─────────────────────────────────
export const VIKTOR_STATE = {
  DORMANT: AI_STATE.DORMANT,
  OBSERVE: "viktor_observe",
  SEWER_APPROACH: "viktor_sewer_approach",
  PURSUE: "viktor_pursue",
  COLLAPSE: "viktor_collapse",
  BURIED: "viktor_buried",
};

// ─────────────────────────────────────────────────────────────
// OBSERVE: Night 4 — stands at corridor end, stares, disappears
// ─────────────────────────────────────────────────────────────
class ViktorObserveState extends State {
  constructor(owner) {
    super(VIKTOR_STATE.OBSERVE, owner);
  }

  onEnter() {
    // Teleport to cameo position
    const pos = this.owner._cameoPosition;
    if (pos) this.owner.mesh.position.copy(pos);
    this.owner.mesh.visible = true;
    this._timer = 5 + Math.random() * 4; // visible for 5-9 s
    this._faced = false;
  }

  onUpdate(dt) {
    // Face player
    const player = this.owner._playerRef;
    if (player && !this._faced) {
      const dir = new THREE.Vector3().subVectors(
        player.position,
        this.owner.mesh.position,
      );
      this.owner.mesh.rotation.y = Math.atan2(dir.x, dir.z);
      this._faced = true;
    }

    this._timer -= dt;
    if (this._timer <= 0) {
      this.owner.mesh.visible = false;
      this.go(VIKTOR_STATE.DORMANT);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// SEWER_APPROACH: Amber eyes visible in water reflection only
// ─────────────────────────────────────────────────────────────
class ViktorSewerApproachState extends State {
  constructor(owner) {
    super(VIKTOR_STATE.SEWER_APPROACH, owner);
  }

  onEnter() {
    this.owner.mesh.visible = false;
    // Position 40 m behind player in the tunnel
    this._repositionBehind(40);
    this._reflectTimer = 0;
    this._triggerDist = 30; // when player passes this depth, reveal Viktor
  }

  _repositionBehind(distBehind) {
    const player = this.owner._playerRef;
    if (!player) return;
    const behind = player.position
      .clone()
      .sub(
        new THREE.Vector3(0, 0, -distBehind).applyEuler(
          new THREE.Euler(0, player.rotation?.y ?? 0, 0),
        ),
      );
    this.owner.mesh.position.copy(behind);
    this.owner.mesh.position.y = -0.5; // below water line
  }

  onUpdate(dt) {
    // Reflect amber light in water (handled by shader, just pulse the light)
    this._reflectTimer += dt;
    if (this.owner._eyeLight) {
      this.owner._eyeLight.intensity =
        Math.abs(Math.sin(this._reflectTimer * 1.5)) * 0.3;
    }

    // Check if player reached trigger depth
    const player = this.owner._playerRef;
    if (!player) return;
    if (player.userData?.sewerDepth >= 2) {
      this.go(VIKTOR_STATE.PURSUE);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// PURSUE: The chase — constant speed, no acceleration
// ─────────────────────────────────────────────────────────────
class ViktorPursueState extends State {
  constructor(owner) {
    super(VIKTOR_STATE.PURSUE, owner);
  }

  onEnter(prev) {
    Bus.emit(EV.ENEMY_STATE_CHANGE, {
      enemy: this.owner,
      from: prev?.name,
      to: this.name,
    });
    Bus.emit(EV.AUDIO_STATE, { state: "contact" });
    this.owner.mesh.visible = true;

    // Position 30 m behind player (sudden appearance as designed)
    const player = this.owner._playerRef;
    if (player) {
      const behind = player.position
        .clone()
        .sub(
          new THREE.Vector3(0, 0, -30).applyEuler(
            new THREE.Euler(0, player.rotation?.y ?? 0, 0),
          ),
        );
      this.owner.mesh.position.copy(behind);
    }

    this._pathTimer = 0;
    this._limbScrapeTimer = 0;
    this._catchRadius = 1.5;
  }

  onUpdate(dt) {
    const player = this.owner._playerRef;
    if (!player) return;

    // Catch check
    const dist = this.owner.mesh.position.distanceTo(player.position);
    if (dist < this._catchRadius) {
      Bus.emit(EV.PLAYER_CAUGHT);
      Bus.emit(EV.GAME_OVER);
      return;
    }

    // Limb scrape audio cue
    this._limbScrapeTimer -= dt;
    if (this._limbScrapeTimer <= 0) {
      this._limbScrapeTimer = 0.4 + Math.random() * 0.2;
      this.owner.mesh.userData.playSound = "viktor_limb_scrape";
    }

    // Re-path frequently (player is in labyrinth)
    this._pathTimer -= dt;
    if (this._pathTimer <= 0) {
      this._pathTimer = 0.3;
      this._path = this.owner.navMesh.findPath(
        this.owner.mesh.position,
        player.position,
      );
    }

    // Move at CONSTANT speed — no acceleration, no slowing
    if (this._path?.length) {
      const target = this._path[0];
      const dir = new THREE.Vector3(
        target.x - this.owner.mesh.position.x,
        0,
        target.z - this.owner.mesh.position.z,
      );
      const d = dir.length();
      if (d < 0.2) {
        this._path.shift();
        return;
      }
      // Constant speed — Viktor flows
      dir.normalize().multiplyScalar(this.owner.chaseSpeed * dt);
      this.owner.mesh.position.add(dir);
      this.owner.mesh.rotation.y = Math.atan2(dir.x, dir.z);
    }

    // Check for collapse room trigger
    if (player.userData?.inCollapseRoom) {
      this.go(VIKTOR_STATE.COLLAPSE);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// COLLAPSE: 8-second countdown, then debris falls
// ─────────────────────────────────────────────────────────────
class ViktorCollapseState extends State {
  constructor(owner) {
    super(VIKTOR_STATE.COLLAPSE, owner);
  }

  onEnter() {
    this._countdown = 8;
    this._collapseStarted = false;
    // Viktor enters the room
    const roomCenter = this.owner._collapseRoomCenter;
    if (roomCenter) {
      this._path = this.owner.navMesh.findPath(
        this.owner.mesh.position,
        roomCenter,
      );
    }
  }

  onUpdate(dt) {
    this._countdown -= dt;

    // Move into the room
    if (this._path?.length) {
      const t = this._path[0];
      const dir = new THREE.Vector3(
        t.x - this.owner.mesh.position.x,
        0,
        t.z - this.owner.mesh.position.z,
      );
      const d = dir.length();
      if (d > 0.2) {
        dir.normalize().multiplyScalar(this.owner.chaseSpeed * dt);
        this.owner.mesh.position.add(dir);
        this.owner.mesh.rotation.y = Math.atan2(dir.x, dir.z);
      } else {
        this._path.shift();
      }
    }

    // If player is still in room near end of countdown — close escape
    const player = this.owner._playerRef;
    if (player && this._countdown > 0 && this._countdown < 2) {
      const dist = this.owner.mesh.position.distanceTo(player.position);
      if (dist < 2.5) {
        Bus.emit(EV.PLAYER_CAUGHT);
        Bus.emit(EV.GAME_OVER);
        return;
      }
    }

    if (this._countdown <= 0) {
      this.go(VIKTOR_STATE.BURIED);
      // Trigger collapse visual/audio
      Bus.emit("boss:collapse", {
        position: this.owner.mesh.position.clone(),
        viktor: this.owner,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────
// BURIED: Viktor is covered, no longer active
// ─────────────────────────────────────────────────────────────
class ViktorBuriedState extends State {
  constructor(owner) {
    super(VIKTOR_STATE.BURIED, owner);
  }

  onEnter() {
    // Sink mesh into ground
    this._sinkTimer = 0;
    this._startY = this.owner.mesh.position.y;
  }

  onUpdate(dt) {
    this._sinkTimer += dt;
    const t = Math.min(this._sinkTimer / 3, 1);
    this.owner.mesh.position.y = this._startY - t * 2.5;

    if (t >= 1) {
      this.owner.mesh.visible = false;
      Bus.emit(EV.GAME_WIN); // Trigger ending cinematic
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Viktor Boss class
// ─────────────────────────────────────────────────────────────
export class ViktorBoss extends EnemyBase {
  static BASE_HEARING = 0;
  static BASE_SIGHT = 40;
  static BASE_CHASE = 3.8; // slightly > player walk speed

  /**
   * @param {THREE.Vector3}  cfg.cameoPosition       — Night 4 sighting position
   * @param {THREE.Vector3}  cfg.collapseRoomCenter  — Centre of the collapse chamber
   */
  constructor(cfg) {
    super({
      ...cfg,
      stats: {
        patrolSpeed: 0,
        alertSpeed: 0,
        chaseSpeed: 3.8, // Viktor's constant pursuit speed
        hearingRange: 0,
        sightRange: 40,
        sightAngle: Math.PI * 2, // omnidirectional
        searchRadius: 0,
        radiationEmit: 1.2,
        ...(cfg.stats ?? {}),
      },
    });

    this._cameoPosition = cfg.cameoPosition ?? null;
    this._collapseRoomCenter = cfg.collapseRoomCenter ?? null;

    // Subscribe to boss trigger events
    this._unsubs.push(
      Bus.on("boss:trigger_cameo", () => this._triggerCameo()),
      Bus.on("boss:trigger_sewer", () => this._triggerSewer()),
      Bus.on("boss:trigger_pursue", () => this._triggerPursue()),
      Bus.on("boss:lever_pulled", () => this._triggerCollapse()),
    );
  }

  _buildFSM() {
    const fsm = buildAIFSM(this, {
      [AI_STATE.CHASE]: ViktorPursueState, // override with boss chase
    });
    // Add boss-specific states
    fsm.add(new ViktorObserveState(this));
    fsm.add(new ViktorSewerApproachState(this));
    fsm.add(new ViktorPursueState(this));
    fsm.add(new ViktorCollapseState(this));
    fsm.add(new ViktorBuriedState(this));
    return fsm;
  }

  _buildMesh() {
    const group = new THREE.Group();

    // Massive compressed torso
    const bodyGeo = new THREE.CapsuleGeometry(0.5, 0.8, 4, 8);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x080808,
      roughness: 1.0,
      metalness: 0.1,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.6;
    body.scale.set(1.8, 1.0, 1.4); // compressed horizontally
    body.castShadow = true;
    group.add(body);

    // Head with human-ish face features
    const headGeo = new THREE.SphereGeometry(0.35, 10, 10);
    const head = new THREE.Mesh(headGeo, bodyMat);
    head.position.set(0, 1.3, 0.1);
    head.castShadow = true;
    group.add(head);

    // Four amber eyes arranged in a slight arc
    this._eyeLight = new THREE.PointLight(0xffaa00, 1.5, 8);
    this._eyeLight.position.set(0, 1.35, 0.3);
    group.add(this._eyeLight);

    const eyeMat = new THREE.MeshStandardMaterial({
      emissive: 0xffaa00,
      emissiveIntensity: 2.0,
      color: 0x000000,
    });
    const eyeOffsets = [
      [-0.12, 0],
      [-0.04, 0.03],
      [0.04, 0.03],
      [0.12, 0],
    ];
    eyeOffsets.forEach(([ox, oy]) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), eyeMat);
      eye.position.set(ox, 1.37 + oy, 0.33);
      group.add(eye);
    });

    // Eight spider-limbs
    const limbMat = new THREE.MeshStandardMaterial({
      color: 0x101010,
      roughness: 1.0,
    });
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const seg1 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.04, 1.0, 4),
        limbMat,
      );
      seg1.position.set(Math.cos(angle) * 0.7, 0.4, Math.sin(angle) * 0.7);
      seg1.rotation.z = (Math.PI / 3) * Math.cos(angle);
      seg1.rotation.x = (Math.PI / 4) * Math.sin(angle);
      seg1.castShadow = true;
      group.add(seg1);
    }

    // Soviet security badge fused to chest
    const badgeMat = new THREE.MeshStandardMaterial({
      color: 0x888855,
      roughness: 0.5,
      metalness: 0.6,
    });
    const badge = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.1, 0.02),
      badgeMat,
    );
    badge.position.set(-0.3, 0.9, 0.45);
    group.add(badge);

    group.userData.audioType = "viktor";
    group.userData.enemyId = this.id;
    group.visible = false;
    return group;
  }

  // ── Phase triggers (called externally by NightProgression) ──

  _triggerCameo() {
    if (!this.fsm.is(AI_STATE.DORMANT)) return;
    this.mesh.visible = true;
    this.fsm.setState(VIKTOR_STATE.OBSERVE);
  }

  _triggerSewer() {
    this.mesh.visible = false;
    this.fsm.setState(VIKTOR_STATE.SEWER_APPROACH);
  }

  _triggerPursue() {
    this.fsm.setState(VIKTOR_STATE.PURSUE);
  }

  _triggerCollapse() {
    if (this.fsm.is(VIKTOR_STATE.PURSUE)) {
      this.fsm.setState(VIKTOR_STATE.COLLAPSE);
    }
  }

  // ── Eye glow animation ───────────────────────────────────────
  update(dt) {
    this.fsm.update(dt); // skip EnemyBase sensors for Viktor
    if (this._eyeLight && !this.fsm.is(AI_STATE.DORMANT)) {
      // Steady amber glow — no flickering (makes it more terrifying)
      const pursuing = this.fsm.isAny(
        VIKTOR_STATE.PURSUE,
        VIKTOR_STATE.COLLAPSE,
      );
      this._eyeLight.intensity = pursuing ? 2.5 : 0.8;
      this._eyeLight.distance = pursuing ? 12 : 6;
    }
    // Animate limbs in pursue mode
    if (
      this.fsm.is(VIKTOR_STATE.PURSUE) ||
      this.fsm.is(VIKTOR_STATE.COLLAPSE)
    ) {
      const t = Date.now() * 0.004;
      this.mesh.children.forEach((child, i) => {
        if (i >= 5) {
          // limbs start at index 5
          child.position.y = 0.4 + Math.sin(t + i * 0.8) * 0.12;
        }
      });
    }
  }

  // Viktor ignores standard night start/end
  _onNightStart({ nightNumber }) {
    this._nightLevel = nightNumber;
    // Stay dormant — boss is triggered manually by boss trigger events
  }

  _onDayStart() {
    // Viktor never goes dormant during the day on Night 5
    if (this._nightLevel < 5) {
      this.fsm.setState(AI_STATE.DORMANT);
    }
  }

  // Viktor can't be hearing-detected
  _onPlayerNoise() {}
  _runSensors() {}
}

export default ViktorBoss;

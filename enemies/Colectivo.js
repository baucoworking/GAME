/**
 * enemies/Colectivo.js
 * CRIATURA 04 — EL COLECTIVO (Kollektiv)
 *
 * Three reactor technicians fused by LESNOJ radiation into a single entity.
 * ~3 m diameter mass of intertwined bodies, moves on 6 arms like a spider.
 *
 * Key mechanics:
 *  - Only appears in LARGE zones (Atrium, Storage, Cinema)
 *  - Cannot enter narrow corridors/ducts — corridors are safe from it
 *  - Active LOS → direct pursuit
 *  - No LOS → random wander
 *  - Can DESTROY physical hideouts if it knows player is inside
 *  - Hearing range higher than Rezagado (lower to ground)
 *  - Three desynchronised breathing loops in AudioSystem
 */

import * as THREE from "three";
import { EnemyBase } from "./EnemyBase.js";
import { buildAIFSM } from "./AIStateMachine.js";
import { State, AI_STATE } from "../core/StateMachine.js";
import { Bus, EV } from "../core/EventBus.js";

// ── Custom PATROL: random wander in large zones ───────────────
class ColectivoWanderState extends State {
  constructor(owner) {
    super(AI_STATE.PATROL, owner);
  }
  onEnter() {
    this._pickTarget();
  }

  _pickTarget() {
    // Random point within current large zone
    const pt = this.owner.navMesh.randomWalkable();
    this._path = this.owner.navMesh.findPath(this.owner.mesh.position, pt);
    this._path = this.owner.navMesh.smoothPath(this._path);
  }

  onUpdate(dt) {
    if (!this._path?.length) {
      this._pickTarget();
      return;
    }
    const t = this._path[0];
    const dir = new THREE.Vector3(
      t.x - this.owner.mesh.position.x,
      0,
      t.z - this.owner.mesh.position.z,
    );
    const d = dir.length();
    if (d < 0.2) {
      this._path.shift();
      if (!this._path.length) this.go(AI_STATE.IDLE);
      return;
    }
    dir.normalize().multiplyScalar(this.owner.patrolSpeed * dt);
    this.owner.mesh.position.add(dir);
    this.owner.mesh.rotation.y += 0.01; // slow gyrating motion

    // Foot-strike audio every 0.4 s (irregular multi-limb rhythm)
    this.owner._footTimer = (this.owner._footTimer ?? 0) - dt;
    if (this.owner._footTimer <= 0) {
      this.owner._footTimer = 0.35 + Math.random() * 0.15;
      this.owner.mesh.userData.gaitStep = true;
    }
  }
}

// ── Custom CHASE: direct pursuit + hideout destruction ────────
class ColectivoChaseState extends State {
  constructor(owner) {
    super(AI_STATE.CHASE, owner);
  }

  onEnter(prev) {
    Bus.emit(EV.ENEMY_STATE_CHANGE, {
      enemy: this.owner,
      from: prev?.name,
      to: this.name,
    });
    this._pathTimer = 0;
    this._lostTimer = 0;
    this._destroyTimer = 0;
  }

  onUpdate(dt) {
    const player = this.owner._playerRef;
    if (!player) return;

    const dist = this.owner.mesh.position.distanceTo(player.position);

    // Narrow-corridor escape: if player enters a narrow zone, Colectivo loses chase
    if (player.isInNarrowZone) {
      this.owner._lastKnownPlayerPos = player.position.clone();
      this.go(AI_STATE.SEARCH);
      return;
    }

    // Destroy hideout if player hides
    if (player.isHiding && player.currentHideout) {
      this._destroyTimer += dt;
      if (dist < 3 && this._destroyTimer > 2.5) {
        // Smash the hideout
        Bus.emit(EV.HIDEOUT_CLOSED, {
          hideout: player.currentHideout,
          forced: true,
        });
        player.currentHideout.destroy?.();
        Bus.emit(EV.PLAYER_CAUGHT);
        this.go(AI_STATE.PATROL);
        return;
      }
    } else {
      this._destroyTimer = 0;
    }

    // Catch
    if (dist < 1.5) {
      Bus.emit(EV.PLAYER_CAUGHT);
      return;
    }

    // LOS check
    if (!this.owner._checkLOS(player.position)) {
      this._lostTimer += dt;
      if (this._lostTimer > 2.0) {
        this.owner._lastKnownPlayerPos = player.position.clone();
        Bus.emit(EV.ENEMY_LOST_PLAYER, { enemy: this.owner });
        this.go(AI_STATE.SEARCH);
        return;
      }
    } else {
      this._lostTimer = 0;
    }

    this._pathTimer -= dt;
    if (this._pathTimer <= 0) {
      this._pathTimer = 0.25;
      this._path = this.owner.navMesh.findPath(
        this.owner.mesh.position,
        player.position,
      );
    }

    if (this._path?.length) {
      const t = this._path[0];
      const dir = new THREE.Vector3(
        t.x - this.owner.mesh.position.x,
        0,
        t.z - this.owner.mesh.position.z,
      );
      const d = dir.length();
      if (d < 0.2) {
        this._path.shift();
        return;
      }
      dir.normalize().multiplyScalar(this.owner.chaseSpeed * dt);
      this.owner.mesh.position.add(dir);
      this.owner.mesh.rotation.y = Math.atan2(dir.x, dir.z);
    }
  }
}

// ── El Colectivo class ─────────────────────────────────────────
export class Colectivo extends EnemyBase {
  static BASE_HEARING = 18; // large mass, closer to ground, better audio
  static BASE_SIGHT = 12;
  static BASE_CHASE = 3.8;

  /**
   * @param {string[]} cfg.allowedZoneIds  — zone IDs where it may appear (large zones only)
   */
  constructor(cfg) {
    super({
      ...cfg,
      stats: {
        patrolSpeed: 1.5,
        alertSpeed: 2.5,
        chaseSpeed: 3.8,
        hearingRange: 18,
        sightRange: 12,
        sightAngle: Math.PI * 0.8, // wide
        searchRadius: 10,
        radiationEmit: 0.7,
        ...(cfg.stats ?? {}),
      },
    });
    this._allowedZoneIds = cfg.allowedZoneIds ?? [];
    this._breathTimers = [0, 0.45, 0.9]; // desync offsets
  }

  _buildFSM() {
    return buildAIFSM(this, {
      [AI_STATE.PATROL]: ColectivoWanderState,
      [AI_STATE.CHASE]: ColectivoChaseState,
    });
  }

  _buildMesh() {
    const group = new THREE.Group();

    // Central mass
    const mainGeo = new THREE.IcosahedronGeometry(0.9, 1);
    const mainMat = new THREE.MeshStandardMaterial({
      color: 0x1c1208,
      roughness: 1.0,
      metalness: 0.0,
    });
    const main = new THREE.Mesh(mainGeo, mainMat);
    main.position.y = 0.9;
    main.castShadow = true;
    group.add(main);

    // Three heads protruding at different angles
    const headMat = new THREE.MeshStandardMaterial({
      color: 0x2a1a10,
      roughness: 0.9,
    });
    const headPositions = [
      [0.7, 1.4, 0.3],
      [-0.5, 1.6, 0.4],
      [0.1, 1.8, -0.6],
    ];
    headPositions.forEach(([x, y, z]) => {
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 6), headMat);
      h.position.set(x, y, z);
      h.castShadow = true;
      group.add(h);
    });

    // Six arm/limbs (simplified cones pointing outward)
    const limbMat = new THREE.MeshStandardMaterial({
      color: 0x150e08,
      roughness: 1.0,
    });
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const limb = new THREE.Mesh(
        new THREE.ConeGeometry(0.12, 0.9, 4),
        limbMat,
      );
      limb.position.set(Math.cos(angle) * 0.85, 0.3, Math.sin(angle) * 0.85);
      limb.rotation.z = Math.PI / 2 + angle * 0.3;
      limb.castShadow = true;
      group.add(limb);
    }

    group.userData.audioType = "colectivo";
    group.userData.enemyId = this.id;
    return group;
  }

  update(dt) {
    super.update(dt);
    // Animate limbs: crawling motion
    if (this.mesh && !this.fsm.is(AI_STATE.DORMANT)) {
      const t = Date.now() * 0.003;
      this.mesh.children.forEach((child, i) => {
        if (i > 3) {
          // limbs
          child.position.y = 0.3 + Math.sin(t + i * 1.2) * 0.15;
        }
      });
    }
  }

  // Override: Colectivo must be in a large zone to remain active
  _onNightStart({ nightNumber }) {
    this._nightLevel = nightNumber;
    // Only become active if allowed zones exist
    if (this._allowedZoneIds.length > 0) {
      this.fsm.setState(AI_STATE.IDLE);
      Bus.emit(EV.ENEMY_SPAWNED, { enemy: this });
    }
  }
}

export default Colectivo;
